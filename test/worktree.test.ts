import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { installAgyMailHook } from '../src/agents/agy-hook.js';
import { installCodexMailHook } from '../src/agents/codex-hook.js';
import { installOpencodeMailPlugin } from '../src/agents/opencode-plugin.js';
import { installMailHook } from '../src/agents/turn-hook.js';
import { addNode, attachCommits } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import {
  branchCommits,
  branchOf,
  ensureWorktree,
  inProjectFolders,
  nodeCommits,
  nodeOfBranch,
  prepareAgain,
  removeWorktree,
  sessionFolder,
  sessionPlace,
  togetherWorktrees,
  treeOfWorktree,
  WorktreeBusy,
  worktreeDirs,
  worktreeFor,
  worktreeParent,
  worktreeState,
  worktreesOf,
} from '../src/worktree.js';
import { emptyTree, tempDir, treeyardIn, withStdin } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(worktreeParent(dir), { recursive: true, force: true });
});

/** A git project with a committed tree and two nodes; its worktrees stand next to it (cleaned up after). */
function repo() {
  const tree = emptyTree();
  const main = tree.project.dir;
  made.push(main);
  const a = addNode(tree, { title: 'Бот', status: 'active' });
  const b = addNode(tree, { title: 'Сайт', status: 'todo' });
  writeFileSync(join(main, 'app.txt'), 'код\n');
  writeFileSync(join(main, '.gitignore'), '.env\n.tree/.local/\nnotes/\n');
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'start');
  return { tree: loadTree(main), main, a: a.id, b: b.id };
}

/** Work in a node's worktree: a file and a commit. */
function commitIn(dir: string, name: string): string {
  writeFileSync(join(dir, name), `${name}\n`);
  git(dir, 'add', name);
  git(dir, 'commit', '-q', '-m', `add ${name}`);
  return git(dir, 'rev-parse', 'HEAD');
}

