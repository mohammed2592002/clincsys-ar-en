/**
 * Helper utilities for appointment time validation and conflict detection.
 */

/**
 * Extract 24-hour hour integer (0-23) from a time string.
 * Supports formats like: "10:00", "10:30", "10:00 AM", "10:00 PM", "10:00 ص", "10:00 م", "10".
 */
export function parseHourFromTime(timeStr: string | undefined | null): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const str = timeStr.trim();
  if (!str) return null;

  const isPM = /pm|م|مساء/i.test(str);
  const isAM = /am|ص|صباحا|صباحاً/i.test(str);

  const match = str.match(/(\d{1,2})(?::(\d{1,2}))?/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  if (isNaN(hour)) return null;

  if (isPM && hour < 12) {
    hour += 12;
  } else if (isAM && hour === 12) {
    hour = 0;
  }

  return hour;
}

/**
 * Checks if two appointment times conflict (either exact same time or same 1-hour time block).
 */
export function isAppointmentTimeConflict(existingTime: string | undefined | null, newTime: string | undefined | null): boolean {
  if (!existingTime || !newTime) return false;

  const cleanE = existingTime.trim().toLowerCase();
  const cleanN = newTime.trim().toLowerCase();

  // 1. Exact string match
  if (cleanE === cleanN) return true;

  // 2. Extract hours
  const hourE = parseHourFromTime(existingTime);
  const hourN = parseHourFromTime(newTime);

  // If both hours are valid and identical, they fall in the same hour block (e.g. 10:00 and 10:30)
  if (hourE !== null && hourN !== null && hourE === hourN) {
    return true;
  }

  return false;
}
