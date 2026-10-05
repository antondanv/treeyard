import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { cleanup, render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contextText } from '../src/agents/context.js';
import { diffText, gitRepository } from '../src/git.js';
import { setLang } from '../src/i18n/i18n.js';
import { journalEntries } from '../src/model/journal.js';
import { addNode, attachCommit, detachCommit, updateNode } from '../src/model/ops.js';
import { loadTree, nodePath, writeNode } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { App } from '../src/tui/App.js';
import { History } from '../src/tui/history.js';
import { defaultUi } from '../src/tui/ui-state.js';
import { emptyTree, tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const git = (dir: string, ...args: string[]) =>
  execFileSync(
    'git',
    [
      '--literal-pathspecs',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      ...args,
    ],
    { cwd: dir, encoding: 'utf8' },
  ).trimEnd();

function repoTree() {
  const tree = emptyTree();
  git(tree.project.dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(tree.project.dir, '.gitignore'), '.tree/\nignored.txt\n');
  return tree;
}

function commitFile(dir: string, file: string, text: string, subject: string) {
  writeFileSync(join(dir, file), text);
  git(dir, 'add', '--', file, '.gitignore');
  git(dir, 'commit', '-q', '-m', subject);
  return git(dir, 'rev-parse', 'HEAD');
}

function intertwined() {
  const tree = repoTree();
  const dir = tree.project.dir;
  const a = addNode(tree, { title: 'Каталог' });
  const b = addNode(tree, { title: 'Корзина' });
  commitFile(dir, 'a.ts', 'base\n', 'base');
  const first = commitFile(dir, 'a.ts', 'catalog\n', 'catalog first');
  const other = commitFile(dir, 'b.ts', 'cart\n', 'cart work');
  const last = commitFile(dir, 'a.ts', 'catalog complete\n', 'catalog second');
  attachCommit(tree, a.id, first);
  attachCommit(tree, b.id, other);
  attachCommit(tree, a.id, last);
  return { tree, dir, a, b, first, other, last };
}

beforeEach(() => {
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS });
  setLang('ru');
});
afterEach(() => {
  cleanup();
  resetSettings({ ...DEFAULTS });
  setLang('ru');
});

describe('node commit links', () => {
  it('survives reload and other edits, logs only once, and supports removing and undoing a link', () => {
    const { tree, dir, a, last } = intertwined();
    const before = readFileSync(nodePath(dir, a.id), 'utf8');
    attachCommit(tree, a.id, last);
    expect(readFileSync(nodePath(dir, a.id), 'utf8')).toBe(before);
    updateNode(tree, a.id, { description: 'Проверить каталог' });
    const saved = loadTree(dir).nodes.get(a.id)!;
    expect(saved.commits).toEqual(a.commits);
    expect(journalEntries(saved.body).filter((line) => line.includes(last))).toHaveLength(1);
    const history = new History(dir);
    history.record('remove link', () => detachCommit(tree, a.id, last));
    expect(loadTree(dir).nodes.get(a.id)!.commits).not.toContain(last);
    history.undo();
    expect(loadTree(dir).nodes.get(a.id)!.commits).toContain(last);
    expect(contextText(tree, a.id)).toContain(`diff ${a.id} --add <sha>`);
  });
});

