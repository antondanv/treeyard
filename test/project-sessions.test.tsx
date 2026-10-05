import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  open: vi.fn(),
  startPane: vi.fn(),
  listPanes: vi.fn(),
  closePane: vi.fn(),
  sessions: vi.fn(),
  setPaneSession: vi.fn(),
}));
vi.mock('@antondanv/brainyard', async (original) => ({
  ...(await original<typeof import('@antondanv/brainyard')>()),
  ...backend,
  panesAvailable: () => true,
}));

import { contextText, sessionPlan } from '../src/agents/context.js';
import { launch, resume } from '../src/agents/launch.js';
import { launchInPane, settlePending, sleepPane, wakeInPane } from '../src/agents/panes.js';
import { setLang } from '../src/i18n/i18n.js';
import { addNode, attachSession, detachSession, logToNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { offTree, sessionOwners } from '../src/model/tree.js';
import { ROOT } from '../src/model/types.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { type Action, App } from '../src/tui/App.js';
import { defaultUi } from '../src/tui/ui-state.js';
import { emptyTree } from './helpers.js';

beforeEach(() => {
  vi.clearAllMocks();
  backend.listPanes.mockResolvedValue([]);
  backend.sessions.mockResolvedValue([]);
  backend.closePane.mockResolvedValue(true);
  backend.setPaneSession.mockResolvedValue(true);
  resetSettings({ ...DEFAULTS, animation: false, marquee: false });
  setLang('ru');
});
afterEach(() => {
  cleanup();
  setLang('ru');
});

describe('sessions of the whole project', () => {
  it('sends the goal, full outline, actionable work, waiting conditions, journals and decisions in both languages', () => {
    const tree = emptyTree();
    const stage = addNode(tree, { title: 'Milestone', doneWhen: 'real person used it' });
    addNode(tree, { title: 'Active work', parent: stage.id, status: 'active', doneWhen: 'scenario runs' });
    addNode(tree, { title: 'External work', status: 'waiting', waiting: 'server access', until: 'key arrives' });
    addNode(tree, { title: 'Evidence', status: 'review' });
    logToNode(tree, stage.id, 'stopped at live testing');
    tree.project.body += '\n## Decisions\n\nUse Brainyard.\n';
    tree.problems.push('bad node YAML');
    for (const lang of ['ru', 'en'] as const) {
      setLang(lang);
      const text = contextText(tree, ROOT);
      for (const phrase of [
        tree.project.goal,
        'Milestone',
        'scenario runs',
        'External work',
        'key arrives',
        'Evidence',
        'stopped at live testing',
        'Use Brainyard.',
        'bad node YAML',
      ])
        expect(text).toContain(phrase);
      expect(text).toContain('status=done --as');
      expect(text).not.toContain('log root');
      const review = sessionPlan(tree, ROOT, 'plan', 'claude');
      expect(review.permissionMode).toBe('plan');
      expect(review.prompt).toContain(lang === 'ru' ? 'Ничего не меняй' : 'Change nothing');
      expect(sessionPlan(tree, ROOT, 'chat', 'codex').prompt).toBeUndefined();
      expect(sessionPlan(tree, ROOT, 'goal', 'codex').start).toBe('plan');
    }
  });

  it('persists root ownership and metadata without creating a node or changing project rules', () => {
    const tree = emptyTree();
    const body = tree.project.body;
    tree.project.extra.custom = { keep: true };
    attachSession(tree, ROOT, { brain: 'claude', id: 'review', mode: 'pane', pane: 'claude-review', name: 'Review' });
    attachSession(tree, ROOT, { brain: 'claude', id: 'review', opened: '2026-10-05T15:00:00Z' });
    const saved = loadTree(tree.project.dir);
    expect(saved.project.sessions).toMatchObject([
      { id: 'review', pane: 'claude-review', opened: '2026-10-05T15:00:00Z' },
    ]);
    expect(saved.project.body).toBe(body);
    expect(saved.project.extra.custom).toEqual({ keep: true });
    expect(saved.nodes.has(ROOT)).toBe(false);
    expect(offTree({ id: 'review' }, sessionOwners(saved))).toBe(false);
    detachSession(saved, ROOT, 'review');
    expect(loadTree(tree.project.dir).project.sessions).toEqual([]);
  });

  it.each(['claude', 'codex', 'antigravity'] as const)(
    'launches and resumes %s from the root through Brainyard',
    async (brain) => {
      const tree = emptyTree();
      backend.open.mockResolvedValue({ ok: true, sessionId: 'root-session', startedAt: new Date().toISOString() });
      const { ref } = await launch(tree, ROOT, { brain, start: 'chat' });
      expect(backend.open.mock.lastCall?.[0]).toMatchObject({
        brain,
        cwd: tree.project.dir,
        env: { TREEYARD_NODE: ROOT },
      });
      expect(backend.open.mock.lastCall?.[0].system).toContain('всем деревом');
      expect(backend.open.mock.lastCall?.[0].prompt).toBeUndefined();
      await resume(tree, ROOT, ref!);
      expect(backend.open.mock.lastCall?.[0]).toMatchObject({ resume: 'root-session', env: { TREEYARD_NODE: ROOT } });
      expect(loadTree(tree.project.dir).project.sessions).toHaveLength(1);
    },
  );

  it('keeps a background review in the root', async () => {
    const tree = emptyTree();
    backend.open.mockResolvedValue({ ok: true, sessionId: 'background', startedAt: new Date().toISOString() });
    await launch(tree, ROOT, { brain: 'claude', start: 'plan', background: true });
    expect(backend.open.mock.lastCall?.[0]).toMatchObject({ background: true, permissionMode: 'plan' });
    expect(loadTree(tree.project.dir).project.sessions).toMatchObject([{ id: 'background', mode: 'background' }]);
  });

  it('settles a pending root pane, sleeps it, and wakes the same conversation', async () => {
    const tree = emptyTree();
    const started = new Date().toISOString();
    backend.startPane.mockResolvedValue({ pane: 'codex-root', startedAt: started, warnings: [] });
    await launchInPane(tree, ROOT, { brain: 'codex', start: 'plan', pane: true }, { width: 60, height: 20 });
    const pane = {
      pane: 'codex-root',
      brain: 'codex' as const,
      sessionId: 'conversation',
      cwd: tree.project.dir,
      startedAt: started,
      attached: false,
      width: 60,
      height: 20,
    };
    backend.sessions.mockResolvedValue([{ brain: 'codex', id: 'conversation', interactive: true, startedAt: started }]);
    expect(await settlePending(tree, [pane])).toBe(true);
    expect(await sleepPane(tree, pane)).toBe('slept');
    const saved = loadTree(tree.project.dir);
    expect(saved.project.sessions).toMatchObject([{ id: 'conversation', mode: 'pane' }]);
    backend.startPane.mockResolvedValue({
      pane: 'codex-woken',
      sessionId: 'conversation',
      startedAt: started,
      warnings: [],
    });
    await wakeInPane(saved, ROOT, saved.project.sessions[0]!, { width: 60, height: 20 });
    expect(backend.startPane.mock.lastCall?.[0]).toMatchObject({
      resume: 'conversation',
      env: { TREEYARD_NODE: ROOT },
    });
    expect(loadTree(tree.project.dir).project.sessions).toMatchObject([{ id: 'conversation', pane: 'codex-woken' }]);
  });
});

function mount() {
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
  return { tree, app, actions, wait, key };
}

describe('root sessions in the TUI', () => {
  it('← → c confirms a review, and the project menu opens a conversation in the terminal', async () => {
    const { tree, actions, wait, key } = mount();
    await wait('Work');
    await key('\u001b[D');
    await wait('корень дерева');
    await key('c');
    await wait('Запустить сессию?');
    await wait('ревью дерева');
    await key('\u001b');
    await key('\r');
    await wait('Сессия по проекту');
    await key('r');
    await wait('разговор о проекте');
    await new Promise((done) => setTimeout(done, 350));
    await key('\r');
    expect(actions).toMatchObject([{ type: 'launch', node: ROOT, options: { start: 'chat' } }]);
    expect(loadTree(tree.project.dir).nodes.values().next().value?.status).toBe('todo');
  });

  it('shows sleeping root sessions under the project, resumes them, and allows forgetting them from its menu', async () => {
    const { tree, app, wait, key } = mount();
    attachSession(tree, ROOT, {
      brain: 'claude',
      id: 'sleeping-review',
      name: 'Тест · Review',
      mode: 'pane',
      pane: 'claude-old',
    });
    await wait('Work');
    await key('\u0012');
    await key('5');
    await wait('Review');
    expect(app.lastFrame()).toContain('◆ Тест');
    expect(app.lastFrame()).toContain('спит');
    expect(app.lastFrame()).not.toMatch(/Review.*без узла/);
    await key('\r');
    await wait('Продолжить');
    await key('\u001b');
    await key('1');
    await key('\u001b[D');
    await key('\r');
    await key('\u001b[B');
    await key('\u001b[B');
    await wait('Сессии проекта');
    await key('\u007f');
    await vi.waitFor(() => expect(loadTree(tree.project.dir).project.sessions).toEqual([]));
    expect(readFileSync(join(tree.project.dir, '.tree', 'tree.md'), 'utf8')).not.toContain('sleeping-review');
  });

  it('configures root launches with two starts and a different agent', async () => {
    const { actions, wait, key } = mount();
    await wait('Work');
    await key('\u001b[D');
    await key('o');
    await wait('Запуск · ◆ Тест');
    await key('\u001b[C');
    await wait('Codex');
    await key('\u001b[B');
    await key('\u001b[B');
    await key('\u001b[C');
    await wait('разговор о проекте');
    await key('\r');
    await wait('Запустить сессию?');
    await new Promise((done) => setTimeout(done, 350));
    await key('\r');
    expect(actions).toMatchObject([{ type: 'launch', node: ROOT, options: { brain: 'codex', start: 'chat' } }]);
  });
});
