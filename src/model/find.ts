/**
 * Search across the whole tree, finished work included: titles, criteria,
 * checks, what a node waits for, descriptions and journals. It replaces
 * `grep` over `.tree/nodes/*.md` and over the output of `show`.
 */
import { parseEntry } from './history.js';
import { description, journalEntries } from './journal.js';
import { descendants } from './tree.js';
import { ROOT, type Status, type Tree, type TreeNode } from './types.js';

export type FindField = 'title' | 'id' | 'done_when' | 'check' | 'waiting' | 'note' | 'journal';

export interface FindHit {
  field: FindField;
  /** A piece of the text around the match, on one line. */
  snippet: string;
  /** Where the match is inside `snippet`. */
  at: number;
  length: number;
  /** The journal entry's time, for a hit in the journal. */
  when?: string;
}

export interface Found {
  node: TreeNode;
  hits: FindHit[];
}

export interface FindOptions {
  statuses?: readonly Status[];
  /** Only this branch; the root by default. */
  under?: string;
}

/** Case, `ё` and runs of spaces do not matter. Length-preserving, so positions map back to the text. */
function fold(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/\s/g, ' ');
}

/** `a|b`: alternatives, as in `grep -E`; each one is plain text, not a pattern. */
export function queryParts(query: string): string[] {
  return query
    .split('|')
    .map((part) => fold(part.trim()))
    .filter(Boolean);
}

const AROUND = 48;

/** The first match of any alternative in `text`, with a snippet around it. */
function hitIn(text: string, parts: readonly string[], field: FindField): FindHit | undefined {
  const flat = text.replace(/\s+/g, ' ').trim();
  const folded = fold(flat);
  // Fold changed the length (a rare letter): search what is shown.
  const shown = folded.length === flat.length ? flat : folded;
  let best: { at: number; length: number } | undefined;
  for (const part of parts) {
    const at = folded.indexOf(part);
    if (at >= 0 && (!best || at < best.at)) best = { at, length: part.length };
  }
  if (!best) return undefined;
  const from = Math.max(0, best.at - AROUND);
  const to = Math.min(shown.length, best.at + best.length + AROUND);
  const head = from > 0 ? '…' : '';
  const tail = to < shown.length ? '…' : '';
  return {
    field,
    snippet: `${head}${shown.slice(from, to)}${tail}`,
    at: best.at - from + head.length,
    length: best.length,
  };
}

/** Every node that mentions the query, title matches first; within each group, in tree order. */
export function findNodes(tree: Tree, query: string, options: FindOptions = {}): Found[] {
  const parts = queryParts(query);
  if (!parts.length) return [];
  const titled: Found[] = [];
  const other: Found[] = [];
  for (const node of descendants(tree, options.under ?? ROOT)) {
    if (options.statuses && !options.statuses.includes(node.status)) continue;
    const hits: FindHit[] = [];
    const add = (text: string | undefined, field: FindField, when?: string) => {
      if (!text) return false;
      const hit = hitIn(text, parts, field);
      if (hit) hits.push(when ? { ...hit, when } : hit);
      return Boolean(hit);
    };
    const inTitle = add(node.title, 'title') || parts.includes(node.id);
    add(node.doneWhen, 'done_when');
    add(node.check, 'check');
    add([node.waiting, node.until].filter(Boolean).join(' → '), 'waiting');
    add(description(node.body), 'note');
    // The latest journal entries say the most: two of them at most.
    let fromJournal = 0;
    for (const line of journalEntries(node.body).reverse()) {
      const entry = parseEntry(line);
      if (add(entry.text, 'journal', entry.when) && ++fromJournal === 2) break;
    }
    if (!inTitle && !hits.length) continue;
    (inTitle ? titled : other).push({ node, hits });
  }
  return [...titled, ...other];
}