describe('a worktree of a node', () => {
  it('is the branch treeyard/<id> in a folder next to the project, and is found again, not made twice', async () => {
    const { tree, main, a } = repo();
    const first = await ensureWorktree(tree, a);
    expect(first.created).toBe(true);
    expect(first.worktree).toMatchObject({
      id: a,
      branch: `treeyard/${a}`,
      path: join(realpathSync(dirname(main)), `${main.split('/').pop()}.worktrees`, a),
    });
    expect(git(first.worktree.path, 'branch', '--show-current')).toBe(`treeyard/${a}`);
    expect(first.worktree.base).toBe(git(main, 'rev-parse', 'HEAD'));
    expect(existsSync(join(first.worktree.path, 'app.txt'))).toBe(true);
    expect(nodeOfBranch(first.worktree.branch)).toBe(a);
    expect(nodeOfBranch('main')).toBeUndefined();

    const again = await ensureWorktree(tree, a);
    expect(again.created).toBe(false);
    expect(again.worktree.path).toBe(first.worktree.path);
    expect(worktreesOf(main).map((wt) => wt.id)).toEqual([a]);
    expect(worktreeFor(main, a)?.branch).toBe(branchOf(a));
  });

  it('copies the untracked files .worktreeinclude names, never the tracked ones and never over a file', async () => {
    const { tree, main, a } = repo();
    writeFileSync(join(main, '.env'), 'KEY=1\n');
    mkdirSync(join(main, 'notes'));
    writeFileSync(join(main, 'notes', 'local.md'), 'заметки\n');
    writeFileSync(join(main, 'other.log'), 'не нужен\n');
    writeFileSync(join(main, '.worktreeinclude'), '.env\nnotes/\napp.txt\n');
    const made = await ensureWorktree(tree, a);
    expect(made.copied).toBe(2);
    const wt = made.worktree.path;
    expect(readFileSync(join(wt, '.env'), 'utf8')).toBe('KEY=1\n');
    expect(readFileSync(join(wt, 'notes', 'local.md'), 'utf8')).toBe('заметки\n');
    expect(existsSync(join(wt, 'other.log'))).toBe(false);
    // `app.txt` is in git: the worktree has it from the commit, and the copy leaves it be.
    expect(readFileSync(join(wt, 'app.txt'), 'utf8')).toBe('код\n');

    writeFileSync(join(wt, '.env'), 'KEY=2\n');
    await prepareAgain(tree, a);
    expect(readFileSync(join(wt, '.env'), 'utf8')).toBe('KEY=2\n');
  });

  it('takes Claude Code’s own settings and Codex’s mail hook of the project along to a new or re-prepared worktree', async () => {
    const { tree, main, a } = repo();
    installMailHook('project', main);
    const made = await ensureWorktree(tree, a);
    expect(made.copied).toBe(1);
    expect(readFileSync(join(made.worktree.path, '.claude', 'settings.local.json'), 'utf8')).toBe(
      readFileSync(join(main, '.claude', 'settings.local.json'), 'utf8'),
    );

    // Codex, Antigravity and OpenCode hooks/plugins installed later reach an existing worktree via `prepareAgain` and stay out of git status.
    installCodexMailHook('project', main);
    installAgyMailHook('project', main);
    installOpencodeMailPlugin('project', main);
    const refreshed = await prepareAgain(tree, a);
    expect(refreshed.copied).toBe(3);
    expect(readFileSync(join(made.worktree.path, '.codex', 'hooks.json'), 'utf8')).toBe(
      readFileSync(join(main, '.codex', 'hooks.json'), 'utf8'),
    );
    expect(readFileSync(join(made.worktree.path, '.agents', 'hooks.json'), 'utf8')).toBe(
      readFileSync(join(main, '.agents', 'hooks.json'), 'utf8'),
    );
    expect(readFileSync(join(made.worktree.path, '.opencode', 'plugins', 'treeyard-mail.js'), 'utf8')).toBe(
      readFileSync(join(main, '.opencode', 'plugins', 'treeyard-mail.js'), 'utf8'),
    );
    expect(worktreeState(main, made.worktree).dirty).toEqual([]);
  });

  it('runs the project setup in it; a setup that fails stops the launch and runs again next time', async () => {
    const { tree, a } = repo();
    tree.project.setup = 'echo ready > setup.txt && pwd > where.txt';
    const ok = await ensureWorktree(tree, a);
    expect(readFileSync(join(ok.worktree.path, 'setup.txt'), 'utf8')).toBe('ready\n');
    expect(readFileSync(join(ok.worktree.path, 'where.txt'), 'utf8').trim()).toMatch(new RegExp(`${a}$`));
    expect(ok.worktree.prepared).toBe(true);

    const second = repo();
    second.tree.project.setup = 'echo "нет такого пакета" >&2; exit 3';
    await expect(ensureWorktree(second.tree, second.a)).rejects.toThrow(
      /подготовка worktree не прошла.*нет такого пакета/,
    );
    // The worktree stands, unprepared: the next launch tries the setup again.
    expect(worktreeFor(second.main, second.a)?.prepared).toBe(false);
    second.tree.project.setup = 'touch fixed.txt';
    const retry = await ensureWorktree(second.tree, second.a);
    expect(existsSync(join(retry.worktree.path, 'fixed.txt'))).toBe(true);
    expect(retry.created).toBe(false);
    expect(worktreeFor(second.main, second.a)?.prepared).toBe(true);
  });

  it('shows the commits of its branch in the node, with no hook and no --add', async () => {
    const { tree, main, a, b } = repo();
    const { worktree } = await ensureWorktree(tree, a);
    expect(branchCommits(main, a)).toEqual([]);
    const sha = commitIn(worktree.dir, 'one.txt');
    // The tree reads the branch afresh a few seconds after a commit; a new process reads it at once.
    const cli = treeyardIn(main);
    const diff = await cli('diff', a, '--json');
    expect(diff.code, diff.stderr).toBe(0);
    expect(JSON.parse(diff.stdout).sections.map((s: { sha: string }) => s.sha)).toEqual([sha]);
    expect(loadTree(main).nodes.get(a)!.commits).toBeUndefined();

    const node = loadTree(main).nodes.get(a)!;
    // Attached by hand as well: each commit once.
    expect(nodeCommits(main, { ...node, commits: [sha] })).toEqual([sha]);
    const other = loadTree(main).nodes.get(b)!;
    expect(nodeCommits(main, other)).toEqual([]);

    const show = await cli('show', a);
    expect(show.stdout).toContain(sha);
    expect(show.stdout).toMatch(/worktree: .*\.worktrees\/\w{4}/);
    expect(show.stdout).toContain(`ветка treeyard/${a}`);
    expect(show.stdout).toContain('коммитов: 1 · не влито: 1 · чисто');
    const json = JSON.parse((await cli('show', a, '--json')).stdout);
    expect(json.worktree).toMatchObject({ branch: `treeyard/${a}` });
    expect(json.commits).toEqual([sha]);
  }, 60_000);

  it('is never removed with uncommitted files or commits the main branch lacks; merged, it goes and leaves its commits', async () => {
    const { tree, main, a } = repo();
    const { worktree } = await ensureWorktree(tree, a);
    writeFileSync(join(worktree.dir, 'draft.txt'), 'не закоммичено\n');
    expect(() => removeWorktree(tree, a)).toThrow(WorktreeBusy);
    expect(worktreeState(main, worktree).dirty).toEqual(['draft.txt']);
    expect(existsSync(worktree.path)).toBe(true);

    git(worktree.dir, 'add', 'draft.txt');
    git(worktree.dir, 'commit', '-q', '-m', 'draft');
    const sha = git(worktree.dir, 'rev-parse', 'HEAD');
    try {
      removeWorktree(tree, a);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WorktreeBusy);
      expect((error as WorktreeBusy).reasons.join()).toContain('не влито коммитов');
    }
    expect(existsSync(worktree.path)).toBe(true);
    expect(git(main, 'rev-parse', '--verify', worktree.branch)).toBe(sha);

    git(main, 'merge', '-q', '--no-ff', '-m', 'merge', worktree.branch);
    const removed = removeWorktree(loadTree(main), a);
    expect(removed.attached).toBe(1);
    expect(existsSync(worktree.path)).toBe(false);
    expect(git(main, 'branch', '--list', worktree.branch)).toBe('');
    expect(worktreeFor(main, a)).toBeUndefined();
    // What the branch made is the node's for good, with the branch gone.
    const node = loadTree(main).nodes.get(a)!;
    expect(node.commits).toEqual([sha]);
    expect(nodeCommits(main, node)).toEqual([sha]);
  });

  it('is made again on the branch a removal kept; a branch left behind is picked up where it stopped', async () => {
    const { tree, main, a } = repo();
    const first = await ensureWorktree(tree, a);
    const sha = commitIn(first.worktree.dir, 'kept.txt');
    git(main, 'worktree', 'remove', first.worktree.path);
    // The registry still names a folder that is gone: no worktree, but the branch holds the work.
    expect(worktreeFor(main, a)).toBeUndefined();
    git(main, 'worktree', 'prune');
    const again = await ensureWorktree(tree, a);
    expect(again.created).toBe(true);
    expect(existsSync(join(again.worktree.path, 'kept.txt'))).toBe(true);
    expect(git(again.worktree.path, 'rev-parse', 'HEAD')).toBe(sha);
    expect(nodeCommits(main, { id: a })).toEqual([sha]);
  });
});

