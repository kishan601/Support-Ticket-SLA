import { describe, it, expect } from 'vitest';

// Status transition validation logic
const allowedTransitions: Record<string, string[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [] // Closed tickets cannot transition back without reopening
};

function validateStatusTransition(currentStatus: string, nextStatus: string): boolean {
  if (currentStatus === nextStatus) return true;
  const allowed = allowedTransitions[currentStatus] || [];
  return allowed.includes(nextStatus);
}

function validateTicketInput(title: string, description: string) {
  if (!title || !title.trim()) throw new Error('VALIDATION_ERROR: Title cannot be empty');
  if (!description || !description.trim()) throw new Error('VALIDATION_ERROR: Description cannot be empty');
}

function checkAgentAuthorization(userRole: string | undefined) {
  if (userRole !== 'AGENT') throw new Error('FORBIDDEN');
}

describe('Business Logic & Validation Rules', () => {
  describe('Status Transitions', () => {
    it('allows OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED', () => {
      expect(validateStatusTransition('OPEN', 'IN_PROGRESS')).toBe(true);
      expect(validateStatusTransition('IN_PROGRESS', 'RESOLVED')).toBe(true);
      expect(validateStatusTransition('RESOLVED', 'CLOSED')).toBe(true);
    });

    it('rejects CLOSED -> IN_PROGRESS', () => {
      expect(validateStatusTransition('CLOSED', 'IN_PROGRESS')).toBe(false);
    });

    it('rejects CLOSED -> OPEN without reopening', () => {
      expect(validateStatusTransition('CLOSED', 'OPEN')).toBe(false);
    });
  });

  describe('Ticket Validation', () => {
    it('throws error for empty title', () => {
      expect(() => validateTicketInput('', 'Valid description')).toThrow('VALIDATION_ERROR');
      expect(() => validateTicketInput('   ', 'Valid description')).toThrow('VALIDATION_ERROR');
    });

    it('throws error for empty description', () => {
      expect(() => validateTicketInput('Valid Title', '')).toThrow('VALIDATION_ERROR');
      expect(() => validateTicketInput('Valid Title', '   ')).toThrow('VALIDATION_ERROR');
    });

    it('accepts valid title and description', () => {
      expect(() => validateTicketInput('Payment Bug', 'Stripe failure on checkout')).not.toThrow();
    });
  });

  describe('Authorization Rules', () => {
    it('allows AGENT role to perform agent actions', () => {
      expect(() => checkAgentAuthorization('AGENT')).not.toThrow();
    });

    it('throws FORBIDDEN for REPORTER role attempting agent actions', () => {
      expect(() => checkAgentAuthorization('REPORTER')).toThrow('FORBIDDEN');
    });

    it('throws FORBIDDEN for unauthenticated/undefined role', () => {
      expect(() => checkAgentAuthorization(undefined)).toThrow('FORBIDDEN');
    });
  });

  describe('Cursor-Based Pagination Logic', () => {
    const mockTickets = Array.from({ length: 25 }, (_, i) => ({
      id: `ticket-${i + 1}`,
      title: `Ticket ${i + 1}`
    }));

    function paginateTickets(items: typeof mockTickets, take: number, cursor?: string | null) {
      let startIndex = 0;
      if (cursor) {
        const index = items.findIndex((t) => t.id === cursor);
        if (index !== -1) startIndex = index + 1;
      }
      const nodes = items.slice(startIndex, startIndex + take);
      const hasNextPage = startIndex + take < items.length;
      const endCursor = nodes.length > 0 ? nodes[nodes.length - 1]?.id ?? null : null;
      return { nodes, pageInfo: { hasNextPage, endCursor } };
    }

    it('returns first page with hasNextPage=true when items exceed take', () => {
      const page1 = paginateTickets(mockTickets, 10);
      expect(page1.nodes).toHaveLength(10);
      expect(page1.nodes[0].id).toBe('ticket-1');
      expect(page1.nodes[9].id).toBe('ticket-10');
      expect(page1.pageInfo.hasNextPage).toBe(true);
      expect(page1.pageInfo.endCursor).toBe('ticket-10');
    });

    it('returns second page starting after endCursor', () => {
      const page2 = paginateTickets(mockTickets, 10, 'ticket-10');
      expect(page2.nodes).toHaveLength(10);
      expect(page2.nodes[0].id).toBe('ticket-11');
      expect(page2.nodes[9].id).toBe('ticket-20');
      expect(page2.pageInfo.hasNextPage).toBe(true);
      expect(page2.pageInfo.endCursor).toBe('ticket-20');
    });

    it('returns last page with hasNextPage=false', () => {
      const page3 = paginateTickets(mockTickets, 10, 'ticket-20');
      expect(page3.nodes).toHaveLength(5);
      expect(page3.nodes[0].id).toBe('ticket-21');
      expect(page3.nodes[4].id).toBe('ticket-25');
      expect(page3.pageInfo.hasNextPage).toBe(false);
      expect(page3.pageInfo.endCursor).toBe('ticket-25');
    });

    it('handles empty collection gracefully', () => {
      const emptyPage = paginateTickets([], 10);
      expect(emptyPage.nodes).toHaveLength(0);
      expect(emptyPage.pageInfo.hasNextPage).toBe(false);
      expect(emptyPage.pageInfo.endCursor).toBeNull();
    });
  });
});

