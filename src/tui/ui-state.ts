/**
 * What the TUI remembers between launches: the open view, the selected node,
 * which branches are expanded. Per person, so it lives in `.tree/.local/`,
 * which the tree's own `.gitignore` keeps out of git.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { TREE_DIR } from '../model/store.js';

export type View = 'tree' | 'now' | 'waiting' | 'ideas' | 'sessions' | 'journal';

export const VIEWS: readonly View[] = ['tree', 'now', 'waiting', 'ideas', 'sessions', 'journal'];

export interface UiState {
  view: View;
  selected?: string;
  expanded: string[];
  showClosed: boolean;
  inspector?: boolean;
  /** The pane of a running session next to the tree. */
  terminal?: boolean;
  /** Share of the width the session pane takes. */
  split?: number;
  cardWidth?: number;
  /** The tree as a graph or as an indented list. */
  treeMode?: 'graph' | 'list';
  /** The graph's nodes as lines or as cards. */
  graphStyle?: 'line' | 'card';
}

export function defaultUi(): UiState {
  return { view: 'tree', expanded: [], showClosed: true };
}

function path(dir: string): string {
  return join(dir, TREE_DIR, '.local', 'ui.json');
}

export function loadUi(dir: string): UiState {
  try {
    const data = JSON.parse(readFileSync(path(dir), 'utf8')) as Partial<UiState>;
    const ui = defaultUi();
    if (data.view && (VIEWS as readonly string[]).includes(data.view)) ui.view = data.view;
    if (typeof data.selected === 'string') ui.selected = data.selected;
    if (Array.isArray(data.expanded)) ui.expanded = data.expanded.filter((id) => typeof id === 'string');
    if (typeof data.showClosed === 'boolean') ui.showClosed = data.showClosed;
    if (typeof data.inspector === 'boolean') ui.inspector = data.inspector;
    if (typeof data.terminal === 'boolean') ui.terminal = data.terminal;
    if (typeof data.split === 'number' && data.split >= 0.3 && data.split <= 0.8) ui.split = data.split;
    if (data.cardWidth && [20, 28, 36].includes(data.cardWidth)) ui.cardWidth = data.cardWidth;
    if (data.treeMode === 'graph' || data.treeMode === 'list') ui.treeMode = data.treeMode;
    if (data.graphStyle === 'line' || data.graphStyle === 'card') ui.graphStyle = data.graphStyle;
    return ui;
  } catch {
    return defaultUi();
  }
}

export function saveUi(dir: string, ui: UiState): void {
  try {
    mkdirSync(join(dir, TREE_DIR, '.local'), { recursive: true });
    writeFileSync(path(dir), JSON.stringify(ui));
  } catch {
    // Remembering where you were is a courtesy, not a duty.
  }
}
