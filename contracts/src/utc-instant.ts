// Shared `UtcInstant` helpers for WI-02 cross-field bindings. The generated
// schemas already enforce the `common.utcInstant` shape; the bindings below
// additionally have to *order* instants, which `Date.parse` cannot do without
// losing sub-second precision.

export interface ParsedUtcInstant {
  readonly wholeSecondMilliseconds: number;
  readonly fraction: string;
}

const utcInstantPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

export function parseUtcInstant(value: string): ParsedUtcInstant | undefined {
  const match = utcInstantPattern.exec(value);
  if (match === null) return undefined;
  const wholeSecondMilliseconds = Date.parse(`${match[1]}Z`);
  if (Number.isNaN(wholeSecondMilliseconds)) return undefined;
  return { wholeSecondMilliseconds, fraction: match[2] ?? '' };
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