describe('Git patches', () => {
  it('reads individual commits without including the intervening work of another node', async () => {
    const { dir, a, first, last } = intertwined();
    const before = git(dir, 'status', '--porcelain=v1');
    const repo = await gitRepository(dir);
    const commits = await Promise.all(a.commits!.map((sha) => repo.commit(sha)));
    expect(commits.map((commit) => commit.sha)).toEqual([first, last]);
    for (const commit of commits) {
      const source = { kind: 'commit', commit } as const;
      expect((await repo.files(source)).map((file) => file.path)).toEqual(['a.ts']);
      expect(await repo.patch(source)).not.toContain('cart');
    }
    expect(git(dir, 'status', '--porcelain=v1')).toBe(before);
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(last);
  });

  it('handles the first commit, renames with tabs/newlines, deletion, binary data, and literal pathspecs', async () => {
    const tree = repoTree();
    const dir = tree.project.dir;
    const odd = 'old\tname\n.txt';
    const literal = ':(glob)*.txt';
    writeFileSync(join(dir, odd), 'keep this\n');
    writeFileSync(join(dir, literal), 'literal\n');
    writeFileSync(join(dir, 'gone.txt'), 'gone\n');
    writeFileSync(join(dir, 'binary.bin'), Buffer.from([0, 1, 2]));
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'first');
    const repo = await gitRepository(dir);
    const root = await repo.commit(git(dir, 'rev-parse', 'HEAD'));
    const rootSource = { kind: 'commit', commit: root } as const;
    expect(root.parents).toEqual([]);
    expect((await repo.files(rootSource)).find((file) => file.path === 'binary.bin')).toMatchObject({ binary: true });
    const exact = (await repo.files(rootSource)).find((file) => file.path === literal)!;
    expect(await repo.patch(rootSource, exact)).toContain('+literal');
    expect(await repo.patch(rootSource, exact)).not.toContain('+gone');
    renameSync(join(dir, odd), join(dir, 'new name.txt'));
    unlinkSync(join(dir, 'gone.txt'));
    writeFileSync(join(dir, 'binary.bin'), Buffer.from([0, 3, 4]));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'rename and delete');
    const source = { kind: 'commit', commit: await repo.commit(git(dir, 'rev-parse', 'HEAD')) } as const;
    const files = await repo.files(source);
    expect(files.find((file) => file.path === 'new name.txt')).toMatchObject({
      oldPath: odd,
      status: 'R100',
      added: 0,
      removed: 0,
    });
    expect(files.find((file) => file.path === 'gone.txt')).toMatchObject({ status: 'D', removed: 1 });
    expect(files.find((file) => file.path === 'binary.bin')?.binary).toBe(true);
    expect(
      await repo.patch(
        source,
        files.find((file) => file.path === 'new name.txt'),
      ),
    ).toContain('rename to new name.txt');
  });

  it('shows a merge relative to its first parent', async () => {
    const tree = repoTree();
    const dir = tree.project.dir;
    commitFile(dir, 'base.txt', 'base\n', 'base');
    git(dir, 'switch', '-q', '-c', 'side');
    commitFile(dir, 'side.txt', 'side\n', 'side');
    git(dir, 'switch', '-q', 'main');
    commitFile(dir, 'main.txt', 'main\n', 'main');
    git(dir, 'merge', '-q', '--no-edit', 'side');
    const repo = await gitRepository(dir);
    const source = { kind: 'commit', commit: await repo.commit(git(dir, 'rev-parse', 'HEAD')) } as const;
    expect(source.commit.parents).toHaveLength(2);
    expect((await repo.files(source)).map((file) => file.path)).toEqual(['side.txt']);
    expect(await repo.patch(source)).toContain('+side');
  });

  it('separates staged, unstaged and untracked files, including a repository with no commits', async () => {
    const tree = repoTree();
    const dir = tree.project.dir;
    const repo = await gitRepository(dir);
    writeFileSync(join(dir, 'a.ts'), 'initial\n');
    git(dir, 'add', 'a.ts');
    expect((await repo.working()).staged.find((file) => file.path === 'a.ts')).toMatchObject({ status: 'A', added: 1 });
    expect(await repo.recent()).toEqual([]);
    git(dir, 'commit', '-q', '-m', 'first');
    writeFileSync(join(dir, 'a.ts'), 'staged\n');
    git(dir, 'add', 'a.ts');
    writeFileSync(join(dir, 'a.ts'), 'unstaged\n');
    writeFileSync(join(dir, 'new file.ts'), 'new code\n');
    writeFileSync(join(dir, 'ignored.txt'), 'ignore\n');
    const files = await repo.working();
    expect(
      await repo.patch(
        { kind: 'staged' },
        files.staged.find((file) => file.path === 'a.ts'),
      ),
    ).toContain('+staged');
    expect(
      await repo.patch(
        { kind: 'unstaged' },
        files.unstaged.find((file) => file.path === 'a.ts'),
      ),
    ).toContain('+unstaged');
    expect(files.untracked.some((file) => file.path === 'ignored.txt')).toBe(false);
    expect(
      await repo.patch(
        { kind: 'untracked' },
        files.untracked.find((file) => file.path === 'new file.ts'),
      ),
    ).toContain('+new code');
  });

  it('finds the Git root from a subtree and rejects missing commits and option-like references', async () => {
    const { dir, last } = intertwined();
    mkdirSync(join(dir, 'nested'));
    const repo = await gitRepository(join(dir, 'nested'));
    expect(repo.dir).toBe(realpathSync(dir));
    expect((await repo.commit(last.slice(0, 8))).sha).toBe(last);
    await expect(repo.commit('deadbeef')).rejects.toThrow('не найден');
    await expect(repo.commit('--help')).rejects.toThrow('SHA');
    await expect(gitRepository(tempDir())).rejects.toThrow('нет Git-репозитория');
    expect(diffText('\u001b[31mcode\t\u0007')).toBe('\\x1b[31mcode    \\x07');
  });
});

