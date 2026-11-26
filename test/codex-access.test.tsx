import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  listPanes: vi.fn(async () => []),
  sessions: vi.fn(async () => []),
  panesAvailable: () => false,
}));

import { paint } from '../src/cli/print.js';
import { statusText } from '../src/cli/status-text.js';
import { setLang } from '../src/i18n/i18n.js';
import { addNode } from '../src/model/ops.js';
import { DEFAULTS, loadSettings, resetSettings, type Settings, settings } from '../src/settings.js';
import { locate, type ProjectStatus, projectStatus, type StatusDeps } from '../src/status.js';
import { type Action, App } from '../src/tui/App.js';
import { defaultUi } from '../src/tui/ui-state.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const home = process.env.TREEYARD_HOME;
const gitConfig = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
beforeEach(() => {
  // updateSettings writes settings.json: each test its own home.
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  setLang('ru');
});
afterEach(() => {
  cleanup();
  process.env.TREEYARD_HOME = home;
  for (const [key, value] of [
    ['GIT_CONFIG_GLOBAL', gitConfig.global],
    ['GIT_CONFIG_SYSTEM', gitConfig.system],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetSettings(undefined);
});

function mount(patch: Partial<Settings> = {}) {
  resetSettings({ ...DEFAULTS, animation: false, marquee: false, ...patch });
  const tree = emptyTree();
  const node = addNode(tree, { title: 'Work' });
  const actions: Action[] = [];
  const app = render(
    <App
      dir={tree.project.dir}
      ui={{ ...defaultUi(), selected: node.id }}
      offline
      persist={false}
      onAction={(action) => actions.push(action)}
    />,
  );
  const wait = (text: string) =>
    vi.waitFor(() => expect(app.lastFrame()).toContain(text), { timeout: 5000, interval: 20 });
  const key = async (data: string) => {
    app.stdin.write(data);
    await new Promise((done) => setTimeout(done, 80));
  };
  /** The guard against the Enter that opened a question. */
  const settle = () => new Promise((done) => setTimeout(done, 350));
  /** `o`, Codex in the launch form, ⏎. */
  const launchCodex = async () => {
    await key('o');
    await wait('Запуск');
    await key('\u001b[C');
    await wait('Codex');
    await key('\r');
  };
  return { tree, node, app, actions, wait, key, settle, launchCodex };
}

describe('Codex access before its first launch', () => {
  it('shows what the sandbox lets through, keeps the choice and names it in the confirmation', async () => {
    const { node, app, actions, wait, key, settle, launchCodex } = mount();
    await wait('Work');
    await launchCodex();
    await wait('Как запускать Codex из дерева?');
    const frame = app.lastFrame()!;
    expect(frame).toContain('не пускает ни в сокет tmux, ни в .git проекта');
    expect(frame).toContain('песочница + treeyard и git');
    expect(frame).toContain('workspace-write, сеть и .git проекта открыты');
    expect(frame).toContain('как в config.toml');
    expect(frame).toContain('«,» → «Права Codex»');
    await settle();
    // The first choice is the sandbox.
    await key('\r');
    await wait('Запустить сессию?');
    expect(settings().codexAccess).toBe('sandbox');
    expect(loadSettings().codexAccess).toBe('sandbox');
    // Antigravity is its own question: nothing was decided for it.
    expect(settings().antigravityAccess).toBe('');
    expect(app.lastFrame()).toMatch(/Права\s+песочница \+ treeyard и git: workspace-write/);
    await settle();
    await key('\r');
    expect(actions).toMatchObject([{ type: 'launch', node: node.id, options: { brain: 'codex' } }]);
  });

  it('«as in config.toml» keeps Codex to its own settings', async () => {
    const { app, wait, key, settle, launchCodex } = mount();
    await wait('Work');
    await launchCodex();
    await wait('Как запускать Codex из дерева?');
    await settle();
    await key('\u001b[B');
    await key('\r');
    await wait('Запустить сессию?');
    expect(settings().codexAccess).toBe('config');
    expect(loadSettings().codexAccess).toBe('config');
    expect(app.lastFrame()).toMatch(/Права\s+как в настройках Codex: песочница и подтверждения из его config.toml/);
  });

  it('asks even with confirmations off; esc starts nothing', async () => {
    const { node, actions, wait, key, settle, launchCodex } = mount({ confirm: false });
    await wait('Work');
    await launchCodex();
    await wait('Как запускать Codex из дерева?');
    await key('\u001b');
    expect(actions).toEqual([]);
    expect(settings().codexAccess).toBe('');

    await launchCodex();
    await wait('Как запускать Codex из дерева?');
    await settle();
    await key('\r');
    await vi.waitFor(() =>
      expect(actions).toMatchObject([{ type: 'launch', node: node.id, options: { brain: 'codex' } }]),
    );
    expect(loadSettings().codexAccess).toBe('sandbox');
  });

  it('does not ask once chosen, and never for Claude Code', async () => {
    const { app, wait, key, launchCodex } = mount({ codexAccess: 'config' });
    await wait('Work');
    await launchCodex();
    await wait('Запустить сессию?');
    expect(app.lastFrame()).not.toContain('Как запускать Codex из дерева?');
    await key('\u001b');
    await key('c');
    await wait('Новая сессия');
    await key('\r');
    await wait('Запустить сессию?');
    expect(app.lastFrame()).not.toContain('Как запускать');
  });

  it('changes the choice in the settings dialog, next to Antigravity’s', async () => {
    const { app, wait, key } = mount();
    await wait('Work');
    await key(',');
    await wait('Настройки');
    // Language, confirmations, Antigravity, Codex.
    for (let i = 0; i < 3; i += 1) await key('\u001b[B');
    await wait('❯ Права Codex');
    expect(app.lastFrame()).toContain('спрошу перед первым запуском Codex');
    await key('\u001b[C');
    await vi.waitFor(() => expect(settings().codexAccess).toBe('sandbox'));
    expect(loadSettings().codexAccess).toBe('sandbox');
    await wait('workspace-write, сеть и .git проекта открыты');
    await key('\u001b[C');
    await vi.waitFor(() => expect(settings().codexAccess).toBe('config'));
    await wait('песочница и подтверждения только из config.toml');
    await key('\u001b[C');
    await vi.waitFor(() => expect(settings().codexAccess).toBe(''));
    expect(loadSettings().codexAccess).toBe('');
    expect(settings().antigravityAccess).toBe('');
  });
});

describe('Codex access from the shell', () => {
  it('an agent cannot open Codex before the person chose; treeyard config keeps the choice', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Work' });
    const sh = treeyardIn(tree.project.dir);
    const refused = await sh('open', node.id, '--brain', 'codex', '--start', 'do', '--pane', '--yes');
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('права Codex ещё не выбраны');
    expect(refused.stderr).toContain('treeyard config codex_access sandbox|config');

    expect((await sh('config')).stdout).toMatch(/codex_access\s+ask/);
    expect((await sh('config', 'codex_access', 'sandbox')).stdout).toContain('codex_access = sandbox');
    expect((await sh('config', 'codex_access')).stdout.trim()).toBe('sandbox');
    expect((await sh('config', 'codex_access', 'config')).stdout).toContain('codex_access = config');
    const bad = await sh('config', 'codex_access', 'full');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('sandbox, config или ask');
    expect((await sh('config', 'codex_access', 'ask')).stdout).toContain('codex_access = ask');
  });

  it('Antigravity’s answer is not Codex’s: each CLI is asked for itself', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Work' });
    const sh = treeyardIn(tree.project.dir);
    expect((await sh('config', 'codex_access', 'sandbox')).code).toBe(0);
    const refused = await sh('open', node.id, '--brain', 'antigravity', '--start', 'do', '--pane', '--yes');
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('права Antigravity ещё не выбраны');
  });
});

