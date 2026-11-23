import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionInfo } from '@antondanv/brainyard';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Pane } from '../src/agents/panes.js';
import { installSkills, shippedSkills, skillStates, skillsRoot } from '../src/agents/skills.js';
import { paint } from '../src/cli/print.js';
import { statusText } from '../src/cli/status-text.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree, writeNode, writeProject } from '../src/model/store.js';
import { locate, type ProjectStatus, projectStatus, type StatusDeps } from '../src/status.js';
import { addPointer, pointer, pointerStates } from '../src/templates/pointer.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

// The person's git config (a global core.hooksPath, signing) must not leak into the repositories made here.
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
});
afterAll(() => {
  for (const [key, value] of [
    ['GIT_CONFIG_GLOBAL', saved.global],
    ['GIT_CONFIG_SYSTEM', saved.system],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();

const plain = paint({ isTTY: false } as NodeJS.WriteStream);
const DAY = 86_400_000;

/** A home with these CLIs set up (`.claude`, `.codex`, `.gemini`); the others are absent. */
function home(...clis: string[]): string {
  const dir = tempDir('treeyard-status-home-');
  for (const cli of clis) mkdirSync(join(dir, cli));
  return dir;
}

/** No CLI answers, no tmux, no gh: nothing outside the test folders is asked. */
function quiet(homeDir: string, extra: StatusDeps = {}): StatusDeps {
  return {
    env: { HOME: homeDir },
    live: async () => [],
    panes: async () => [],
    gh: async () => {
      throw Object.assign(new Error('gh: not found'), { code: 'ENOENT' });
    },
    ...extra,
  };
}

describe('treeyard status', () => {
  it('shows versions, nodes by status, skills, the pointer, the hook and GitHub — a fix for every problem', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    git(dir, 'init', '-q', '-b', 'main');
    addNode(tree, { title: 'Идея', status: 'idea' });
    addNode(tree, { title: 'Дело' });
    addNode(tree, { title: 'Ещё дело' });
    writeFileSync(join(dir, 'AGENTS.md'), '# Правила\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    const status = await projectStatus(locate(dir), quiet(home('.claude')));

    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(status.treeyard).toBe(pkg.version);
    expect(status.brainyard).toMatch(/^\d+\.\d+\.\d+/);
    expect(status.folder).toBe(dir);
    expect(status.tree).toMatchObject({ dir, title: 'Тест', problems: [] });
    expect(status.nodes).toMatchObject({ total: 3, byStatus: { idea: 1, todo: 2, done: 0 }, abandoned: [] });
    const claude = status.skills.filter((s) => s.brain === 'claude');
    expect(claude.map((s) => [s.skill, s.state])).toEqual(shippedSkills().map((skill) => [skill, 'missing']));
    expect(status.skills.filter((s) => s.brain !== 'claude').every((s) => s.state === 'no-cli')).toBe(true);
    expect(status.pointer).toEqual([
      { file: 'CLAUDE.md', state: 'via', via: ['AGENTS.md'] },
      { file: 'AGENTS.md', state: 'no-block' },
      { file: 'GEMINI.md', state: 'absent' },
    ]);
    expect(status.hook?.state).toBe('missing');
    expect(status.github).toMatchObject({ state: 'unlinked', pending: 0 });
    expect(status.sessions).toEqual([]);
    expect(status.panes).toEqual([]);
    expect(status.problems).toEqual([
      expect.objectContaining({ kind: 'skill-missing', fix: 'treeyard skills install' }),
      expect.objectContaining({
        kind: 'pointer-missing',
        what: 'нет блока о дереве в AGENTS.md',
        fix: 'treeyard pointer',
      }),
      expect.objectContaining({ kind: 'hook-missing', fix: 'treeyard hook install' }),
    ]);
    expect(status.problems[0]!.what).toBe(`скиллов ${shippedSkills().join(', ')} нет в Claude Code`);

    const text = statusText(status, plain);
    expect(text).toContain(`treeyard ${pkg.version} · Brainyard ${status.brainyard}`);
    expect(text).toContain('узлы       3: идея 1 · к работе 2');
    expect(text).toContain('брошены    0');
    expect(text).toMatch(
      /скиллы {5}Claude Code {2}treeyard не стоит · treeyard-coordinate не стоит · treeyard-init не стоит +~?\S*\.claude\/skills/,
    );
    expect(text).toContain('Antigravity  нет CLI');
    expect(text).toContain('указатель  CLAUDE.md через AGENTS.md · AGENTS.md без блока · GEMINI.md нет файла');
    expect(text).toContain('git-хук    не стоит');
    expect(text).toContain('сессии     живых нет · панелей нет');
    expect(text).toContain('GitHub     не подключено');
    expect(text).toContain('Что исправить · 3');
    expect(text).toContain('\n    treeyard skills install\n');
    expect(text).toContain('\n    treeyard pointer\n');
    expect(text.endsWith('\n    treeyard hook install')).toBe(true);
  });

  it('the commands it names fix what it found: skills install, pointer, hook install', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    git(dir, 'init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'AGENTS.md'), '# Правила\n');
    const homeDir = home('.claude', '.codex');
    const sh = treeyardIn(dir, {
      HOME: homeDir,
      CLAUDE_CONFIG_DIR: join(homeDir, '.claude'),
      CODEX_HOME: join(homeDir, '.codex'),
      // No real tmux server or Claude Code is asked about live sessions.
      BRAINYARD_TMUX_BIN: 'treeyard-test-no-tmux',
      BRAINYARD_CLAUDE_BIN: 'treeyard-test-no-claude',
    });
    const before = await sh('status', '--json');
    expect(before.code).toBe(0);
    const found = JSON.parse(before.stdout) as ProjectStatus;
    const fixes = [...new Set(found.problems.map((problem) => problem.fix))];
    // The home has Codex and no config.toml: its sandbox keeps treeyard send and git commit out.
    expect(fixes).toEqual([
      'treeyard skills install',
      'treeyard config codex_access sandbox',
      'treeyard pointer',
      'treeyard hook install',
    ]);
    for (const fix of fixes) expect((await sh(...fix.split(' ').slice(1))).code).toBe(0);
    const after = await sh('status');
    expect(after.code).toBe(0);
    expect(after.stdout).toContain('Claude Code  treeyard стоит · treeyard-coordinate стоит · treeyard-init стоит');
    expect(after.stdout).toContain('AGENTS.md есть');
    expect(after.stdout).toContain('git-хук    стоит');
    expect(after.stdout.trimEnd().endsWith('✓ всё на месте')).toBe(true);
    // The references of a skill come along: a skill is its whole folder.
    expect(existsSync(join(homeDir, '.codex', 'skills', 'treeyard', 'references', 'tree-order.md'))).toBe(true);
  }, 60_000);

  it('takes no positional arguments; --project points at another folder', async () => {
    const tree = emptyTree();
    const other = tempDir();
    const sh = treeyardIn(other, {
      BRAINYARD_TMUX_BIN: 'treeyard-test-no-tmux',
      BRAINYARD_CLAUDE_BIN: 'treeyard-test-no-claude',
    });
    const wrong = await sh('status', 'k3f9');
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain('treeyard status [--json] [--project <папка>]');
    const there = JSON.parse((await sh('status', '--json', '--project', tree.project.dir)).stdout) as ProjectStatus;
    expect(there.tree?.dir).toBe(tree.project.dir);
    const here = JSON.parse((await sh('status', '--json')).stdout) as ProjectStatus;
    expect(here.tree).toBeUndefined();
    expect(here.problems.map((p) => p.fix)).toContain('treeyard init');
  }, 40_000);

  it('outside a tree: says so with treeyard init, and still shows versions and skills', async () => {
    const dir = tempDir();
    const status = await projectStatus(locate(dir), quiet(home()));
    expect(status.tree).toBeUndefined();
    expect(status.nodes).toBeUndefined();
    expect(status.skills.length).toBeGreaterThan(0);
    expect(status.problems).toEqual([{ kind: 'no-tree', what: 'здесь нет дерева (.tree/)', fix: 'treeyard init' }]);
    expect(statusText(status, plain)).toContain('дерево     не посажено');
  });

  it('abandoned nodes: in progress with neither a live session nor a pane, with how to put them back', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const working = addNode(tree, { title: 'Работает', status: 'active' });
    const inPane = addNode(tree, { title: 'В панели', status: 'active' });
    const left = addNode(tree, { title: 'Брошен', status: 'active' });
    attachSession(tree, working.id, { brain: 'claude', id: 'sess-live', mode: 'terminal' });
    attachSession(tree, inPane.id, { brain: 'codex', id: 'sess-pane', mode: 'pane', pane: 'codex-1' });
    attachSession(tree, left.id, { brain: 'claude', id: 'sess-gone', mode: 'terminal' });
    const live: SessionInfo[] = [
      {
        brain: 'claude',
        id: 'sess-live',
        interactive: true,
        title: 'x',
        live: { status: 'busy', kind: 'interactive' },
      },
      {
        brain: 'claude',
        id: 'stray',
        interactive: true,
        title: 'Чужая',
        live: { status: 'waiting', kind: 'background' },
      },
      // Not running: not a live session at all.
      { brain: 'claude', id: 'sess-gone', interactive: true },
    ];
    const panes: Pane[] = [
      { pane: 'codex-1', brain: 'codex', cwd: dir, attached: false, width: 80, height: 24, memory: 300 * 1024 * 1024 },
      { pane: 'claude-9', brain: 'claude', cwd: tempDir(), attached: false, width: 80, height: 24 },
    ];
    // A month later every node is old: only liveness keeps one from being abandoned.
    const status = await projectStatus(
      locate(dir),
      quiet(home(), { live: async () => live, panes: async () => panes, now: Date.now() + 30 * DAY }),
    );
    expect(status.nodes?.abandoned.map((node) => node.title)).toEqual(['Брошен']);
    const problem = status.problems.find((p) => p.kind === 'abandoned')!;
    expect(problem.what).toMatch(/^«Брошен» в работе, но живой сессии нет \d+ д/);
    expect(problem.fix).toBe(`treeyard set ${left.id} status=todo`);
    expect(problem.or).toBe(`treeyard open ${left.id}`);
    expect(status.sessions).toEqual([
      {
        brain: 'claude',
        id: 'sess-live',
        title: 'x',
        status: 'busy',
        kind: 'interactive',
        node: working.id,
        nodeTitle: 'Работает',
      },
      { brain: 'claude', id: 'stray', title: 'Чужая', status: 'waiting', kind: 'background' },
    ]);
    // Only this project's panes.
    expect(status.panes).toEqual([
      expect.objectContaining({ pane: 'codex-1', brain: 'codex', node: inPane.id, nodeTitle: 'В панели' }),
    ]);
    const text = statusText(status, plain);
    expect(text).toContain('сессии     живых 2 · панелей 1');
    expect(text).toContain('claude   работает    Работает');
    expect(text).toContain('claude   ждёт тебя   «Чужая» · в фоне · без узла');
    expect(text).toContain('codex    панель      В панели · 300 МБ');
    expect(text).toMatch(/брошены {4}1: «Брошен» \(\d+ дн\)/);
    expect(text).toContain(`    treeyard set ${left.id} status=todo   или treeyard open ${left.id}`);
  });

  it('a broken tree file and a lost parent come with the file to fix and the command', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const node = addNode(tree, { title: 'Сирота' });
    node.parent = 'zzzz';
    writeNode(dir, node);
    writeFileSync(join(dir, '.tree', 'nodes', 'bad1.md'), '---\nid: [oops\n---\n');
    const status = await projectStatus(locate(dir), quiet(home()));
    const fixes = status.problems.filter((p) => p.kind.startsWith('tree-')).map((p) => p.fix);
    expect(fixes).toEqual([
      expect.stringMatching(/^\$EDITOR \S+\/\.tree\/nodes\/bad1\.md$/),
      `treeyard set ${node.id} parent=root`,
    ]);
  });
});

describe('treeyard status in a git worktree', () => {
  /** A repository with a planted, committed tree, and its worktrees. */
  function repository() {
    const tree = emptyTree();
    const main = tree.project.dir;
    addNode(tree, { title: 'Узел' });
    git(main, 'init', '-q', '-b', 'main');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'tree');
    return main;
  }

  it('shows the main tree: the worktree keeps the branch’s copy, which the person does not see', async () => {
    const main = repository();
    const wt = join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', wt, '-b', 'feat');
    const place = locate(join(wt, '.tree'));
    // Git names folders by their real path (/private/var on macOS).
    expect(place.folder).toBe(realpathSync(wt));
    expect(place.project).toBe(realpathSync(main));
    expect(place.worktree).toMatchObject({ top: expect.stringMatching(/\/wt$/), branch: 'feat' });
    // A node abandoned there is put back in the main tree, not in the copy.
    const tree = loadTree(main);
    const node = [...tree.nodes.values()][0]!;
    node.status = 'active';
    writeNode(main, node);
    const status = await projectStatus(place, quiet(home(), { now: Date.now() + 30 * DAY }));
    expect(status.worktree).toMatchObject({ tree: 'main', copy: true, branch: 'feat' });
    expect(status.tree?.dir).toBe(realpathSync(main));
    expect(status.problems.find((p) => p.kind === 'abandoned')).toMatchObject({
      fix: expect.stringMatching(new RegExp(`^treeyard set ${node.id} status=todo --project \\S+$`)),
    });
    expect(status.problems.find((p) => p.kind === 'abandoned')?.or).toBeUndefined();
    const text = statusText(status, plain);
    expect(text).toContain('git worktree, ветка feat');
    expect(text).toContain(' · основное');
    expect(text).toContain('здесь копия ветки, человек видит основное — команды дерева с --project');
  });

  it('a worktree inside the main folder without a tree of its own reaches the main tree too', () => {
    const main = repository();
    const inner = join(main, '.claude', 'worktrees', 'old');
    git(main, 'worktree', 'add', '-q', '--orphan', '-b', 'old', inner);
    const place = locate(inner);
    expect(place.folder).toBe(realpathSync(inner));
    expect(place.project).toBe(realpathSync(main));
  });

  it('when only the branch has a tree, that tree is the one', async () => {
    const dir = tempDir();
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
    const wt = join(tempDir(), 'wt');
    git(dir, 'worktree', 'add', '-q', wt, '-b', 'feat');
    const tree = emptyTree();
    writeProject({ ...tree.project, dir: wt });
    const place = locate(wt);
    expect(place.project).toBe(wt);
    const status = await projectStatus(place, quiet(home()));
    expect(status.worktree?.tree).toBe('branch');
    expect(statusText(status, plain)).toContain('дерево только в этой ветке');
  });
});

describe('skills in each CLI', () => {
  it('install as whole folders; a changed or missing file is outdated; copies in the project are refreshed, not made', () => {
    const homeDir = home('.claude', '.codex');
    const env = { HOME: homeDir };
    const project = tempDir();
    const skills = shippedSkills();
    expect(skills).toEqual(['treeyard', 'treeyard-coordinate', 'treeyard-init']);
    const states = () => skillStates(project, env).map((s) => `${s.brain}:${s.skill}:${s.state}`);
    expect(states()).toEqual([
      'claude:treeyard:missing',
      'claude:treeyard-coordinate:missing',
      'claude:treeyard-init:missing',
      'codex:treeyard:missing',
      'codex:treeyard-coordinate:missing',
      'codex:treeyard-init:missing',
      'antigravity:treeyard:no-cli',
      'antigravity:treeyard-coordinate:no-cli',
      'antigravity:treeyard-init:no-cli',
    ]);

    const first = installSkills(project, env);
    expect(first.map((item) => item.action)).toEqual(Array(6).fill('written'));
    expect(
      readFileSync(join(homeDir, '.claude', 'skills', 'treeyard', 'references', 'other-projects.md'), 'utf8'),
    ).toBe(readFileSync(join(skillsRoot(), 'treeyard', 'references', 'other-projects.md'), 'utf8'));
    expect(states().filter((s) => s.endsWith(':installed'))).toHaveLength(6);
    // Nothing is made in the project: only copies already there are its business.
    expect(existsSync(join(project, '.claude'))).toBe(false);

    // An older version: one file differs, and another is missing.
    writeFileSync(join(homeDir, '.claude', 'skills', 'treeyard', 'SKILL.md'), 'old');
    const kept = join(project, '.agents', 'skills', 'treeyard-init');
    mkdirSync(kept, { recursive: true });
    writeFileSync(join(kept, 'SKILL.md'), readFileSync(join(skillsRoot(), 'treeyard-init', 'SKILL.md')));
    writeFileSync(join(kept, 'notes.md'), 'a file the shipped skill does not have');
    const outdated = skillStates(project, env).filter((s) => s.state === 'outdated');
    expect(outdated.map((s) => `${s.brain}:${s.skill}`)).toEqual([
      'claude:treeyard',
      'codex:treeyard-init',
      'antigravity:treeyard-init',
    ]);
    expect(outdated[1]!.places).toEqual([
      { path: join(homeDir, '.codex', 'skills', 'treeyard-init'), scope: 'home', current: true },
      { path: kept, scope: 'project', current: false },
    ]);

    const second = installSkills(project, env);
    expect(second.filter((item) => item.action === 'written').map((item) => item.path)).toEqual([
      join(homeDir, '.claude', 'skills', 'treeyard'),
      kept,
    ]);
    expect(existsSync(join(kept, 'notes.md'))).toBe(false);
    expect(skillStates(project, env).every((s) => s.state === 'installed' || s.state === 'no-cli')).toBe(true);
    expect(installSkills(undefined, { HOME: home() })).toEqual([]);
  });
});

describe('the block about the tree in the agent files', () => {
  it('is current in either language, outdated when it differs, carried through an import, or missing', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'AGENTS.md'), `# Правила\n\n${pointer('en')}\n`);
    writeFileSync(join(dir, 'CLAUDE.md'), `${pointer('ru').replace('Дерево задач', 'Дерево')}\n`);
    writeFileSync(join(dir, 'GEMINI.md'), '# Gemini\n\nСвои правила.\n@AGENTS.md\n');
    expect(pointerStates(dir)).toEqual([
      { file: 'CLAUDE.md', state: 'outdated' },
      { file: 'AGENTS.md', state: 'ok' },
      { file: 'GEMINI.md', state: 'via', via: ['AGENTS.md'] },
    ]);
    writeFileSync(join(dir, 'GEMINI.md'), '# Gemini\n\nСвои правила.\n');
    addPointer(join(dir, 'CLAUDE.md'));
    expect(pointerStates(dir).map((p) => p.state)).toEqual(['ok', 'ok', 'no-block']);
  });
});