describe('diff CLI', () => {
  const invoke = (dir: string, args: string[]) =>
    run(process.execPath, ['--import', tsx, cli, 'diff', ...args], { cwd: dir, env: process.env });
  it('attaches an abbreviated SHA, shows only that node, filters a file and removes an unavailable link', async () => {
    const { dir, tree, a, b, last } = intertwined();
    const fresh = addNode(tree, { title: 'Проверить каталог' });
    await invoke(dir, [fresh.id, '--add', last.slice(0, 8)]);
    expect(loadTree(dir).nodes.get(fresh.id)?.commits).toEqual([last]);
    const shown = await invoke(dir, [a.id]);
    expect(shown.stdout).toContain('+catalog complete');
    expect(shown.stdout).not.toContain('cart work');
    const json = JSON.parse((await invoke(dir, [b.id, '--json', '--file', 'b.ts'])).stdout);
    expect(json.sections[0].files[0].patch).toContain('+cart');
    expect((await invoke(dir, [fresh.id, '--stat'])).stdout).not.toContain('@@');
    fresh.commits = ['f'.repeat(40)];
    writeNode(dir, fresh);
    await invoke(dir, [fresh.id, '--rm', 'ffffffff']);
    expect(loadTree(dir).nodes.get(fresh.id)?.commits).toBeUndefined();
  });

  it('can attach from another folder and keeps working changes separate from node commits', async () => {
    const { dir, tree, a, first, last } = intertwined();
    const fresh = addNode(tree, { title: 'Новый узел' });
    await invoke(tempDir(), [fresh.id, '--project', dir, '--add', first]);
    expect(loadTree(dir).nodes.get(fresh.id)?.commits).toEqual([first]);
    writeFileSync(join(dir, 'a.ts'), 'still working\n');
    expect((await invoke(dir, [a.id, '--working'])).stdout).toContain('+still working');
    expect((await invoke(dir, [a.id, '--commit', last])).stdout).not.toContain('+still working');
    await expect(invoke(dir, [fresh.id, '--commit', last])).rejects.toMatchObject({ code: 2 });
    await expect(invoke(dir, [a.id, '--file', 'missing.ts'])).rejects.toMatchObject({ code: 2 });
  });
});