describe('treeyard status for Codex', () => {
  const plain = paint({ isTTY: false } as NodeJS.WriteStream);

  /** A project in a git repository, and a home with Codex set up whose config.toml says this. */
  function setup(config: string | undefined, installed = true) {
    const tree = emptyTree();
    const dir = realpathSync(tree.project.dir);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
    const homeDir = tempDir('treeyard-status-home-');
    if (installed) {
      mkdirSync(join(homeDir, '.codex'));
      if (config !== undefined) writeFileSync(join(homeDir, '.codex', 'config.toml'), config);
    }
    const deps: StatusDeps = {
      env: { HOME: homeDir, CODEX_HOME: join(homeDir, '.codex') },
      live: async () => [],
      panes: async () => [],
      gh: async () => {
        throw Object.assign(new Error('gh: not found'), { code: 'ENOENT' });
      },
    };
    return { dir, gitDir: join(dir, '.git'), deps };
  }
  const statusOf = (dir: string, deps: StatusDeps): Promise<ProjectStatus> => projectStatus(locate(dir), deps);
  const codexProblems = (status: ProjectStatus) => status.problems.filter((problem) => problem.kind === 'codex-access');

  it('a Codex whose config.toml shuts the sandbox: the lines to put there, and the command that does without', async () => {
    resetSettings({ ...DEFAULTS });
    const { dir, gitDir, deps } = setup('model = "gpt-6"\n');
    const status = await statusOf(dir, deps);
    expect(status.codex).toMatchObject({
      choice: 'ask',
      config: { network: false, git: false },
      lines: ['[sandbox_workspace_write]', 'network_access = true', `writable_roots = ["${gitDir}"]`],
    });
    const [problem] = codexProblems(status);
    expect(problem).toMatchObject({
      what: 'Codex без доступа к treeyard и git: песочница закрыта для сокета tmux и для .git проекта',
      fix: 'treeyard config codex_access sandbox',
      lines: status.codex!.lines,
    });
    const text = statusText(status, plain);
    expect(text).toContain(
      'Codex      не выбрано — спросит при первом запуске · config.toml не даёт доступа к treeyard и git',
    );
    expect(text).toContain('Codex без доступа к treeyard и git');
    expect(text).toMatch(
      /treeyard config codex_access sandbox +или строки в \S*config\.toml:\n {6}\[sandbox_workspace_write\]\n {6}network_access = true\n {6}writable_roots = \["/,
    );
  });

  it('says exactly what is missing', async () => {
    resetSettings({ ...DEFAULTS });
    const noGit = setup('[sandbox_workspace_write]\nnetwork_access = true\n');
    const [onlyGit] = codexProblems(await statusOf(noGit.dir, noGit.deps));
    expect(onlyGit!.what).toBe('Codex без доступа к git: песочница не пускает в .git проекта (git commit)');
    expect(onlyGit!.lines).toEqual(['[sandbox_workspace_write]', `writable_roots = ["${noGit.gitDir}"]`]);

    const noNet = setup('placeholder');
    writeFileSync(
      join(noNet.deps.env!.CODEX_HOME!, 'config.toml'),
      `[sandbox_workspace_write]\nwritable_roots = ["${noNet.gitDir}"]\n`,
    );
    const [onlyNet] = codexProblems(await statusOf(noNet.dir, noNet.deps));
    expect(onlyNet!.what).toBe(
      'Codex без доступа к treeyard: песочница закрыта для сокета tmux (treeyard send, панели)',
    );
    expect(onlyNet!.lines).toEqual(['[sandbox_workspace_write]', 'network_access = true']);
  });

  it('a config.toml that already lets treeyard and git through is no problem, chosen or not', async () => {
    const made = setup('');
    const { dir, gitDir, deps } = made;
    writeFileSync(
      join(deps.env!.CODEX_HOME!, 'config.toml'),
      `[sandbox_workspace_write]\nnetwork_access = true\nwritable_roots = ["${gitDir}"]\n`,
    );
    for (const codexAccess of ['', 'config'] as const) {
      resetSettings({ ...DEFAULTS, codexAccess });
      const status = await statusOf(dir, deps);
      expect(status.codex).toMatchObject({ config: { network: true, git: true }, lines: [] });
      expect(codexProblems(status)).toEqual([]);
      expect(statusText(status, plain)).toContain('config.toml даёт доступ к treeyard и git');
    }
    // Full access needs nothing either.
    writeFileSync(join(deps.env!.CODEX_HOME!, 'config.toml'), 'sandbox_mode = "danger-full-access"\n');
    expect(codexProblems(await statusOf(dir, deps))).toEqual([]);
  });

  it('«sandbox + treeyard and git» needs nothing in config.toml: treeyard opens the way itself', async () => {
    resetSettings({ ...DEFAULTS, codexAccess: 'sandbox' });
    const { dir, deps } = setup(undefined);
    const status = await statusOf(dir, deps);
    expect(status.codex?.choice).toBe('sandbox');
    expect(codexProblems(status)).toEqual([]);
    expect(statusText(status, plain)).toContain('Codex      песочница + treeyard и git\n');
  });

  it('«as in config.toml» with a shut config is still told about it', async () => {
    resetSettings({ ...DEFAULTS, codexAccess: 'config' });
    const { dir, deps } = setup('');
    const status = await statusOf(dir, deps);
    expect(codexProblems(status)).toHaveLength(1);
    expect(statusText(status, plain)).toContain('Codex      как в config.toml · config.toml не даёт доступа');
  });

  it('says nothing where Codex is not on the machine and nobody chose', async () => {
    resetSettings({ ...DEFAULTS });
    const { dir, deps } = setup(undefined, false);
    const status = await statusOf(dir, deps);
    expect(status.codex).toBeUndefined();
    expect(codexProblems(status)).toEqual([]);
    expect(statusText(status, plain)).not.toMatch(/^Codex /m);
    // Chosen without it installed (another machine’s settings): the choice shows.
    resetSettings({ ...DEFAULTS, codexAccess: 'sandbox' });
    expect((await statusOf(dir, deps)).codex?.choice).toBe('sandbox');
  });

  it('works from a project outside a tree too, and in English', async () => {
    resetSettings({ ...DEFAULTS, lang: 'en' });
    setLang('en');
    const bare = tempDir('treeyard-bare-');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: bare });
    const homeDir = tempDir('treeyard-status-home-');
    mkdirSync(join(homeDir, '.codex'));
    const status = await projectStatus(locate(bare), {
      env: { HOME: homeDir, CODEX_HOME: join(homeDir, '.codex') },
      live: async () => [],
      panes: async () => [],
    });
    expect(codexProblems(status)).toHaveLength(1);
    const text = statusText(status, plain);
    expect(text).toContain('Codex has no access to treeyard and git');
    expect(text).toContain('not chosen — asked at the first launch');
    expect(text).toContain('treeyard config codex_access sandbox   or lines in ');
  });
});