describe('the GitHub link', () => {
  function linked(github: Record<string, unknown>) {
    const tree = emptyTree();
    tree.project.extra.github = github;
    writeProject(tree.project);
    return loadTree(tree.project.dir);
  }

  it('asks gh only when something is linked, and names the fix for a missing gh, a login or a scope', async () => {
    const unlinked = emptyTree();
    let asked = 0;
    const counting: StatusDeps['gh'] = async () => {
      asked += 1;
      return '';
    };
    await projectStatus(locate(unlinked.project.dir), quiet(home(), { gh: counting }));
    expect(asked).toBe(0);

    const repo = linked({ repo: 'o/r' });
    const missing = await projectStatus(locate(repo.project.dir), quiet(home()));
    expect(missing.github).toMatchObject({ state: 'linked', repo: 'o/r', gh: { installed: false } });
    expect(missing.problems.find((p) => p.kind === 'gh-missing')?.fix).toBe('brew install gh');

    const loggedOut = await projectStatus(
      locate(repo.project.dir),
      quiet(home(), {
        gh: async () => {
          throw new Error('not logged in');
        },
      }),
    );
    expect(loggedOut.problems.find((p) => p.kind === 'gh-login')?.fix).toBe('gh auth login');

    const board = linked({
      board: 'o/7',
      project_id: 'P',
      field_id: 'F',
      columns: { todo: 'Todo', review: 'Review' },
      options: { Todo: 'a', Review: 'b' },
    });
    const node = addNode(board, { title: 'Карточка', status: 'review' });
    node.extra.github = { item: 'I1', column: 'Todo' };
    writeNode(board.project.dir, node);
    const noScope = await projectStatus(
      locate(board.project.dir),
      quiet(home(), { gh: async () => 'X-Oauth-Scopes: repo, read:org\r\n\r\n{"login":"me"}' }),
    );
    expect(noScope.github).toMatchObject({ board: 'o/7', pending: 1, gh: { user: 'me' } });
    expect(noScope.problems.filter((p) => p.kind.startsWith('g')).map((p) => p.fix)).toEqual([
      'gh auth refresh -s project',
      'treeyard github sync',
    ]);
    const text = statusText(noScope, plain);
    expect(text).toContain('GitHub     доска o/7 · gh: me · не дошло до GitHub: 1');
  });
});
