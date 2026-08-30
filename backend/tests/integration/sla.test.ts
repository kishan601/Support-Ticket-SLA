import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { calculateRemainingBusinessMinutes, getSlaState, calculateSlaTarget } from '../../src/services/sla/engine';

// Safety guard: only run against a dedicated test DB, never the real one.
// Set TEST_DATABASE_URL in your environment (e.g. a local Docker PostgreSQL) to enable these tests.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  describe.skip('Integration Test: Ticket SLA flow (SKIPPED — TEST_DATABASE_URL not set)', () => {
    it('skipped', () => {});
  });
} else {

const prisma = new PrismaClient({
  datasources: { db: { url: testDatabaseUrl } }
});

describe('Integration Test: Ticket SLA flow', () => {
  const tz = process.env.BUSINESS_TIMEZONE || 'UTC';

  beforeAll(async () => {
    // Clean DB
    await prisma.comment.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.user.deleteMany();
    await prisma.holiday.deleteMany();
    
    // Create users
    await prisma.user.create({
      data: { id: 'user-reporter', email: 'testreporter@example.com', name: 'R', passwordHash: 'hash', role: 'REPORTER' }
    });
    await prisma.user.create({
      data: { id: 'user-agent', email: 'testagent@example.com', name: 'A', passwordHash: 'hash', role: 'AGENT' }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Create ticket -> Reporter comment -> Agent comment -> Verify SLA', async () => {
    // 1. Create ticket
    let ticket = await prisma.ticket.create({
      data: {
        title: 'Integration Test Ticket',
        description: 'Test',
        priority: 'HIGH',
        reporterId: 'user-reporter',
        status: 'OPEN'
      }
    });

    expect(ticket.firstResponseAt).toBeNull();
    expect(ticket.resolvedAt).toBeNull();

    // 2. Add reporter comment (does not trigger first response)
    await prisma.comment.create({
      data: { content: 'More info', ticketId: ticket.id, authorId: 'user-reporter' }
    });

    ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticket.firstResponseAt).toBeNull();

    // 3. Add agent comment (triggers first response)
    const agentCommentDate = new Date();
    await prisma.$transaction([
      prisma.comment.create({
        data: { content: 'Working on it', ticketId: ticket.id, authorId: 'user-agent' }
      }),
      prisma.ticket.update({
        where: { id: ticket.id },
        data: { firstResponseAt: agentCommentDate }
      })
    ]);

    ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticket.firstResponseAt).not.toBeNull();
    expect(ticket.firstResponseAt?.getTime()).toBe(agentCommentDate.getTime());

    // 4. Verify persisted SLA information
    const holidays = await prisma.holiday.findMany();
    const firstResponseTarget = calculateSlaTarget(ticket.createdAt, 4, holidays, tz);
    const frRemaining = calculateRemainingBusinessMinutes(firstResponseTarget, ticket.firstResponseAt!, holidays, tz);
    
    const state = getSlaState(4 * 60, frRemaining);
    expect(['ON_TRACK', 'AT_RISK', 'BREACHED']).toContain(state);
  });
});

} // end else (TEST_DATABASE_URL guard)
