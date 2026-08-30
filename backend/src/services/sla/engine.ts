import {
  addDays,
  addMinutes,
  differenceInMinutes,
  isWeekend,
  isBefore,
  isAfter,
  set
} from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export type Holiday = { date: Date };

export const BUSINESS_START_HOUR = 9;
export const BUSINESS_END_HOUR = 18;
export const BUSINESS_HOURS_PER_DAY = BUSINESS_END_HOUR - BUSINESS_START_HOUR;

export function isHoliday(date: Date, holidays: Holiday[], timeZone: string): boolean {
  const dateStr = formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
  return holidays.some(h => formatInTimeZone(h.date, timeZone, 'yyyy-MM-dd') === dateStr);
}

export function isBusinessDay(date: Date, holidays: Holiday[], timeZone: string): boolean {
  const zonedDate = toZonedTime(date, timeZone);
  if (isWeekend(zonedDate)) return false;
  return !isHoliday(date, holidays, timeZone);
}

export function getBusinessDayBounds(date: Date, timeZone: string): { start: Date; end: Date } {
  const zoned = toZonedTime(date, timeZone);
  const startZoned = set(zoned, { hours: BUSINESS_START_HOUR, minutes: 0, seconds: 0, milliseconds: 0 });
  const endZoned = set(zoned, { hours: BUSINESS_END_HOUR, minutes: 0, seconds: 0, milliseconds: 0 });
  return {
    start: fromZonedTime(startZoned, timeZone),
    end: fromZonedTime(endZoned, timeZone)
  };
}

export function advanceToNextBusinessDayStart(date: Date, holidays: Holiday[], timeZone: string): Date {
  let nextDay = addDays(date, 1);
  while (!isBusinessDay(nextDay, holidays, timeZone)) {
    nextDay = addDays(nextDay, 1);
  }
  return getBusinessDayBounds(nextDay, timeZone).start;
}

export function calculateSlaTarget(startDate: Date, businessHours: number, holidays: Holiday[], timeZone: string): Date {
  let remainingMinutes = businessHours * 60;
  let currentDate = startDate;

  if (!isBusinessDay(currentDate, holidays, timeZone)) {
      currentDate = advanceToNextBusinessDayStart(currentDate, holidays, timeZone);
  } else {
      const { start, end } = getBusinessDayBounds(currentDate, timeZone);
      if (isBefore(currentDate, start)) {
          currentDate = start;
      } else if (!isBefore(currentDate, end)) {
          currentDate = advanceToNextBusinessDayStart(currentDate, holidays, timeZone);
      }
  }

  while (remainingMinutes > 0) {
    const { end } = getBusinessDayBounds(currentDate, timeZone);
    const minutesToEod = differenceInMinutes(end, currentDate);

    if (remainingMinutes <= minutesToEod) {
      return addMinutes(currentDate, remainingMinutes);
    }

    remainingMinutes -= minutesToEod;
    currentDate = advanceToNextBusinessDayStart(currentDate, holidays, timeZone);
  }

  return currentDate;
}

export function calculateRemainingBusinessMinutes(targetDate: Date, currentDate: Date, holidays: Holiday[], timeZone: string): number {
  if (isAfter(currentDate, targetDate) || currentDate.getTime() === targetDate.getTime()) return 0;
  
  let remaining = 0;
  let current = currentDate;

  if (!isBusinessDay(current, holidays, timeZone)) {
    current = advanceToNextBusinessDayStart(current, holidays, timeZone);
  } else {
    const { start, end } = getBusinessDayBounds(current, timeZone);
    if (isBefore(current, start)) {
      current = start;
    } else if (!isBefore(current, end)) {
      current = advanceToNextBusinessDayStart(current, holidays, timeZone);
    }
  }

  while (isBefore(current, targetDate)) {
    const { end } = getBusinessDayBounds(current, timeZone);
    
    const isSameLocalDay = formatInTimeZone(current, timeZone, 'yyyy-MM-dd') === formatInTimeZone(targetDate, timeZone, 'yyyy-MM-dd');

    if (isSameLocalDay) {
        remaining += differenceInMinutes(targetDate, current);
        break;
    } else {
        remaining += differenceInMinutes(end, current);
        current = advanceToNextBusinessDayStart(current, holidays, timeZone);
    }
  }

  return Math.max(0, remaining);
}

export type SLAState = 'ON_TRACK' | 'AT_RISK' | 'BREACHED';

export function getSlaState(totalBudgetMinutes: number, remainingMinutes: number): SLAState {
  if (remainingMinutes <= 0) return 'BREACHED';
  const consumedMinutes = totalBudgetMinutes - remainingMinutes;
  const consumedPercentage = consumedMinutes / totalBudgetMinutes;
  
  if (consumedPercentage > 0.75) {
    return 'AT_RISK';
  }
  return 'ON_TRACK';
}