describe('where a command or a session lands', () => {
  it('a command run in a worktree treeyard made writes the main tree, not the branch copy', async () => {
    const { tree, main, a } = repo();
    const { worktree } = await ensureWorktree(tree, a);
    // Git names folders by their real path (/private/var on macOS).
    expect(treeOfWorktree(worktree.dir)).toBe(realpathSync(main));
    expect(treeOfWorktree(join(worktree.dir, '.tree'))).toBe(realpathSync(main));
    expect(treeOfWorktree(main)).toBeUndefined();

    const log = await treeyardIn(worktree.dir)('log', a, 'итог из worktree');
    expect(log.code, log.stderr).toBe(0);
    expect(loadTree(main).nodes.get(a)!.body).toContain('итог из worktree');
    expect(readFileSync(join(worktree.dir, '.tree', 'nodes', `${a}.md`), 'utf8')).not.toContain('итог из worktree');
    const status = await treeyardIn(worktree.dir)('status', '--json');
    expect(JSON.parse(status.stdout).worktree).toMatchObject({ tree: 'main', branch: `treeyard/${a}` });
  }, 60_000);

  it('a plain git worktree (without TREEYARD_PROJECT) reads and writes the main tree via git common dir, while --project . targets its own copy', async () => {
    const { main, a } = repo();
    const plain = join(tempDir(), 'plain');
    git(main, 'worktree', 'add', '-q', '-b', 'side', plain);
    const sub = join(plain, 'nested', 'dir');
    mkdirSync(sub, { recursive: true });

    expect(treeOfWorktree(plain, {})).toBe(realpathSync(main));
    expect(treeOfWorktree(sub, {})).toBe(realpathSync(main));

    // A change made in the main tree is visible when reading from the worktree.
    const mainLog = await treeyardIn(main)('log', a, 'свежая запись в основном');
    expect(mainLog.code, mainLog.stderr).toBe(0);
    const shown = await treeyardIn(sub)('show', a);
    expect(shown.code, shown.stderr).toBe(0);
    expect(shown.stdout).toContain('свежая запись в основном');

    // Writes from the plain worktree (root or subfolder) go to the main tree, not the branch copy.
    const log = await treeyardIn(plain)('log', a, 'запись из обычного worktree');
    expect(log.code, log.stderr).toBe(0);
    expect(loadTree(main).nodes.get(a)!.body).toContain('запись из обычного worktree');
    expect(loadTree(plain).nodes.get(a)!.body).not.toContain('запись из обычного worktree');

    const added = await treeyardIn(sub)('add', 'Идея без флага', '--parent', a, '--status', 'idea');
    expect(added.code, added.stderr).toBe(0);
    const ideaId = added.stdout.trim();
    expect(loadTree(main).nodes.get(ideaId)).toMatchObject({ title: 'Идея без флага', parent: a, status: 'idea' });
    expect(loadTree(plain).nodes.has(ideaId)).toBe(false);

    // Explicit --project . targets the worktree's own .tree/ copy without redirecting to main.
    const ownLog = await treeyardIn(plain)('log', a, 'явно в копию ветки', '--project', '.');
    expect(ownLog.code, ownLog.stderr).toBe(0);
    expect(loadTree(plain).nodes.get(a)!.body).toContain('явно в копию ветки');
    expect(loadTree(main).nodes.get(a)!.body).not.toContain('явно в копию ветки');
    const ownShow = await treeyardIn(main)('show', a, '--project', plain);
    expect(ownShow.code, ownShow.stderr).toBe(0);
    expect(ownShow.stdout).toContain('явно в копию ветки');
    expect(ownShow.stdout).not.toContain('запись из обычного worktree');

    // A nested worktree inside the main folder (e.g. Claude Code's .claude/worktrees/...) resolves to main too, even on an orphan branch.
    const inner = join(main, '.claude', 'worktrees', 'agent');
    git(main, 'worktree', 'add', '-q', '--orphan', '-b', 'agent-orphan', inner);
    expect(treeOfWorktree(inner, {})).toBe(realpathSync(main));
    const innerLog = await treeyardIn(inner)('log', a, 'из .claude/worktrees');
    expect(innerLog.code, innerLog.stderr).toBe(0);
    expect(loadTree(main).nodes.get(a)!.body).toContain('из .claude/worktrees');
  }, 60_000);

  it('keeps the branch’s own .tree/ when the main checkout has none, in a bare repo worktree, or in a submodule', async () => {
    // 1. Only the branch has a tree: main checkout has no .tree/.
    const noMainTree = tempDir();
    git(noMainTree, 'init', '-q', '-b', 'main');
    git(noMainTree, 'commit', '-q', '--allow-empty', '-m', 'init');
    const branchWt = join(tempDir(), 'branch-only');
    git(noMainTree, 'worktree', 'add', '-q', '-b', 'with-tree', branchWt);
    const seed = emptyTree();
    mkdirSync(join(branchWt, '.tree', 'nodes'), { recursive: true });
    writeFileSync(join(branchWt, '.tree', 'tree.md'), readFileSync(join(seed.project.dir, '.tree', 'tree.md')));
    const branchNode = addNode(loadTree(branchWt), { title: 'Только на ветке' });
    expect(treeOfWorktree(branchWt, {})).toBeUndefined();
    const branchLog = await treeyardIn(branchWt)('log', branchNode.id, 'живёт на ветке');
    expect(branchLog.code, branchLog.stderr).toBe(0);
    expect(loadTree(branchWt).nodes.get(branchNode.id)!.body).toContain('живёт на ветке');

    // 2. Bare repository with a linked worktree: no main working checkout exists.
    const bare = join(tempDir(), 'repo.git');
    git(tempDir(), 'init', '-q', '--bare', bare);
    const bareWt = join(tempDir(), 'bare-wt');
    git(bare, 'worktree', 'add', '-q', '--orphan', '-b', 'main', bareWt);
    expect(treeOfWorktree(bareWt, {})).toBeUndefined();

    // 3. Git submodule (.git file without commondir): keeps its own tree.
    const subRepo = repo();
    const superRepo = repo();
    git(superRepo.main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subRepo.main, 'libs/sub');
    const subDir = join(superRepo.main, 'libs', 'sub');
    expect(treeOfWorktree(subDir, {})).toBeUndefined();
  }, 60_000);

  it('respects TREEYARD_PROJECT for sub-trees inside the same repo and never hijacks other repos or plain folders', async () => {
    const { main, a } = repo();
    const plain = join(tempDir(), 'plain');
    git(main, 'worktree', 'add', '-q', '-b', 'side', plain);
    const sub = join(plain, 'sub');
    mkdirSync(sub);

    // TREEYARD_PROJECT matching this repo's main tree resolves to main from root or a subfolder.
    expect(treeOfWorktree(plain, { TREEYARD_PROJECT: main })).toBe(realpathSync(main));
    expect(treeOfWorktree(sub, { TREEYARD_PROJECT: main })).toBe(realpathSync(main));
    // A different repository in TREEYARD_PROJECT must never hijack this worktree (resolves to own main, never other).
    const other = repo();
    expect(treeOfWorktree(plain, { TREEYARD_PROJECT: other.main })).toBe(realpathSync(main));
    // Outside a git worktree (a plain folder or another project), TREEYARD_PROJECT does not redirect.
    expect(treeOfWorktree(other.main, { TREEYARD_PROJECT: main })).toBeUndefined();
    expect(treeOfWorktree(tempDir(), { TREEYARD_PROJECT: main })).toBeUndefined();

    // Monorepo: tree in a subfolder (`apps/web/.tree`) resolves from that subfolder or via TREEYARD_PROJECT from repo root.
    const mono = tempDir();
    const appDir = join(mono, 'apps', 'web');
    mkdirSync(join(appDir, '.tree', 'nodes'), { recursive: true });
    writeFileSync(join(appDir, '.tree', 'tree.md'), readFileSync(join(main, '.tree', 'tree.md')));
    git(mono, 'init', '-q', '-b', 'main');
    git(mono, 'add', '-A');
    git(mono, 'commit', '-q', '-m', 'mono');
    const monoWt = join(tempDir(), 'mono-wt');
    git(mono, 'worktree', 'add', '-q', '-b', 'feat', monoWt);
    expect(treeOfWorktree(join(monoWt, 'apps', 'web'), {})).toBe(realpathSync(appDir));
    expect(treeOfWorktree(monoWt, {})).toBeUndefined();
    expect(treeOfWorktree(monoWt, { TREEYARD_PROJECT: appDir })).toBe(realpathSync(appDir));
    expect(treeOfWorktree(monoWt, { TREEYARD_PROJECT: other.main })).toBeUndefined();

    // Commands in a non-treeyard worktree with TREEYARD_PROJECT write to the main tree, not the branch copy.
    const cli = treeyardIn(plain, { TREEYARD_PROJECT: main });
    const added = await cli('add', 'Идея через env', '--parent', a, '--status', 'idea');
    expect(added.code, added.stderr).toBe(0);
    const ideaId = added.stdout.trim();
    expect(loadTree(main).nodes.get(ideaId)).toMatchObject({ title: 'Идея через env', parent: a, status: 'idea' });
    expect(loadTree(plain).nodes.has(ideaId)).toBe(false);

    // Passing --project <main> on top of TREEYARD_PROJECT works too (set does not refuse the same tree).
    const set = await cli('set', ideaId, 'status=todo', '--project', main);
    expect(set.code, set.stderr).toBe(0);
    expect(loadTree(main).nodes.get(ideaId)?.status).toBe('todo');

    // add --from-json writes to the main tree when --project is passed from the worktree.
    const batch = await withStdin(
      plain,
      JSON.stringify([{ title: 'Из JSON в основное', parent: a, status: 'idea' }]),
      'add',
      '--from-json',
      '-',
      '--project',
      main,
    );
    expect(batch.code, batch.stderr).toBe(0);
    expect([...loadTree(main).nodes.values()].some((node) => node.title === 'Из JSON в основное')).toBe(true);
    expect([...loadTree(plain).nodes.values()].some((node) => node.title === 'Из JSON в основное')).toBe(false);

    // In another folder with no tree, TREEYARD_PROJECT must not hijack commands.
    const nowhere = await treeyardIn(tempDir(), { TREEYARD_PROJECT: main })('show');
    expect(nowhere.code).toBe(2);
    expect(nowhere.stderr).toContain('здесь нет дерева');
  }, 60_000);

  it('its folder is the project’s: panes and sessions there belong to the project, a session finds its folder by its ref', async () => {
    const { tree, main, a } = repo();
    expect(worktreeDirs(main)).toEqual([]);
    const { worktree } = await ensureWorktree(tree, a);
    expect(worktreeDirs(main)).toEqual([worktree.dir]);
    expect(inProjectFolders(main, main)).toBe(true);
    expect(inProjectFolders(main, join(worktree.dir, 'src'))).toBe(true);
    expect(inProjectFolders(main, dirname(main))).toBe(false);
    expect(sessionFolder(main, { dir: worktree.dir })).toBe(worktree.dir);
    expect(sessionFolder(main, {})).toBe(main);
    // A folder that is gone: the project's.
    expect(sessionFolder(main, { dir: join(main, 'nowhere') })).toBe(main);
  });
});

