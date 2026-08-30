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
});
