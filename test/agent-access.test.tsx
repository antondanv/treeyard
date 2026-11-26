import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  listPanes: vi.fn(async () => []),
  sessions: vi.fn(async () => []),
  panesAvailable: () => false,
}));

import { setLang } from '../src/i18n/i18n.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { ROOT } from '../src/model/types.js';
import { DEFAULTS, loadSettings, resetSettings, type Settings, settings } from '../src/settings.js';
import { type Action, App } from '../src/tui/App.js';
import { defaultUi } from '../src/tui/ui-state.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const home = process.env.TREEYARD_HOME;
beforeEach(() => {
  // updateSettings writes settings.json: each test its own home.
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  setLang('ru');
});
afterEach(() => {
  cleanup();
  process.env.TREEYARD_HOME = home;
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
  /** `o`, Antigravity in the launch form, ⏎. */
  const launchAgy = async () => {
    await key('o');
    await wait('Запуск');
    await key('\u001b[C');
    await key('\u001b[C');
    await wait('Antigravity');
    await key('\r');
  };
  return { tree, node, app, actions, wait, key, settle, launchAgy };
}

describe('Antigravity access before its first launch', () => {
  it('shows what full access means, keeps the ordinary mode when chosen, and does not ask again', async () => {
    const { node, app, actions, wait, key, settle, launchAgy } = mount();
    await wait('Work');
    await launchAgy();
    await wait('Какие права дать Antigravity?');
    const frame = app.lastFrame()!;
    expect(frame).toContain('--dangerously-skip-permissions');
    expect(frame).toContain('полный доступ');
    expect(frame).toContain('команды, правка и удаление файлов, сеть — без подтверждений');
    expect(frame).toContain('обычный режим');
    expect(frame).toContain('«,» → «Права Antigravity»');
    await settle();
    await key('\u001b[B');
    await key('\r');
    // The choice is saved, and the confirmation names the rights of this launch.
    await wait('Запустить сессию?');
    expect(settings().antigravityAccess).toBe('normal');
    expect(loadSettings().antigravityAccess).toBe('normal');
    expect(app.lastFrame()).toMatch(/Права\s+обычный режим: спрашивает перед каждой командой/);
    await settle();
    await key('\r');
    expect(actions).toMatchObject([{ type: 'launch', node: node.id, options: { brain: 'antigravity' } }]);
  });

  it('does not ask once chosen: full access is named in the confirmation', async () => {
    const { app, wait, launchAgy } = mount({ antigravityAccess: 'full' });
    await wait('Work');
    await launchAgy();
    await wait('Запустить сессию?');
    expect(app.lastFrame()).not.toContain('Какие права дать Antigravity?');
    expect(app.lastFrame()).toMatch(/Права\s+полный доступ: команды, файлы и сеть без подтверждений/);
  });

  it('asks even with confirmations off; esc starts nothing, full access starts at once', async () => {
    const { node, actions, wait, key, settle, launchAgy } = mount({ confirm: false });
    await wait('Work');
    await launchAgy();
    await wait('Какие права дать Antigravity?');
    await key('\u001b');
    expect(actions).toEqual([]);
    expect(settings().antigravityAccess).toBe('');

    await launchAgy();
    await wait('Какие права дать Antigravity?');
    await settle();
    await key('\r');
    await vi.waitFor(() =>
      expect(actions).toMatchObject([{ type: 'launch', node: node.id, options: { brain: 'antigravity' } }]),
    );
    expect(loadSettings().antigravityAccess).toBe('full');
  });

  it('asks before resuming an Antigravity session too, and never for Claude Code', async () => {
    const { tree, app, wait, key } = mount();
    // A sleeping pane: the sessions tab lists it, ⏎ wakes it with the same flags as a launch.
    attachSession(tree, ROOT, {
      brain: 'antigravity',
      id: 'agy-old',
      name: 'Тест · Review',
      mode: 'pane',
      pane: 'agy',
    });
    await wait('Work');
    await key('c');
    await wait('Запустить сессию?');
    // «делать» is the default start: no plan mode, Claude Code's own rules apply.
    expect(app.lastFrame()).toMatch(/Права\s+как в настройках Claude Code/);
    await key('\u001b');
    await key('\u0012');
    await key('5');
    await wait('Review');
    await key('\r');
    await wait('Какие права дать Antigravity?');
  });

  it('changes the choice in the settings dialog', async () => {
    const { app, wait, key } = mount({ antigravityAccess: 'full' });
    await wait('Work');
    await key(',');
    await wait('Настройки');
    await key('\u001b[B');
    await key('\u001b[B');
    await wait('❯ Права Antigravity');
    expect(app.lastFrame()).toContain('команды, правка и удаление файлов, сеть — без подтверждений');
    await key('\u001b[C');
    await vi.waitFor(() => expect(settings().antigravityAccess).toBe('normal'));
    expect(loadSettings().antigravityAccess).toBe('normal');
    await key('\u001b[C');
    await vi.waitFor(() => expect(settings().antigravityAccess).toBe(''));
    await wait('спрошу перед первым запуском Antigravity');
  });
});

describe('Antigravity access from the shell', () => {
  it('an agent cannot open Antigravity before the person chose; treeyard config keeps the choice', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Work' });
    const sh = treeyardIn(tree.project.dir);
    const refused = await sh('open', node.id, '--brain', 'antigravity', '--start', 'do', '--pane', '--yes');
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('права Antigravity ещё не выбраны');
    expect(refused.stderr).toContain('treeyard config antigravity_access full|normal');

    expect((await sh('config')).stdout).toMatch(/antigravity_access\s+ask/);
    expect((await sh('config', 'antigravity_access', 'normal')).stdout).toContain('antigravity_access = normal');
    expect((await sh('config', 'antigravity_access')).stdout.trim()).toBe('normal');
    expect((await sh('config', 'antigravity_access', 'everything')).code).toBe(2);
    expect((await sh('config', 'antigravity_access', 'ask')).stdout).toContain('antigravity_access = ask');
  });
});