describe('diff TUI', () => {
  const waitFor = (app: ReturnType<typeof render>, text: string) =>
    vi.waitFor(
      () => {
        expect(app.lastFrame()).toContain(text);
        expect(app.lastFrame()).not.toContain('читаю Git…');
        expect(app.lastFrame()).not.toContain('reading Git…');
      },
      { timeout: 5000, interval: 20 },
    );
  it('explains a missing repository without claiming there are no changes and can retry after Git init', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Без Git' });
    const { DiffsDialog } = await import('../src/tui/diffs-dialog.js');
    const app = render(
      <DiffsDialog
        dir={tree.project.dir}
        node={node}
        width={97}
        height={24}
        onAttach={() => true}
        onDetach={() => true}
        onClose={() => {}}
      />,
    );
    await waitFor(app, 'здесь нет Git-репозитория');
    expect(app.lastFrame()).not.toContain('изменений нет');
    app.stdin.write('a');
    await waitFor(app, 'здесь нет Git-репозитория');
    git(tree.project.dir, 'init', '-q', '-b', 'main');
    app.stdin.write('r');
    await waitFor(app, 'Текущие изменения проекта');
    expect(app.lastFrame()).not.toContain('здесь нет Git-репозитория');
  });
  it('opens with the Russian V key, attaches from the log, reads and scrolls a patch, and returns to the same node', async () => {
    const tree = repoTree();
    const dir = tree.project.dir;
    const node = addNode(tree, { title: 'Просмотр каталога' });
    commitFile(dir, 'catalog.ts', 'before\n', 'base');
    const sha = commitFile(
      dir,
      'catalog.ts',
      Array.from({ length: 80 }, (_, index) => `catalog row ${index}`).join('\n') + '\n',
      'show catalog',
    );
    const app = render(
      <App dir={dir} ui={{ ...defaultUi(), selected: node.id }} offline persist={false} onAction={() => {}} />,
    );
    await waitFor(app, node.title);
    app.stdin.write('М');
    await waitFor(app, 'Коммиты к узлу пока не привязаны');
    app.stdin.write('ф');
    await waitFor(app, 'show catalog');
    app.stdin.write('\r');
    await waitFor(app, 'Связанные коммиты · 1');
    expect(loadTree(dir).nodes.get(node.id)?.commits).toEqual([sha]);
    app.stdin.write('\r');
    await waitFor(app, 'M catalog.ts');
    app.stdin.write('\r');
    await waitFor(app, '+catalog row 0');
    app.stdin.write('\u001b[6~');
    await waitFor(app, '+catalog row 10');
    expect(app.lastFrame()).not.toContain('+catalog row 0');
    app.stdin.write('\u001b[F');
    await waitFor(app, '+catalog row 79');
    app.stdin.write('\u001b');
    await waitFor(app, 'M catalog.ts');
    app.stdin.write('\u001b');
    await waitFor(app, 'Связанные коммиты · 1');
    app.stdin.write('D');
    await waitFor(app, 'Связанные коммиты · 0');
    app.stdin.write('\u001b');
    await vi.waitFor(() => expect(app.lastFrame()).not.toContain(`Дифы · ${node.title}`));
    app.stdin.write('u');
    await vi.waitFor(() => expect(loadTree(dir).nodes.get(node.id)?.commits).toEqual([sha]));
  });

  it.each(['ru', 'en'] as const)(
    'fits a 100×30 screen in %s and explains a missing commit and shared working changes',
    async (lang) => {
      resetSettings({ ...DEFAULTS, lang });
      setLang(lang);
      const { dir, a } = intertwined();
      a.commits = ['f'.repeat(40)];
      writeNode(dir, a);
      writeFileSync(join(dir, 'new file.ts'), 'new\n');
      const { DiffsDialog } = await import('../src/tui/diffs-dialog.js');
      const app = render(
        <DiffsDialog
          dir={dir}
          node={a}
          width={97}
          height={24}
          onAttach={() => true}
          onDetach={() => true}
          onClose={() => {}}
        />,
      );
      await waitFor(app, lang === 'ru' ? 'коммит недоступен' : 'commit unavailable');
      expect(app.lastFrame()!.split('\n').length).toBeLessThanOrEqual(24);
      expect(
        app
          .lastFrame()!
          .split('\n')
          .every((line) => stringWidth(line) <= 97),
      ).toBe(true);
      app.stdin.write('\r');
      await waitFor(app, lang === 'ru' ? 'не найден' : 'was not found');
      app.stdin.write('\u001b[B');
      app.stdin.write('\r');
      await waitFor(app, 'new file.ts');
      expect(app.lastFrame()).toContain(
        lang === 'ru' ? 'Текущие правки общие для всех узлов' : 'Current changes are shared by all nodes',
      );
      expect(app.lastFrame()!.split('\n').length).toBeLessThanOrEqual(24);
    },
  );
});
