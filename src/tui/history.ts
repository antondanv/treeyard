/**
 * Undo. Before a change the files of the tree are read, after it they are
 * read again; undoing puts back only the files that are still the way the
 * change left them. An agent writing to the tree in between keeps its work:
 * a file it touched is not rolled back over its head.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWrite, TREE_DIR } from '../model/store.js';

type Files = Map<string, string>;

export interface Step {
  label: string;
  before: Files;
  after: Files;
}

function files(dir: string): Files {
  const out: Files = new Map();
  const root = join(dir, TREE_DIR);
  const read = (path: string) => {
    try {
      out.set(path, readFileSync(path, 'utf8'));
    } catch {
      // Gone between listing and reading.
    }
  };
  read(join(root, 'tree.md'));
  let names: string[] = [];
  try {
    names = readdirSync(join(root, 'nodes'));
  } catch {
    // No nodes yet.
  }
  for (const name of names) if (name.endsWith('.md')) read(join(root, 'nodes', name));
  return out;
}

export class History {
  readonly #dir: string;
  readonly #steps: Step[] = [];
  readonly #limit: number;

  constructor(dir: string, limit = 50) {
    this.#dir = dir;
    this.#limit = limit;
  }

  get size(): number {
    return this.#steps.length;
  }

  get last(): string | undefined {
    return this.#steps.at(-1)?.label;
  }

  /** Runs a change and remembers how to take it back. */
  record<T>(label: string, change: () => T): T {
    const before = files(this.#dir);
    const result = change();
    const after = files(this.#dir);
    if (!same(before, after)) {
      this.#steps.push({ label, before, after });
      if (this.#steps.length > this.#limit) this.#steps.shift();
    }
    return result;
  }

  /** Takes back the last change. Returns what was undone and what could not be, or undefined when there is nothing. */
  undo(): { label: string; skipped: number } | undefined {
    const step = this.#steps.pop();
    if (!step) return undefined;
    const now = files(this.#dir);
    let skipped = 0;
    const paths = new Set([...step.before.keys(), ...step.after.keys()]);
    for (const path of paths) {
      const was = step.before.get(path);
      const became = step.after.get(path);
      if (was === became) continue;
      // Someone changed it after us: theirs is newer, leave it.
      if (now.get(path) !== became) {
        skipped += 1;
        continue;
      }
      if (was === undefined) {
        if (existsSync(path)) rmSync(path);
      } else atomicWrite(path, was);
    }
    return { label: step.label, skipped };
  }
}

function same(a: Files, b: Files): boolean {
  if (a.size !== b.size) return false;
  for (const [path, text] of a) if (b.get(path) !== text) return false;
  return true;
}
