import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PrismaClient, Priority, TicketStatus, Role, Ticket, Comment, Holiday, Prisma } from '@prisma/client';
import { calculateSlaTarget, calculateRemainingBusinessMinutes, getSlaState } from '../../services/sla/engine';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const TIMEZONE = process.env.BUSINESS_TIMEZONE || 'UTC';

export interface GraphQLContext {
  prisma: PrismaClient;
  request: {
    userId?: string | undefined;
    userRole?: string | undefined;
  };
}

interface TicketsArgs {
  status?: TicketStatus;
  priority?: Priority;
  assigneeId?: string;
  slaState?: 'ON_TRACK' | 'AT_RISK' | 'BREACHED';
  take?: number;
  cursor?: string;
}

interface CreateTicketArgs {
  title: string;
  description: string;
  priority: Priority;
}

interface AssignTicketArgs {
  ticketId: string;
  assigneeId: string;
}

interface ChangeTicketStatusArgs {
  ticketId: string;
  status: TicketStatus;
}

interface AddCommentArgs {
  ticketId: string;
  content: string;
}

interface RegisterArgs {
  name: string;
  email: string;
  password: string;
  role: Role;
}

interface LoginArgs {
  email: string;
  password: string;
}

const slaPolicies: Record<Priority, { response: number; resolution: number }> = {
  URGENT: { response: 1, resolution: 4 },
  HIGH: { response: 4, resolution: 24 },
  MEDIUM: { response: 8, resolution: 48 },
  LOW: { response: 24, resolution: 72 }
};

const VALID_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: []
};

