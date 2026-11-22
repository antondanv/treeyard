import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setLang } from '../src/i18n/i18n.js';
import { DRIVER_COMMAND, driverCommand } from '../src/merge-driver.js';
import { addNode, deleteNode, setStatus, updateNode } from '../src/model/ops.js';
import { overviewText } from '../src/model/overview.js';
import { mergeOverviews } from '../src/model/overview-merge.js';
import { loadTree } from '../src/model/store.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { tempDir, tsx } from './helpers.js';

// The machine's own git config must not leak in.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const [key, value] of Object.entries(GIT_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
/** A merge or a rebase that may stop on a conflict: the exit code and the files left unmerged. */
const attempt = (dir: string, ...args: string[]) => {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return { code: result.status, conflicts: git(dir, 'diff', '--name-only', '--diff-filter=U') };
};
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const readme = (dir: string) => readFileSync(join(dir, '.tree', 'README.md'), 'utf8');
const commitAll = (dir: string, message: string) => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
};

/**
 * A repository with a committed tree and two branches off it that change different nodes: each
 * moves the counters at the top and the progress of the same parent, and each adds a child to
 * that parent — a line-by-line merge of the overview conflicts.
 */
function twoBranches() {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  createTree(dir, getTemplate('directions')!, { title: 'Тест', answers: { goal: 'всё работает' }, skeleton: false });
  let tree = loadTree(dir);
  const release = addNode(tree, { title: 'Релиз' }).id;
  const docs = addNode(tree, { title: 'Документация', parent: release }).id;
  const tests = addNode(tree, { title: 'Тесты', parent: release }).id;
  const site = addNode(tree, { title: 'Сайт' }).id;
  commitAll(dir, 'start');

  git(dir, 'checkout', '-q', '-b', 'feature');
  tree = loadTree(dir);
  setStatus(tree, docs, 'done');
  updateNode(tree, site, { title: 'Сайт проекта' });
  addNode(tree, { title: 'Яндекс-метрика', parent: release });
  commitAll(dir, 'feature');

  git(dir, 'checkout', '-q', 'main');
  tree = loadTree(dir);
  setStatus(tree, tests, 'review');
  setStatus(tree, site, 'waiting', { waiting: 'домен' });
  addNode(tree, { title: 'Бета-тест', parent: release, who: 'human' });
  addNode(tree, { title: 'Блог', status: 'idea' });
  commitAll(dir, 'main');
  return dir;
}

/** The driver as git would run it, from this checkout's sources rather than a treeyard on PATH. */
function useSourceDriver(dir: string) {
  expect(driverCommand(dir)).toBe(DRIVER_COMMAND);
  git(
    dir,
    'config',
    'merge.treeyard.driver',
    `'${process.execPath}' --import '${tsx}' '${cli}' merge-overview %O %A %B`,
  );
}