describe('who gets a worktree', () => {
  it('several nodes together: all but the first, unless the person said', () => {
    expect(togetherWorktrees(3, undefined)).toEqual([undefined, 'auto', 'auto']);
    expect(togetherWorktrees(1, undefined)).toEqual([undefined]);
    expect(togetherWorktrees(3, true)).toEqual([true, true, true]);
    expect(togetherWorktrees(2, false)).toEqual([false, false]);
  });

  it('a node with a worktree goes on in it, unless it is told the project’s folder', async () => {
    const { tree, main, a, b } = repo();
    const { worktree } = await ensureWorktree(tree, a);
    expect((await sessionPlace(tree, a, undefined)).dir).toBe(worktree.dir);
    expect((await sessionPlace(tree, a, false)).dir).toBe(main);
    expect((await sessionPlace(tree, b, undefined)).dir).toBe(main);
    const made = await sessionPlace(tree, b, true);
    expect(made).toMatchObject({ dir: join(realpathSync(worktreeParent(main)), b), created: true });
  });

  it('auto without git stays in the project’s folder, quietly; true without git fails', async () => {
    const tree: Tree = emptyTree();
    const id = addNode(tree, { title: 'Узел' }).id;
    expect(await sessionPlace(tree, id, 'auto')).toEqual({ dir: tree.project.dir, created: false, warnings: [] });
    await expect(sessionPlace(tree, id, true)).rejects.toThrow(/нужен git-репозиторий/);
  });

  it('auto in a repository without a commit warns and stays in the project’s folder', async () => {
    const tree: Tree = emptyTree();
    const id = addNode(tree, { title: 'Узел' }).id;
    git(tree.project.dir, 'init', '-q', '-b', 'main');
    const place = await sessionPlace(tree, id, 'auto');
    expect(place.dir).toBe(tree.project.dir);
    expect(place.warnings[0]).toMatch(/ни одного коммита.*сессия в папке проекта/);
  });
});

