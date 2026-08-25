/**
 * All money is stored and passed around as an integer number of *minor units*
 * (satang for THB). Floats are never used for arithmetic — 1200/3 in float
 * gives 400.00000000000006, and three of those do not add back to 1200.
 */

export const MINOR_PER_MAJOR = 100;

/** Parse user input like "1200", "1,200", "1200.50", "฿1200" into satang. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[฿,\s]/g, '').replace(/บาท$/u, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const minor = Number(whole) * MINOR_PER_MAJOR + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return minor;
}

/** Render satang as a human string: 120050 -> "1,200.50", 120000 -> "1,200". */
export function formatAmount(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_PER_MAJOR);
  const frac = abs % MINOR_PER_MAJOR;
  const wholeStr = whole.toLocaleString('en-US');
  const body = frac === 0 ? wholeStr : `${wholeStr}.${String(frac).padStart(2, '0')}`;
  return negative ? `-${body}` : body;
}

/**
 * Split `totalMinor` across `count` people as evenly as possible.
 *
 * The remainder cannot be divided, so the first `remainder` people each pay one
 * extra satang. The result always sums back to exactly `totalMinor`.
 */
export function splitEvenly(totalMinor: number, count: number): number[] {
  if (count <= 0) throw new RangeError('cannot split between zero people');
  const base = Math.floor(totalMinor / count);
  const remainder = totalMinor - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Split with some people pinned to explicit amounts; everyone else divides
 * whatever is left. Returns null if the fixed amounts already exceed the total,
 * or if they don't add up to the total when nobody is left to absorb the rest.
 */
export function splitWithFixed(
  totalMinor: number,
  fixed: (number | null)[],
): number[] | null {
  const fixedSum = fixed.reduce<number>((acc, v) => acc + (v ?? 0), 0);
  const flexibleIndexes = fixed.flatMap((v, i) => (v === null ? [i] : []));

  if (flexibleIndexes.length === 0) {
    return fixedSum === totalMinor ? (fixed as number[]) : null;
  }
  const rest = totalMinor - fixedSum;
  if (rest < 0) return null;

  const shares = splitEvenly(rest, flexibleIndexes.length);
  const out = fixed.slice() as number[];
  flexibleIndexes.forEach((target, i) => {
    out[target] = shares[i]!;
  });
  return out;
}
