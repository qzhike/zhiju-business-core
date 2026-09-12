// Shared `UtcInstant` helpers for WI-02 cross-field bindings. The generated
// schemas already enforce the `common.utcInstant` shape; the bindings below
// additionally have to *order* instants, which `Date.parse` cannot do without
// losing sub-second precision.

export interface ParsedUtcInstant {
  readonly wholeSecondMilliseconds: number;
  readonly fraction: string;
}

const utcInstantPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return monthLengths[month - 1] ?? 0;
}

/**
 * Parses a `UtcInstant` without letting the runtime normalize an invalid
 * input. `Date.parse` accepts non-existent calendar dates such as
 * `2026-02-30T00:00:00Z` and silently rolls them over to March 2, which would
 * let a malformed expiry pass as a real bound. Every component is range
 * checked here instead, so a rejected instant never reaches an ordering or
 * mirror comparison.
 */
export function parseUtcInstant(value: string): ParsedUtcInstant | undefined {
  const match = utcInstantPattern.exec(value);
  const timestamp = match?.[1];
  if (timestamp === undefined) return undefined;

  // Fixed-width digits are guaranteed by the anchored pattern, so these slices
  // are always in range and numeric.
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(5, 7));
  const day = Number(timestamp.slice(8, 10));
  const hour = Number(timestamp.slice(11, 13));
  const minute = Number(timestamp.slice(14, 16));
  const second = Number(timestamp.slice(17, 19));
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  // Component construction keeps years below 100 intact; `Date.UTC` would map
  // them into the 1900s.
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, 0);
  return { wholeSecondMilliseconds: instant.getTime(), fraction: match?.[2] ?? '' };
}

/**
 * Compares two `UtcInstant` values exactly, including fractional seconds of
 * different lengths. Returns `undefined` when either side is not parseable so
 * callers fail closed instead of treating an invalid instant as "equal".
 */
export function compareUtcInstants(left: string, right: string): -1 | 0 | 1 | undefined {
  const leftParsed = parseUtcInstant(left);
  const rightParsed = parseUtcInstant(right);
  if (leftParsed === undefined || rightParsed === undefined) return undefined;
  if (leftParsed.wholeSecondMilliseconds < rightParsed.wholeSecondMilliseconds) return -1;
  if (leftParsed.wholeSecondMilliseconds > rightParsed.wholeSecondMilliseconds) return 1;

  const fractionLength = Math.max(leftParsed.fraction.length, rightParsed.fraction.length);
  const leftFraction = leftParsed.fraction.padEnd(fractionLength, '0');
  const rightFraction = rightParsed.fraction.padEnd(fractionLength, '0');
  if (leftFraction < rightFraction) return -1;
  if (leftFraction > rightFraction) return 1;
  return 0;
}