describe('treeyard worktree', () => {
  it('lists, makes, prepares and removes worktrees from the command line', async () => {
    const { main, a, b } = repo();
    const cli = treeyardIn(main);
    expect((await cli('worktree')).stdout).toContain('worktree у узлов нет');

    const add = await cli('worktree', 'add', a);
    expect(add.code, add.stderr).toBe(0);
    expect(add.stdout).toContain(`✓ ${a}  Бот · worktree заведён`);
    expect((await cli('worktree', 'add', a)).stdout).toContain('worktree уже стоит');

    const list = await cli('worktree');
    expect(list.stdout).toContain(`${a}  Бот`);
    expect(list.stdout).toContain(`treeyard/${a} · коммитов: 0 · чисто`);
    expect(list.stdout).not.toContain('Сайт');
    const json = JSON.parse((await cli('worktree', '--json')).stdout);
    expect(json).toMatchObject([{ node: a, title: 'Бот', branch: `treeyard/${a}`, commits: [], dirty: [] }]);

    // Work that is not saved keeps the worktree: nothing is thrown away.
    const wt = join(worktreeParent(main), a);
    writeFileSync(join(wt, 'draft.txt'), 'черновик\n');
    const refused = await cli('worktree', 'rm', a);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('не убираю worktree узла «Бот»');
    expect(refused.stderr).toContain('не закоммичено файлов: 1 (draft.txt)');
    expect(existsSync(wt)).toBe(true);

    rmSync(join(wt, 'draft.txt'));
    const removed = await cli('worktree', 'rm', a);
    expect(removed.code, removed.stderr).toBe(0);
    expect(removed.stdout).toContain(`ветка treeyard/${a} удалена`);
    expect(existsSync(wt)).toBe(false);

    const none = await cli('worktree', 'rm', b);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('нет worktree');
    const root = await cli('worktree', 'add', 'root');
    expect(root.code).toBe(2);
  }, 90_000);

  it('adds commits of a merged branch to the node once, with one journal line', async () => {
    const { tree, main, a } = repo();
    const { worktree } = await ensureWorktree(tree, a);
    const one = commitIn(worktree.dir, 'x.txt');
    const two = commitIn(worktree.dir, 'y.txt');
    git(main, 'merge', '-q', '--no-ff', '-m', 'merge', worktree.branch);
    removeWorktree(loadTree(main), a);
    const node = loadTree(main).nodes.get(a)!;
    expect(node.commits).toEqual([one, two]);
    expect(node.body.match(/ветка treeyard\/\w+ влита и убрана: привязано коммитов — 2/g)).toHaveLength(1);
    // Attaching again changes nothing.
    attachCommits(loadTree(main), a, [one, two], 'ещё раз');
    expect(loadTree(main).nodes.get(a)!.commits).toEqual([one, two]);
  });
});

describe('the project setting setup', () => {
  it('is set with treeyard config, kept in tree.md and run in every new worktree', async () => {
    const { main, a } = repo();
    const cli = treeyardIn(main);
    const set = await cli('config', 'setup', 'echo prepared > ready.txt');
    expect(set.code, set.stderr).toBe(0);
    expect(loadTree(main).project.setup).toBe('echo prepared > ready.txt');
    expect(readFileSync(join(main, '.tree', 'tree.md'), 'utf8')).toContain('setup: echo prepared > ready.txt');
    expect((await cli('config')).stdout).toMatch(/setup\s+echo prepared > ready\.txt/);

    const add = await cli('worktree', 'add', a);
    expect(add.code, add.stderr).toBe(0);
    expect(readFileSync(join(worktreeParent(main), a, 'ready.txt'), 'utf8')).toBe('prepared\n');
    const cleared = await cli('config', 'setup', '');
    expect(cleared.code, cleared.stderr).toBe(0);
    expect(loadTree(main).project.setup).toBeUndefined();
  }, 60_000);
});
