/**
 * The mark: three leaves in the colours of the tree's own statuses — done,
 * in work, waiting — joined by branches into one trunk. The product in
 * miniature: work merging up into a goal.
 *
 * Drawn with heavy box-drawing lines and dots, not pixels: a terminal draws
 * those crisply in any font, any palette (Apple Terminal gives 256 colours)
 * and on a translucent background, which a raster image cannot survive.
 */
import { Box, Text } from 'ink';

import { C } from './theme.js';

export const WORDMARK = 'treeyard';

/** A piece of the drawing and the palette entry it is drawn in (looked up while rendering: themes change). */
type Part = [text: string, color: keyof typeof C | ''];

/** Four rows: a branch with two leaves, a lone leaf, both into the trunk. */
const FULL: Part[][] = [
  [
    ['●', 'ok'],
    ['   ', ''],
    ['●', 'accent'],
    ['   ', ''],
    ['●', 'warn'],
  ],
  [
    ['┗━┳━┛', 'brand'],
    ['   ', ''],
    ['┃', 'brand'],
  ],
  [
    ['  ', ''],
    ['┗━━┳━━┛', 'brand'],
  ],
  [
    ['     ', ''],
    ['┃', 'brand'],
  ],
];

/** Three rows, for short terminals. */
const COMPACT: Part[][] = [
  [
    ['●', 'ok'],
    ['  ', ''],
    ['●', 'accent'],
    ['  ', ''],
    ['●', 'warn'],
  ],
  [['┗━━╋━━┛', 'brand']],
  [
    ['   ', ''],
    ['┃', 'brand'],
  ],
];

/** Each piece with a stable key, made once. */
function keyed(rows: Part[][]): { key: string; parts: { key: string; text: string; color: Part[1] }[] }[] {
  return rows.map((parts, y) => ({
    key: `row${y}`,
    parts: parts.map(([text, color], x) => ({ key: `${y}.${x}`, text, color })),
  }));
}

const FULL_KEYED = keyed(FULL);
const COMPACT_KEYED = keyed(COMPACT);

export function logoSize(compact = false): { columns: number; rows: number } {
  return compact ? { columns: 7, rows: 3 } : { columns: 9, rows: 4 };
}

/**
 * `pulse` — an agent is working: the leaf of work in progress breathes
 * between its own colour and the agents' violet.
 */
export function Logo(props: { compact?: boolean; pulse?: number | undefined }) {
  const rows = props.compact ? COMPACT_KEYED : FULL_KEYED;
  const { columns } = logoSize(props.compact);
  const breathing = props.pulse !== undefined && Math.floor(props.pulse / 6) % 2 === 1;
  const colour = (color: Part[1]) =>
    breathing && color === 'accent' ? C.agent : color ? (C[color] ?? undefined) : undefined;
  return (
    <Box flexDirection="column" width={columns} flexShrink={0}>
      {rows.map((row) => (
        <Text key={row.key}>
          {row.parts.map((part) => (
            <Text key={part.key} color={colour(part.color)}>
              {part.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

/** One line, for banners: the mark's crown and the name. */
export function inlineMark(color: (hex: string, text: string) => string): string {
  return `${color(C.ok, '●')}${color(C.accent, '●')}${color(C.warn, '●')} ${color(C.brand, WORDMARK)}`;
}