export const resolvers = {
  Query: {
    tickets: async (_: unknown, args: TicketsArgs, { prisma }: GraphQLContext) => {
      const where: Prisma.TicketWhereInput = {};
      if (args.status) where.status = args.status;
      if (args.priority) where.priority = args.priority;
      if (args.assigneeId) where.assigneeId = args.assigneeId;

      let tickets = await prisma.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' }
      });

      // Filter by SLA state in memory if requested
      if (args.slaState) {
        const holidays = await prisma.holiday.findMany();
        const now = new Date();
        tickets = tickets.filter(ticket => {
          const policy = slaPolicies[ticket.priority];
          const resolutionTarget = calculateSlaTarget(ticket.createdAt, policy.resolution, holidays, TIMEZONE);
          let remaining = 0;
          if (ticket.resolvedAt) {
            remaining = calculateRemainingBusinessMinutes(resolutionTarget, ticket.resolvedAt, holidays, TIMEZONE);
          } else {
            remaining = calculateRemainingBusinessMinutes(resolutionTarget, now, holidays, TIMEZONE);
          }
          const state = getSlaState(policy.resolution * 60, remaining);
          return state === args.slaState;
        });
      }

      // Pagination
      const take = args.take || 10;
      let startIndex = 0;
      if (args.cursor) {
        const index = tickets.findIndex(t => t.id === args.cursor);
        if (index !== -1) startIndex = index + 1;
      }
      
      const paginatedTickets = tickets.slice(startIndex, startIndex + take);
      const hasNextPage = startIndex + take < tickets.length;
      const endCursor = paginatedTickets.length > 0 ? paginatedTickets[paginatedTickets.length - 1]?.id ?? null : null;

      return {
        nodes: paginatedTickets,
        pageInfo: {
          hasNextPage,
          endCursor
        }
      };
    },
    ticket: async (_: unknown, { id }: { id: string }, { prisma }: GraphQLContext) => {
      return prisma.ticket.findUnique({ where: { id } });
    },
    dashboard: async (_: unknown, __: unknown, { prisma }: GraphQLContext) => {
      const tickets = await prisma.ticket.findMany({
        where: { status: { not: 'CLOSED' } }
      });
      const holidays = await prisma.holiday.findMany();
      const now = new Date();

      let openCount = 0;
      let inProgressCount = 0;
      let atRiskCount = 0;
      let breachedCount = 0;

      for (const t of tickets) {
        if (t.status === 'OPEN') openCount++;
        if (t.status === 'IN_PROGRESS') inProgressCount++;

        const policy = slaPolicies[t.priority];
        const resTarget = calculateSlaTarget(t.createdAt, policy.resolution, holidays, TIMEZONE);
        const remaining = t.resolvedAt 
          ? calculateRemainingBusinessMinutes(resTarget, t.resolvedAt, holidays, TIMEZONE)
          : calculateRemainingBusinessMinutes(resTarget, now, holidays, TIMEZONE);
        const state = getSlaState(policy.resolution * 60, remaining);
        
        if (state === 'AT_RISK') atRiskCount++;
        if (state === 'BREACHED') breachedCount++;
      }

      return {
        openTickets: openCount,
        inProgressTickets: inProgressCount,
        atRiskTickets: atRiskCount,
        breachedTickets: breachedCount
      };
    },
    users: async (_: unknown, { role }: { role?: Role }, { prisma }: GraphQLContext) => {
      const where: Prisma.UserWhereInput = role ? { role } : {};
      return prisma.user.findMany({ where });
    },
    holidays: async (_: unknown, __: unknown, { prisma }: GraphQLContext) => {
      return prisma.holiday.findMany();
    }
  },
  
  Mutation: {
    createTicket: async (
      _: unknown, 
      { title, description, priority }: CreateTicketArgs, 
      { prisma, request }: GraphQLContext
    ) => {
      const userId = request.userId;
      if (!userId) throw new Error('UNAUTHORIZED');
      if (!title || !title.trim() || !description || !description.trim()) {
        throw new Error('VALIDATION_ERROR');
      }
      return prisma.ticket.create({
        data: {
          title: title.trim(),
          description: description.trim(),
          priority,
          reporterId: userId
        }
      });
    },
    assignTicket: async (
      _: unknown, 
      { ticketId, assigneeId }: AssignTicketArgs, 
      { prisma, request }: GraphQLContext
    ) => {
      if (request.userRole !== 'AGENT') throw new Error('FORBIDDEN');
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error('TICKET_NOT_FOUND');
      
      const assignee = await prisma.user.findUnique({ where: { id: assigneeId } });
      if (!assignee) throw new Error('USER_NOT_FOUND');

      return prisma.ticket.update({
        where: { id: ticketId },
        data: { assigneeId }
      });
    },
    changeTicketStatus: async (
      _: unknown, 
      { ticketId, status }: ChangeTicketStatusArgs, 
      { prisma, request }: GraphQLContext
    ) => {
      if (request.userRole !== 'AGENT') throw new Error('FORBIDDEN');
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error('TICKET_NOT_FOUND');
      
      if (ticket.status !== status) {
        const allowed = VALID_STATUS_TRANSITIONS[ticket.status] || [];
        if (!allowed.includes(status)) {
          throw new Error('INVALID_STATUS_TRANSITION');
        }
      }

      const data: Prisma.TicketUpdateInput = { status };
      if (status === 'RESOLVED' && !ticket.resolvedAt) {
        data.resolvedAt = new Date();
      }

      return prisma.ticket.update({
        where: { id: ticketId },
        data
      });
    },
    addComment: async (
      _: unknown, 
      { ticketId, content }: AddCommentArgs, 
      { prisma, request }: GraphQLContext
    ) => {
      if (!request.userId) throw new Error('UNAUTHORIZED');
      if (!content || !content.trim()) {
        throw new Error('VALIDATION_ERROR');
      }
      
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error('TICKET_NOT_FOUND');

      const isAgent = request.userRole === 'AGENT';
      
      const updateTicketData: Prisma.TicketUpdateInput = {};
      if (isAgent && !ticket.firstResponseAt) {
        updateTicketData.firstResponseAt = new Date();
      }

      const [comment] = await prisma.$transaction([
        prisma.comment.create({
          data: {
            content: content.trim(),
            ticketId,
            authorId: request.userId
          }
        }),
        prisma.ticket.update({
          where: { id: ticketId },
          data: updateTicketData
        })
      ]);
      
      return comment;
    },
    resolveTicket: async (
      _: unknown, 
      { ticketId }: { ticketId: string }, 
      { prisma, request }: GraphQLContext
    ) => {
      if (request.userRole !== 'AGENT') throw new Error('FORBIDDEN');
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
      if (!ticket) throw new Error('TICKET_NOT_FOUND');

      if (ticket.status === 'CLOSED') {
        throw new Error('INVALID_STATUS_TRANSITION');
      }

      return prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'RESOLVED', resolvedAt: ticket.resolvedAt ?? new Date() }
      });
    },
    register: async (
      _: unknown, 
      { name, email, password, role }: RegisterArgs, 
      { prisma }: GraphQLContext
    ) => {
      if (!name || !name.trim() || !email || !email.trim() || !password || !password.trim()) {
        throw new Error('VALIDATION_ERROR');
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { name: name.trim(), email: email.trim().toLowerCase(), passwordHash: hashedPassword, role }
      });
      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET);
      return { token, user };
    },
    login: async (
      _: unknown, 
      { email, password }: LoginArgs, 
      { prisma }: GraphQLContext
    ) => {
      const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (!user) throw new Error('USER_NOT_FOUND');
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new Error('UNAUTHORIZED');
      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET);
      return { token, user };
    }
  },

  Ticket: {
    reporter: (parent: Ticket, _: unknown, { prisma }: GraphQLContext) => 
      prisma.user.findUnique({ where: { id: parent.reporterId } }),
    assignee: (parent: Ticket, _: unknown, { prisma }: GraphQLContext) => 
      parent.assigneeId ? prisma.user.findUnique({ where: { id: parent.assigneeId } }) : null,
    comments: (parent: Ticket, _: unknown, { prisma }: GraphQLContext) => 
      prisma.comment.findMany({ where: { ticketId: parent.id }, orderBy: { createdAt: 'asc' } }),
    createdAt: (parent: Ticket) => parent.createdAt.toISOString(),
    firstResponseAt: (parent: Ticket) => parent.firstResponseAt?.toISOString() ?? null,
    resolvedAt: (parent: Ticket) => parent.resolvedAt?.toISOString() ?? null,
    sla: async (parent: Ticket, _: unknown, { prisma }: GraphQLContext) => {
      const holidays = await prisma.holiday.findMany();
      const policy = slaPolicies[parent.priority];
      const now = new Date();

      const firstResponseTarget = calculateSlaTarget(parent.createdAt, policy.response, holidays, TIMEZONE);
      const resolutionTarget = calculateSlaTarget(parent.createdAt, policy.resolution, holidays, TIMEZONE);

      const frRemaining = parent.firstResponseAt 
        ? calculateRemainingBusinessMinutes(firstResponseTarget, parent.firstResponseAt, holidays, TIMEZONE)
        : calculateRemainingBusinessMinutes(firstResponseTarget, now, holidays, TIMEZONE);

      const resRemaining = parent.resolvedAt
        ? calculateRemainingBusinessMinutes(resolutionTarget, parent.resolvedAt, holidays, TIMEZONE)
        : calculateRemainingBusinessMinutes(resolutionTarget, now, holidays, TIMEZONE);

      return {
        firstResponseDueAt: firstResponseTarget.toISOString(),
        resolutionDueAt: resolutionTarget.toISOString(),
        firstResponseState: getSlaState(policy.response * 60, frRemaining),
        resolutionState: getSlaState(policy.resolution * 60, resRemaining),
        firstResponseRemainingMinutes: frRemaining,
        resolutionRemainingMinutes: resRemaining
      };
    }
  },

  Comment: {
    author: (parent: Comment, _: unknown, { prisma }: GraphQLContext) => 
      prisma.user.findUnique({ where: { id: parent.authorId } }),
    createdAt: (parent: Comment) => parent.createdAt.toISOString()
  },
  
  Holiday: {
    date: (parent: Holiday) => parent.date.toISOString().split('T')[0]
  }
};
