import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { createTree, getTemplate } from '../src/templates/templates.js';

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export function tempDir(prefix = 'treeyard-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** A fresh tree with no nodes, from the `directions` template without its skeleton. */
export function emptyTree(): Tree {
  const dir = tempDir();
  createTree(dir, getTemplate('directions')!, { title: 'Тест', answers: { goal: 'всё работает' }, skeleton: false });
  return loadTree(dir);
}