describe('merging branches that change different nodes', () => {
  it('the first write in a repository puts the driver in place: .tree/.gitattributes and the config', () => {
    const dir = twoBranches();
    expect(readFileSync(join(dir, '.tree', '.gitattributes'), 'utf8')).toContain('README.md merge=treeyard');
    expect(git(dir, 'check-attr', 'merge', '--', '.tree/README.md')).toBe('.tree/README.md: merge: treeyard');
    expect(driverCommand(dir)).toBe(DRIVER_COMMAND);
    // Committed with the tree: a clone has it too.
    expect(git(dir, 'ls-files', '.tree/.gitattributes')).toBe('.tree/.gitattributes');
  });

  it('without the driver the overview conflicts — the case this is all about', () => {
    const dir = twoBranches();
    git(dir, 'config', '--remove-section', 'merge.treeyard');
    const merge = attempt(dir, 'merge', '-q', '--no-edit', 'feature');
    expect(merge.code).not.toBe(0);
    expect(merge.conflicts).toBe('.tree/README.md');
  });

  it('git merge goes through without conflicts, and the overview is the one of the merged nodes', () => {
    const dir = twoBranches();
    useSourceDriver(dir);
    const merge = attempt(dir, 'merge', '-q', '--no-edit', 'feature');
    expect(merge).toEqual({ code: 0, conflicts: '' });
    expect(git(dir, 'status', '--porcelain')).toBe('');
    const merged = loadTree(dir);
    expect(readme(dir)).toBe(overviewText(merged));
    // Both sides are in it, the counters counted anew.
    const text = readme(dir);
    for (const part of [
      '✓ [Документация]',
      '◎ [Тесты]',
      '[Сайт проекта]',
      'ждёт: домен',
      '[Яндекс-метрика]',
      '[Бета-тест]',
      '*ты*',
      '◇ [Блог]',
    ])
      expect(text).toContain(part);
    expect(text).toContain('Готово 1 из 5 · в работе 0 · на проверке 1 · ждут 1 · идей 1');
    expect(text).toContain('[Релиз](');
    expect(text).toMatch(/\[Релиз\]\(nodes\/\w+\.md\) — 1\/4/);
  });

  it('the other way round too: main merged into the feature branch', () => {
    const dir = twoBranches();
    useSourceDriver(dir);
    git(dir, 'checkout', '-q', 'feature');
    expect(attempt(dir, 'merge', '-q', '--no-edit', 'main')).toEqual({ code: 0, conflicts: '' });
    expect(readme(dir)).toBe(overviewText(loadTree(dir)));
  });

  it('a rebase onto the other branch goes through as well', () => {
    const dir = twoBranches();
    useSourceDriver(dir);
    git(dir, 'checkout', '-q', 'feature');
    const rebase = attempt(dir, 'rebase', '-q', 'main');
    expect(rebase).toEqual({ code: 0, conflicts: '' });
    expect(readme(dir)).toBe(overviewText(loadTree(dir)));
  });
});

describe('mergeOverviews', () => {
  const versions = () => {
    const dir = twoBranches();
    const at = (ref: string) => git(dir, 'show', `${ref}:.tree/README.md`);
    return { dir, base: `${at('main~1')}\n`, ours: `${at('main')}\n`, theirs: `${at('feature')}\n` };
  };

  it('leaves an overview it cannot read back to git: a hand edit is not guessed at', () => {
    const { base, ours, theirs } = versions();
    expect(mergeOverviews(base, ours, theirs)).toBeDefined();
    expect(mergeOverviews(base, `${ours}\nкто-то дописал руками\n`, theirs)).toBeUndefined();
  });

  it('reads an overview in the other language', () => {
    const { base, ours, theirs } = versions();
    const russian = mergeOverviews(base, ours, theirs);
    setLang('en');
    try {
      expect(mergeOverviews(base, ours, theirs)).toBe(russian);
    } finally {
      setLang('ru');
    }
  });

  it('a node removed on one side goes when the other did not touch it, and stays when it did', () => {
    const { dir, base, ours, theirs } = versions();
    git(dir, 'checkout', '-q', '-b', 'removal', 'main~1');
    const tree = loadTree(dir);
    const site = [...tree.nodes.values()].find((node) => node.title === 'Сайт')!.id;
    const tests = [...tree.nodes.values()].find((node) => node.title === 'Тесты')!.id;
    deleteNode(tree, tests);
    const untouched = readme(dir);
    expect(mergeOverviews(base, untouched, theirs)).not.toContain(tests);
    deleteNode(loadTree(dir), site);
    // Ours (main) changed «Сайт», this side removed it: it stays, and so does the conflict in its file.
    expect(mergeOverviews(base, readme(dir), ours)).toContain(site);
  });

  it('an empty base (both sides added the overview) merges too', () => {
    const { ours, theirs } = versions();
    expect(mergeOverviews('', ours, theirs)).toBeDefined();
  });
});
