import { describe, it, expect } from 'vitest';
import { 
  calculateSlaTarget, 
  calculateRemainingBusinessMinutes,
  getSlaState,
  Holiday
} from '../../src/services/sla/engine';

describe('SLA Engine', () => {
  const tz = 'Asia/Kolkata';
  const holidays: Holiday[] = [
    { date: new Date('2026-08-15T00:00:00Z') } // Saturday (Independence Day)
  ];

  it('Normal weekday calculation (created in business hours)', () => {
    // Monday, Aug 10, 2026 10:00 AM IST
    const startDate = new Date('2026-08-10T10:00:00+05:30');
    const target = calculateSlaTarget(startDate, 4, holidays, tz);
    expect(target.toISOString()).toBe(new Date('2026-08-10T14:00:00+05:30').toISOString());
  });

  it('Ticket created before business hours', () => {
    const startDate = new Date('2026-08-10T07:00:00+05:30');
    const target = calculateSlaTarget(startDate, 4, holidays, tz);
    expect(target.toISOString()).toBe(new Date('2026-08-10T13:00:00+05:30').toISOString());
  });

  it('Ticket created after business hours', () => {
    const startDate = new Date('2026-08-10T20:00:00+05:30');
    const target = calculateSlaTarget(startDate, 4, holidays, tz);
    expect(target.toISOString()).toBe(new Date('2026-08-11T13:00:00+05:30').toISOString());
  });

  it('Weekend', () => {
    const startDate = new Date('2026-08-15T10:00:00+05:30'); // Saturday
    const target = calculateSlaTarget(startDate, 4, holidays, tz);
    expect(target.toISOString()).toBe(new Date('2026-08-17T13:00:00+05:30').toISOString()); // Mon 13:00
  });

  it('Friday evening', () => {
    const startDate = new Date('2026-08-14T17:59:00+05:30'); // Friday
    const target = calculateSlaTarget(startDate, 4, holidays, tz);
    // Friday 17:59 to 18:00 = 1 min
    // Monday 09:00 + 3h 59m = Monday 12:59 IST
    expect(target.toISOString()).toBe(new Date('2026-08-17T12:59:00+05:30').toISOString());
  });

  it('Public holiday (Monday)', () => {
    const mondayHoliday = [{ date: new Date('2026-08-10T00:00:00Z') }];
    const startDate = new Date('2026-08-07T17:00:00+05:30'); // Friday
    const target = calculateSlaTarget(startDate, 4, mondayHoliday, tz);
    // Friday 17:00 to 18:00 = 1h
    // Monday is holiday
    // Tuesday 09:00 + 3h = Tuesday 12:00 IST
    expect(target.toISOString()).toBe(new Date('2026-08-11T12:00:00+05:30').toISOString());
  });

  it('SLA crossing multiple business days', () => {
    const startDate = new Date('2026-08-10T17:00:00+05:30'); // Monday
    const target = calculateSlaTarget(startDate, 24, holidays, tz);
    expect(target.toISOString()).toBe(new Date('2026-08-13T14:00:00+05:30').toISOString()); // Thursday 14:00
  });

  it('Remaining business minutes', () => {
    const start = new Date('2026-08-14T17:00:00+05:30'); // Friday 17:00
    const target = new Date('2026-08-17T12:00:00+05:30'); // Monday 12:00
    // Friday 17:00-18:00 (1h) + Monday 09:00-12:00 (3h) = 4h = 240 mins
    const mins = calculateRemainingBusinessMinutes(target, start, holidays, tz);
    expect(mins).toBe(240);
  });

  it('SLA State', () => {
    expect(getSlaState(240, 240)).toBe('ON_TRACK'); // 0%
    expect(getSlaState(240, 61)).toBe('ON_TRACK');  // 179/240 = 74.5%
    expect(getSlaState(240, 59)).toBe('AT_RISK');   // 181/240 = 75.4%
    expect(getSlaState(240, 0)).toBe('BREACHED');
    expect(getSlaState(240, -10)).toBe('BREACHED');
  });
});
