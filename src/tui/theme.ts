/**
 * Colours and marks. Hex colours degrade to the nearest the terminal has
 * (Apple Terminal: 256), so every colour here is picked to land on a good
 * one. Backgrounds mark the selection and changed code in diffs.
 *
 * Two palettes: dark terminals and light ones. `C` is changed in place when
 * the theme changes, and every component reads it while rendering, so the
 * switch shows on the next frame.
 */
import type { Status } from '../model/types.js';

export type Theme = 'dark' | 'light';

export const THEMES: readonly Theme[] = ['dark', 'light'];

const DARK = {
  brand: '#7ee2a8',
  brandDim: '#3f8f66',
  text: undefined as string | undefined,
  dim: 'gray',
  faint: '#5c6370',
  rule: '#3b4048',
  accent: '#8ab4ff',
  agent: '#c6a0ff',
  you: '#ffcf70',
  ok: '#5fd38d',
  warn: '#ffcf70',
  bad: '#ff7b72',
  idea: '#d2a8ff',
  review: '#62d0e0',
  /** The selected node: dark text on the brand colour. */
  pill: '#7ee2a8',
  pillText: '#0b1a12',
  diffAddedBg: '#102a10',
  diffRemovedBg: '#2a1010',
  diffAddedWordBg: '#008700',
  diffRemovedWordBg: '#870000',
  diffHunkBg: '#262626',
  diffWordText: '#ffffff',
};

const LIGHT: typeof DARK = {
  brand: '#13804f',
  brandDim: '#5aa77f',
  text: undefined,
  dim: '#6b7280',
  faint: '#9aa0a8',
  rule: '#d0d4da',
  accent: '#1f5fd1',
  agent: '#7b3fd6',
  you: '#a36200',
  ok: '#13804f',
  warn: '#a36200',
  bad: '#c4262e',
  idea: '#8a3fd1',
  review: '#0b7f8c',
  pill: '#13804f',
  pillText: '#ffffff',
  diffAddedBg: '#e6ffe6',
  diffRemovedBg: '#ffe6e6',
  diffAddedWordBg: '#afffaf',
  diffRemovedWordBg: '#ffafaf',
  diffHunkBg: '#eeeeee',
  diffWordText: '#111827',
};

export type Palette = typeof DARK;

export const C: Palette = { ...DARK };

export const STATUS_COLOR: Record<Status, string | undefined> = {
  idea: C.idea,
  todo: undefined,
  active: C.accent,
  waiting: C.warn,
  review: C.review,
  done: C.ok,
  dropped: C.faint,
};

let current: Theme = 'dark';

export function theme(): Theme {
  return current;
}

export function applyTheme(next: Theme): void {
  current = next;
  Object.assign(C, next === 'light' ? LIGHT : DARK);
  Object.assign(STATUS_COLOR, {
    idea: C.idea,
    todo: undefined,
    active: C.accent,
    waiting: C.warn,
    review: C.review,
    done: C.ok,
    dropped: C.faint,
  });
}

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
