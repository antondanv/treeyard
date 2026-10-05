/** Shorten context before the selected title, counting terminal columns. */
import stringWidth from 'string-width';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function clip(value: string, width: number): string {
  if (width <= 0) return '';
  if (stringWidth(value) <= width) return value;
  let result = '';
  let taken = 0;
  for (const { segment } of graphemes.segment(value)) {
    const size = stringWidth(segment);
    if (taken + size > width - 1) break;
    result += segment;
    taken += size;
  }
  return `${result}…`;
}

/** The ancestors use only the space left after the title and status. */
export function breadcrumb(ancestors: string[], width: number): string {
  if (!ancestors.length) return '';
  const full = `${ancestors.join(' › ')} › `;
  if (stringWidth(full) <= width) return full;
  const omitted = '… › ';
  if (width < stringWidth(omitted)) return '';
  for (let start = 1; start < ancestors.length; start++) {
    const tail = `${omitted}${ancestors.slice(start).join(' › ')} › `;
    if (stringWidth(tail) <= width) return tail;
  }
  return omitted;
}
