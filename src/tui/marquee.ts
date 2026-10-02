/**
 * A title that does not fit runs while its node is selected, back and forth:
 * it rests at the start with an ellipsis, eases into motion, slows down at the
 * end and rests there, then travels back the same way. Counted in terminal
 * columns, so wide characters and emoji never break in half.
 *
 * A terminal moves text a whole column at a time; what makes it smooth is an
 * even, unhurried pace with a gentle start and stop — not a jump back.
 */
import stringWidth from 'string-width';

/** How often the clock ticks, ms. Fine enough that every column lands on time. */
export const MARQUEE_TICK = 60;
/** Rest at each end, ms. */
const REST = 1600;
/** Average pace, ms per column; the ends are slower, the middle a little faster. */
const PER_COLUMN = 320;
/** No trip is shorter than this, ms: a short overflow does not twitch. */
const MIN_TRAVEL = 1400;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** How far the text has moved, in columns, `ms` after the title was selected. */
export function marqueeOffset(overflow: number, ms: number): number {
  if (overflow <= 0) return 0;
  const travel = Math.max(MIN_TRAVEL, overflow * PER_COLUMN);
  const cycle = 2 * REST + 2 * travel;
  const t = ((ms % cycle) + cycle) % cycle;
  // Rest at the start, there, rest at the end, back.
  if (t < REST) return 0;
  if (t < REST + travel) return Math.round(ease((t - REST) / travel) * overflow);
  if (t < 2 * REST + travel) return overflow;
  return Math.round((1 - ease((t - 2 * REST - travel) / travel)) * overflow);
}

/** Slow out of the rest, slow into the next one. */
function ease(p: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, p)));
}

/** The part of `text` that `width` columns show `ms` after selection; the text itself when it fits. */
export function marquee(text: string, width: number, ms: number): string {
  if (width <= 0) return '';
  const full = stringWidth(text);
  if (full <= width) return text;
  const overflow = full - width;
  const offset = marqueeOffset(overflow, ms);
  // At rest an ellipsis says which way the rest of the title is.
  if (offset === 0) return `${columns(text, 0, width - 1)}…`;
  if (offset === overflow) return `…${columns(text, overflow + 1, width - 1)}`;
  return columns(text, offset, width);
}

/** Columns `from` … `from + width` of a text; a wide character cut by an edge becomes a space. */
export function columns(text: string, from: number, width: number): string {
  let out = '';
  let col = 0;
  let taken = 0;
  for (const { segment } of graphemes.segment(text)) {
    const size = stringWidth(segment);
    if (col + size <= from) {
      col += size;
      continue;
    }
    if (col < from) {
      // Half of a wide character before the window: a space keeps the columns.
      out += ' '.repeat(col + size - from);
      taken += col + size - from;
      col += size;
      continue;
    }
    if (taken + size > width) {
      out += ' '.repeat(width - taken);
      return out;
    }
    out += segment;
    taken += size;
    col += size;
    if (taken === width) return out;
  }
  return out;
}

/** Whether a title needs the ticker at all. */
export function overflows(text: string, width: number): boolean {
  return stringWidth(text) > width;
}
