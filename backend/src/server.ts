import 'dotenv/config';
import { createServer } from 'node:http';
import { createYoga, createSchema, type YogaInitialContext } from 'graphql-yoga';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvers, type GraphQLContext } from './graphql/resolvers';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Expected business-logic error codes — these are not server bugs, just GraphQL errors
const EXPECTED_ERROR_CODES = new Set([
  'USER_NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'TICKET_NOT_FOUND',
  'INVALID_STATUS_TRANSITION',
  'VALIDATION_ERROR',
]);

const prisma = new PrismaClient(
  process.env.DATABASE_URL
    ? {
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      }
    : undefined
);

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-key';

const typeDefs = readFileSync(join(__dirname, 'graphql/schema/typeDefs.graphql'), 'utf8');

const schema = createSchema<GraphQLContext>({
  typeDefs,
  resolvers,
});

const yoga = createYoga<GraphQLContext>({
  schema,
  cors: {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  },
  // Mask unexpected errors from leaking internals, but pass through known business errors
  maskedErrors: {
    maskError(error, message, isDev) {
      const msg = (error as Error)?.message ?? '';
      // Allow known business-logic errors to propagate as-is
      if (EXPECTED_ERROR_CODES.has(msg)) {
        return error as Error;
      }
      // For unexpected errors, log them properly
      if (!EXPECTED_ERROR_CODES.has(msg)) {
        console.error('[Unexpected GraphQL Error]', error);
      }
      return isDev ? (error as Error) : new Error(message);
    },
  },
  context: async ({ request }: YogaInitialContext): Promise<GraphQLContext> => {
    let userId: string | undefined;
    let userRole: string | undefined;

    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
        userId = decoded.userId;
        userRole = decoded.role;
      } catch {
        // Invalid or expired token — silently ignore
      }
    }

    return {
      prisma,
      request: {
        userId,
        userRole,
      },
    };
  },
});

const server = createServer(yoga);

const PORT = process.env.PORT || 4000;

// Connect to DB with retry for Neon serverless cold-start delays
async function startServer(retries = 3, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect();
      server.listen(PORT, () => {
        console.info(`GraphQL Yoga server ready at http://localhost:${PORT}/graphql`);
      });
      return;
    } catch (err) {
      if (attempt === retries) {
        console.error(`[DB] Failed to connect after ${retries} attempts:`, err);
        process.exit(1);
      }
      console.warn(`[DB] Connection attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

startServer();
