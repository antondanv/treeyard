import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeProjectDir, type PaneInfo, type SessionInfo } from '@antondanv/brainyard';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionPlan } from '../src/agents/context.js';
import { deliverAll, ensureDeliverer, runDeliverer } from '../src/agents/deliver.js';
import { paneDialog } from '../src/agents/pane-dialog.js';
import { withPaneIdle } from '../src/agents/pane-idle.js';
import { type SendSources, sendToNode } from '../src/agents/send.js';
import { parseDuration, screenTail, type WaitSources, waitFor } from '../src/agents/wait.js';
import { paint } from '../src/cli/print.js';
import { waitText } from '../src/cli/wait-text.js';
import { setLang } from '../src/i18n/i18n.js';
import { journalEntries } from '../src/model/journal.js';
import { letterFrom, letterTo } from '../src/model/mail.js';
import {
  addLetter,
  delivererRunning,
  letterByNumber,
  mailDir,
  markDelivered,
  queuedFor,
  queuedLetters,
  readMail,
} from '../src/model/mailbox.js';
import { addNode, attachCommit, attachSession, logToNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { SessionRef, Tree } from '../src/model/types.js';
import { emptyTree, tempDir } from './helpers.js';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const plain = paint({ isTTY: false } as NodeJS.WriteStream);

afterEach(() => setLang('ru'));

/** A node «в работе» with one session. */
function nodeWithSession(tree: Tree, title: string, ref: Partial<SessionRef> & { id: string }) {
  const node = addNode(tree, { title, status: 'active' });
  attachSession(tree, node.id, {
    brain: 'claude',
    mode: 'background',
    started: ago(60_000),
    opened: ago(60_000),
    ...ref,
  });
  return node;
}

const live = (id: string, status: string, extra: Record<string, unknown> = {}): SessionInfo =>
  ({ brain: 'claude', id, interactive: true, live: { status, kind: 'background', ...extra } }) as SessionInfo;

const pane = (name: string, extra: Partial<PaneInfo> = {}): PaneInfo => ({
  pane: name,
  brain: 'claude',
  attached: false,
  width: 100,
  height: 30,
  ...extra,
});

/** What the sessions are doing, changed by a test between looks. */
interface World {
  live: SessionInfo[];
  panes: PaneInfo[];
  screens?: Record<string, string[]>;
  paneSessions?: Record<string, string>;
}

function waitSources(world: World, onLook?: (count: number) => void): WaitSources & { wake?: () => void } {
  let looks = 0;
  const sources: WaitSources & { wake?: () => void } = {
    load: (dir) => {
      onLook?.(looks++);
      return loadTree(dir);
    },
    live: async () => world.live,
    panes: async () => world.panes,
    paneSession: async (p) => world.paneSessions?.[p.pane],
    capture: async (name) =>
      world.screens?.[name]
        ? {
            lines: world.screens[name]!,
            width: 100,
            height: 30,
            cursor: { x: 0, y: 0, visible: true },
            historySize: 0,
            scrollOffset: 0,
            mouseTracking: false,
            mouseSgr: false,
            alternate: false,
          }
        : undefined,
    idle: async (_panes, asked) => asked,
    watch: (_dir, wake) => {
      sources.wake = wake;
      return { stop: () => undefined };
    },
    now: () => Date.now(),
  };
  return sources;
}

const fast = { intervalMs: 5, graceMs: 30_000 };

function claudeTranscript() {
  const claude = tempDir();
  const cwd = join(tempDir(), 'Treeyard.worktrees', 'work-node');
  mkdirSync(cwd, { recursive: true });
  const dir = join(claude, 'projects', claudeProjectDir(realpathSync(cwd)));
  mkdirSync(dir, { recursive: true });
  const sessionId = 'claude-session';
  const startedAt = ago(60_000);
  const terminal = pane('claude-cc', { cwd, sessionId, startedAt });
  return {
    claude,
    sessionId,
    startedAt,
    terminal,
    write: (...entries: unknown[]) =>
      writeFileSync(join(dir, `${sessionId}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n')),
  };
}

const claudeAssistant = (stopReason: string, timestamp: string, isSidechain = false) => ({
  type: 'assistant',
  timestamp,
  isSidechain,
  message: { stop_reason: stopReason },
});

describe('treeyard wait', () => {
  it('answers at once for a node that is not «в работе»', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Готовое', status: 'review' });
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      sources: waitSources({ live: [], panes: [] }),
    });
    expect(result.timedOut).toBe(false);
    expect(result.settled).toMatchObject([{ id: node.id, status: 'review', from: 'review', reason: 'status' }]);
  });

  it('reports a background session that ended its turn, with the last entry written by hand', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Фон', { id: 'bg-1' });
    // The session's own summary is the last entry; treeyard's lines after it do not count.
    logToNode(tree, node.id, 'итог: тесты 12/12', 'claude');
    attachCommit(tree, node.id, 'a'.repeat(40), 'claude');
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      sources: waitSources({ live: [live('bg-1', 'idle', { state: 'done' })], panes: [] }),
    });
    expect(result.settled).toMatchObject([
      {
        id: node.id,
        reason: 'idle',
        entry: { source: 'claude', text: 'итог: тесты 12/12' },
        session: { brain: 'claude', id: 'bg-1', state: 'idle', mode: 'background' },
      },
    ]);
  });

  it('does not take a letter for the session’s summary, its own or the coordinator’s', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Фон', { id: 'bg-1' });
    const coordinator = addNode(tree, { title: 'Координатор' });
    logToNode(tree, node.id, 'итог: тесты 12/12', 'claude');
    logToNode(tree, node.id, letterFrom(coordinator, 'а README поправил?', 1), 'агент');
    logToNode(tree, node.id, letterTo(coordinator, 'да, поправил', 2), 'claude');
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      sources: waitSources({ live: [live('bg-1', 'idle', { state: 'done' })], panes: [] }),
    });
    expect(result.settled[0]?.entry).toMatchObject({ source: 'claude', text: 'итог: тесты 12/12' });
  });

  it('gives a fresh session time to start, then times out with it still pending', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Свежая', { id: 'bg-2', started: ago(1000), opened: ago(1000) });
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      timeoutMs: 60,
      sources: waitSources({ live: [live('bg-2', 'idle')], panes: [] }),
    });
    expect(result.timedOut).toBe(true);
    expect(result.settled).toEqual([]);
    expect(result.pending).toMatchObject([{ id: node.id, session: { state: 'idle' } }]);
  });

  it('needs no grace once it has seen the session at work', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Быстрая', { id: 'bg-3', started: ago(1000), opened: ago(1000) });
    const world: World = { live: [live('bg-3', 'busy')], panes: [] };
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      timeoutMs: 5000,
      sources: waitSources(world, (count) => {
        if (count === 2) world.live = [live('bg-3', 'idle')];
      }),
    });
    expect(result.timedOut).toBe(false);
    expect(result.settled).toMatchObject([{ id: node.id, reason: 'idle' }]);
  });

  it('reports a session waiting for the person at once, with the end of its pane', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Вопрос', {
      id: 'p-1',
      mode: 'pane',
      pane: 'claude-aa',
      started: ago(1000),
      opened: ago(1000),
    });
    const result = await waitFor(tree.project.dir, [node.id], {
      ...fast,
      sources: waitSources({
        live: [live('p-1', 'waiting', { waitingFor: 'permission: Bash' })],
        panes: [pane('claude-aa', { sessionId: 'p-1' })],
        screens: { 'claude-aa': ['\u001b[1mДать доступ?\u001b[0m', '  1. Да', '  2. Нет', '', ''] },
      }),
    });
    expect(result.settled).toMatchObject([
      {
        reason: 'waiting',
        session: {
          state: 'waiting',
          waitingFor: 'permission: Bash',
          pane: 'claude-aa',
          screen: ['Дать доступ?', '  1. Да', '  2. Нет'],
        },
      },
    ]);
  });

  it('finds the session of a pane that named it late, and calls a gone pane «закончилась»', async () => {
    const tree = emptyTree();
    const named = nodeWithSession(tree, 'Codex', {
      id: 'pane:codex-bb',
      brain: 'codex',
      mode: 'pane',
      pane: 'codex-bb',
    });
    const asleep = nodeWithSession(tree, 'Спит', { id: 'p-2', mode: 'pane', pane: 'claude-gone' });
    const result = await waitFor(tree.project.dir, [named.id, asleep.id], {
      ...fast,
      all: true,
      sources: waitSources({
        live: [{ ...live('th-1', 'idle'), brain: 'codex' }],
        panes: [pane('codex-bb', { brain: 'codex', cwd: tree.project.dir })],
        paneSessions: { 'codex-bb': 'th-1' },
      }),
    });
    expect(result.settled).toMatchObject([
      { id: named.id, reason: 'idle', session: { id: 'th-1', pane: 'codex-bb' } },
      { id: asleep.id, reason: 'gone', session: { state: 'gone' } },
    ]);
  });

  it('takes the idle state of a Codex pane from its rollout, since Codex lists only busy sessions', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Codex', { id: 'th-2', brain: 'codex', mode: 'pane', pane: 'codex-cc' });
    const sources = waitSources({ live: [], panes: [pane('codex-cc', { brain: 'codex', sessionId: 'th-2' })] });
    const silent = await waitFor(tree.project.dir, [node.id], { ...fast, timeoutMs: 40, sources });
    expect(silent.pending).toMatchObject([{ session: { state: 'unknown' } }]);
    sources.idle = async (panes, asked) =>
      new Map([...asked, ...panes.map((p) => [p.sessionId!, live(p.sessionId!, 'idle')] as const)]);
    const idle = await waitFor(tree.project.dir, [node.id], { ...fast, sources });
    expect(idle.settled).toMatchObject([{ reason: 'idle', session: { id: 'th-2', state: 'idle', pane: 'codex-cc' } }]);
  });

  it('returns the result of a Claude turn from a worktree pane missing from the live list', async () => {
    const transcript = claudeTranscript();
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Claude', { id: transcript.sessionId, mode: 'pane', pane: 'claude-cc' });
    const sources = waitSources({ live: [], panes: [transcript.terminal], screens: { 'claude-cc': ['Итог хода'] } });
    sources.idle = (panes, asked) => withPaneIdle(panes, asked, { claude: transcript.claude });
    const tool = claudeAssistant('tool_use', ago(1000));
    transcript.write(tool, { type: 'user', message: { content: [{ type: 'tool_result' }] } });
    const busy = await waitFor(tree.project.dir, [node.id], { ...fast, timeoutMs: 40, sources });
    expect(busy.timedOut).toBe(true);
    expect(busy.pending).toMatchObject([{ status: 'active', session: { state: 'unknown' } }]);

    transcript.write(tool, { type: 'system', subtype: 'turn_duration', timestamp: ago(500) }, { type: 'last-prompt' });
    const idle = await waitFor(tree.project.dir, [node.id], { ...fast, timeoutMs: 100, sources });
    expect(idle.timedOut).toBe(false);
    expect(idle.settled).toMatchObject([
      { status: 'active', from: 'active', reason: 'idle', session: { state: 'idle', screen: ['Итог хода'] } },
    ]);
  });

  it('uses only current main-thread Claude completions and respects the live state', async () => {
    const { claude, sessionId, startedAt, terminal, write } = claudeTranscript();
    const states = (reported: SessionInfo[] = []) =>
      withPaneIdle([terminal], new Map(reported.map((info) => [info.id, info])), { claude });
    const complete = claudeAssistant('end_turn', startedAt);
    const stale = new Date(Date.parse(startedAt) - 1).toISOString();
    write({ ...complete, timestamp: stale });
    expect((await states()).has(sessionId)).toBe(false);
    write(complete, { type: 'user' });
    expect((await states()).has(sessionId)).toBe(false);
    write(complete, claudeAssistant('tool_use', ago(1000)));
    expect((await states()).has(sessionId)).toBe(false);
    write(claudeAssistant('tool_use', startedAt), claudeAssistant('end_turn', ago(1000), true));
    expect((await states()).has(sessionId)).toBe(false);

    write(complete, { type: 'custom-title' });
    expect((await states()).get(sessionId)?.live?.status).toBe('idle');
    const waiting = live(sessionId, 'waiting', { waitingFor: 'permission: Bash' });
    expect((await states([waiting])).get(sessionId)).toBe(waiting);
  });

  it('wakes when the tree changes and, with --all, waits for every node', async () => {
    const tree = emptyTree();
    const a = nodeWithSession(tree, 'Первый', { id: 'bg-a' });
    const b = nodeWithSession(tree, 'Второй', { id: 'bg-b' });
    const world: World = { live: [live('bg-a', 'busy'), live('bg-b', 'busy')], panes: [] };
    const sources = waitSources(world);
    const waiting = waitFor(tree.project.dir, [a.id, b.id], { intervalMs: 60_000, all: true, sources });
    await new Promise((done) => setTimeout(done, 30));
    setStatus(loadTree(tree.project.dir), a.id, 'review');
    sources.wake?.();
    await new Promise((done) => setTimeout(done, 30));
    setStatus(loadTree(tree.project.dir), b.id, 'waiting', { waiting: 'нужен ключ' });
    sources.wake?.();
    const result = await waiting;
    expect(result.settled.map((s) => [s.id, s.from, s.status])).toEqual([
      [a.id, 'active', 'review'],
      [b.id, 'active', 'waiting'],
    ]);
  });

  it('keeps the rows of a screen that have something on them, without colours', () => {
    expect(screenTail(['', '\u001b[2m❯ подсказка\u001b[0m', 'ответ', '', '   '], 5)).toEqual(['❯ подсказка', 'ответ']);
  });

  it('reads a timeout in seconds, minutes and hours', () => {
    expect(parseDuration('90')).toBe(90_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('10m')).toBe(600_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('10 мин')).toBeUndefined();
    expect(parseDuration('скоро')).toBeUndefined();
  });

  it('spots Claude Code and Codex startup dialogs on screen without false positives on prose or code', () => {
    expect(
      paneDialog(
        [
          '╭──────────────────────────────────────────────────╮',
          '│ \u001b[1mDo you trust the files in this folder?\u001b[0m          │',
          '│ /private/tmp/probe                               │',
          '│ ❯ 1. Yes, proceed                                │',
          '│   2. No, exit                                    │',
          '╰──────────────────────────────────────────────────╯',
          'Enter to confirm · Esc to cancel',
        ],
        'claude',
      ),
    ).toBe('folder-trust');

    expect(
      paneDialog(
        [
          'Accessing workspace:',
          '/private/tmp/probe',
          'Quick safety check: Is this a project you created',
          'or one you trust?',
          '❯ 1. Yes, I trust this folder',
          '  2. No, exit',
          'Enter to confirm · Esc to cancel',
        ],
        'claude',
      ),
    ).toBe('folder-trust');

    expect(
      paneDialog(
        [
          'Allow external CLAUDE.md file imports?',
          "This project's CLAUDE.md imports files outside the current working directory:",
          '  /Users/dev/AGENTS.md',
          '❯ 1. Yes, allow external imports',
          '  2. No, disable external imports',
          'Enter to confirm · Esc to cancel',
        ],
        'claude',
      ),
    ).toBe('external-imports');

    expect(paneDialog(['External includes', '  @../shared/CLAUDE.md', '❯ 1. Yes, allow', '  2. No'], 'claude')).toBe(
      'external-imports',
    );
    expect(paneDialog(['External includes', '❯ 1. Yes, allow', '  2. No'], 'codex')).toBeUndefined();

    expect(
      paneDialog(
        [
          'Do you trust the contents of this directory? Working with untrusted',
          'contents comes with higher risk of prompt injection.',
          '› 1. Yes, continue',
          '  2. No, quit',
          'Press enter to continue',
        ],
        'codex',
      ),
    ).toBe('folder-trust');

    expect(paneDialog(['Trust this directory?', '/tmp/probe', '› Yes, continue', '  No, quit'], 'codex')).toBe(
      'folder-trust',
    );

    // Ordinary prompt prose, code literals, a dialog already past, or another CLI never trigger it.
    expect(
      paneDialog([
        'Распознавать диалоги: «Do you trust the files in this folder?», «Yes, I trust this folder»,',
        '«Allow external CLAUDE.md file imports?», «Do you trust the contents of this directory?».',
      ]),
    ).toBeUndefined();
    expect(
      paneDialog([
        "  'Do you trust the files in this folder?',",
        "  '❯ 1. Yes, I trust this folder',",
        "  '  2. No, exit',",
      ]),
    ).toBeUndefined();
    expect(
      paneDialog([
        'Do you trust the files in this folder?',
        '❯ 1. Yes, I trust this folder',
        '  2. No, exit',
        '⏺ Читаю дерево проекта и проверяю файлы…',
        '  Готовлю план.',
      ]),
    ).toBeUndefined();
    expect(
      paneDialog(['Do you trust the files in this folder?', '❯ 1. Yes, proceed', '  2. No, exit'], 'opencode'),
    ).toBeUndefined();
  });

  it('reports startup dialogs at once in RU and EN, with tmux attach, even on a fresh or pending pane', async () => {
    const tree = emptyTree();
    const trust = nodeWithSession(tree, 'Доверие Claude', {
      id: 'c-1',
      mode: 'pane',
      pane: 'claude-trust',
      started: ago(500),
      opened: ago(500),
    });
    const imports = nodeWithSession(tree, 'Импорты Claude', {
      id: 'c-2',
      mode: 'pane',
      pane: 'claude-imports',
      started: ago(500),
      opened: ago(500),
    });
    const codex = nodeWithSession(tree, 'Доверие Codex', {
      id: 'pane:codex-trust',
      brain: 'codex',
      mode: 'pane',
      pane: 'codex-trust',
      started: ago(500),
      opened: ago(500),
    });
    const agy = nodeWithSession(tree, 'Доверие Antigravity', {
      id: 'pane:agy-trust',
      brain: 'antigravity',
      mode: 'pane',
      pane: 'agy-trust',
      started: ago(500),
      opened: ago(500),
    });
    const sources = waitSources({
      live: [],
      panes: [
        pane('claude-trust', { sessionId: 'c-1' }),
        pane('claude-imports', { sessionId: 'c-2' }),
        pane('codex-trust', { brain: 'codex' }),
        pane('agy-trust', { brain: 'antigravity' }),
      ],
      screens: {
        'claude-trust': [
          'Quick safety check: Is this a project you created or one you trust?',
          '❯ 1. Yes, I trust this folder',
          '  2. No, exit',
        ],
        'claude-imports': [
          'Allow external CLAUDE.md file imports?',
          '❯ 1. Yes, allow external imports',
          '  2. No, disable external imports',
        ],
        'codex-trust': ['Do you trust the contents of this directory?', '› 1. Yes, continue', '  2. No, quit'],
        'agy-trust': [
          'Accessing workspace:',
          '/tmp/project',
          'Do you trust the contents of this project?',
          'Antigravity CLI requires permission to read, edit, and execute files here.',
          '> Yes, I trust this folder',
          '  No, exit',
          '  ↑/↓ Navigate · enter Confirm',
        ],
      },
    });
    // Even if a resumed session already had an old transcript, the startup dialog on screen wins.
    sources.message = async () => 'старый ответ прошлого запуска';

    const ru = await waitFor(tree.project.dir, [trust.id, imports.id, codex.id, agy.id], {
      ...fast,
      all: true,
      sources,
    });
    expect(ru.timedOut).toBe(false);
    expect(ru.settled).toMatchObject([
      {
        id: trust.id,
        reason: 'waiting',
        session: {
          state: 'waiting',
          waitingFor: 'доверие к папке',
          pane: 'claude-trust',
          screen: [
            'Quick safety check: Is this a project you created or one you trust?',
            '❯ 1. Yes, I trust this folder',
            '  2. No, exit',
          ],
        },
      },
      {
        id: imports.id,
        reason: 'waiting',
        session: { state: 'waiting', waitingFor: 'внешние импорты CLAUDE.md', pane: 'claude-imports' },
      },
      {
        id: codex.id,
        reason: 'waiting',
        session: { brain: 'codex', id: null, state: 'waiting', waitingFor: 'доверие к папке', pane: 'codex-trust' },
      },
      {
        id: agy.id,
        reason: 'waiting',
        session: {
          brain: 'antigravity',
          id: null,
          state: 'waiting',
          waitingFor: 'доверие к папке',
          pane: 'agy-trust',
        },
      },
    ]);
    expect(ru.settled[0]?.session?.message).toBeUndefined();
    const ruText = waitText(ru, plain);
    expect(ruText).toContain('ждёт человека: доверие к папке');
    expect(ruText).toContain('ждёт человека: внешние импорты CLAUDE.md');
    expect(ruText).toContain('ответить в панели: tmux -L brainyard attach -t claude-trust');
    expect(ruText).toContain('ответить в панели: tmux -L brainyard attach -t claude-imports');
    expect(ruText).toContain('ответить в панели: tmux -L brainyard attach -t codex-trust');
    expect(ruText).toContain('ответить в панели: tmux -L brainyard attach -t agy-trust');

    setLang('en');
    const en = await waitFor(tree.project.dir, [imports.id, codex.id], { ...fast, all: true, sources });
    const enText = waitText(en, plain);
    expect(enText).toContain('waits for the person: external CLAUDE.md imports');
    expect(enText).toContain('waits for the person: folder trust');
    expect(enText).toContain('answer in the pane: tmux -L brainyard attach -t codex-trust');
  });

  it('spots an Antigravity folder-trust dialog even when its live status already says busy or idle', async () => {
    const tree = emptyTree();
    const agyBusy = nodeWithSession(tree, 'Доверие Antigravity busy', {
      id: 'agy-1',
      brain: 'antigravity',
      mode: 'pane',
      pane: 'agy-busy-trust',
      started: ago(500),
      opened: ago(500),
    });
    const agyIdle = nodeWithSession(tree, 'Доверие Antigravity idle', {
      id: 'agy-2',
      brain: 'antigravity',
      mode: 'pane',
      pane: 'agy-idle-trust',
      started: ago(60_000),
      opened: ago(60_000),
    });
    const trustScreen = [
      'Accessing workspace:',
      '/tmp/project',
      'Do you trust the contents of this project?',
      'Antigravity CLI requires permission to read, edit, and execute files here.',
      '> Yes, I trust this folder',
      '  No, exit',
      '  ↑/↓ Navigate · enter Confirm',
      '                                           auto · Gemini 4 Carbon · high',
    ];
    const sources = waitSources({
      live: [
        { ...live('agy-1', 'busy'), brain: 'antigravity' },
        { ...live('agy-2', 'idle'), brain: 'antigravity' },
      ],
      panes: [
        pane('agy-busy-trust', { brain: 'antigravity', sessionId: 'agy-1' }),
        pane('agy-idle-trust', { brain: 'antigravity', sessionId: 'agy-2' }),
      ],
      screens: {
        'agy-busy-trust': trustScreen,
        'agy-idle-trust': trustScreen,
      },
    });
    const res = await waitFor(tree.project.dir, [agyBusy.id, agyIdle.id], { ...fast, all: true, sources });
    expect(res.timedOut).toBe(false);
    expect(res.settled).toMatchObject([
      {
        id: agyBusy.id,
        reason: 'waiting',
        session: { brain: 'antigravity', state: 'waiting', waitingFor: 'доверие к папке', pane: 'agy-busy-trust' },
      },
      {
        id: agyIdle.id,
        reason: 'waiting',
        session: { brain: 'antigravity', state: 'waiting', waitingFor: 'доверие к папке', pane: 'agy-idle-trust' },
      },
    ]);
  });
});

/** Brainyard as send sees it, recording every call. */
function sendSources(world: World) {
  const calls: { typed: [string, string][]; stopped: string[]; opened: unknown[]; panes: unknown[] } = {
    typed: [],
    stopped: [],
    opened: [],
    panes: [],
  };
  const sources: SendSources = {
    live: async () => world.live,
    panes: async () => world.panes,
    capture: async (name) => (world.screens?.[name] ? { lines: world.screens[name]! } : undefined),
    type: async (name, data) => {
      calls.typed.push([name, data]);
    },
    startPane: (async (options: unknown) => {
      calls.panes.push(options);
      return { pane: 'claude-new', brain: 'claude', startedAt: new Date().toISOString(), warnings: [], display: '' };
    }) as unknown as SendSources['startPane'],
    open: (async (options: unknown) => {
      calls.opened.push(options);
      return { brain: 'claude', ok: true, exitCode: 0, background: true, startedAt: '', endedAt: '', warnings: [] };
    }) as unknown as SendSources['open'],
    stop: async (options) => {
      calls.stopped.push(options.sessionId);
      return 'stopped';
    },
    pause: async () => undefined,
  };
  return { sources, calls };
}

describe('treeyard send', () => {
  it('types into a live pane whose turn is over, as a paste, then Enter, and logs the letter with its number', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Панель', { id: 'p-1', mode: 'pane', pane: 'claude-aa' });
    const { sources, calls } = sendSources({
      live: [live('p-1', 'idle')],
      panes: [pane('claude-aa', { sessionId: 'p-1' })],
    });
    const sent = await sendToNode(tree, node.id, 'поправь тест\nи закоммить', { sources, source: 'claude' });
    expect(sent).toMatchObject({ how: 'typed', pane: 'claude-aa', letter: { n: 1, state: 'delivered' } });
    expect(calls.typed).toEqual([
      ['claude-aa', '\u001b[200~поправь тест\nи закоммить\u001b[201~'],
      ['claude-aa', '\r'],
    ]);
    const saved = loadTree(tree.project.dir).nodes.get(node.id)!;
    expect(journalEntries(saved.body).at(-1)).toMatch(
      / · claude · письмо №1 сессии claude p-1: «поправь тест и закоммить»$/,
    );
    expect(letterByNumber(tree.project.dir, 1)).toMatchObject({
      to: node.id,
      text: 'поправь тест\nи закоммить',
      state: 'delivered',
      delivered: { how: 'typed', session: 'claude p-1', pane: 'claude-aa' },
    });
    // `wait` gives the session time to take it from here.
    expect(Date.now() - Date.parse(saved.sessions[0]!.opened!)).toBeLessThan(5000);
  });

  it('queues a letter to a busy pane, then types it, with the next one, in one message once the turn is over', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Панель', { id: 'p-1', mode: 'pane', pane: 'claude-aa' });
    const world: World = { live: [live('p-1', 'busy')], panes: [pane('claude-aa', { sessionId: 'p-1' })] };
    const { sources, calls } = sendSources(world);
    const spawned: string[] = [];
    const first = await sendToNode(tree, node.id, 'первое', { sources, spawn: (dir) => spawned.push(dir) });
    const second = await sendToNode(tree, node.id, 'второе', { sources, spawn: (dir) => spawned.push(dir) });
    expect(first).toMatchObject({ held: 'busy', letter: { n: 1, state: 'queued' } });
    expect(second).toMatchObject({ held: 'busy', letter: { n: 2, state: 'queued' } });
    expect(calls.typed).toEqual([]);
    // The deliverer is started for what waits: nothing more is asked of the sender.
    expect(spawned.length).toBeGreaterThan(0);
    world.live = [live('p-1', 'idle')];
    const attempts = await deliverAll(tree.project.dir, { sources });
    expect(attempts).toMatchObject([{ node: node.id, letters: [1, 2], how: 'typed', pane: 'claude-aa' }]);
    expect(calls.typed[0]![1]).toBe('\u001b[200~первое\n\nвторое\u001b[201~');
    expect(queuedFor(tree.project.dir, node.id)).toEqual([]);
    // Just written to: its «idle» may be from before the message, so the next letter waits.
    await sendToNode(loadTree(tree.project.dir), node.id, 'третье', { sources, spawn: () => undefined });
    expect(letterByNumber(tree.project.dir, 3)).toMatchObject({ state: 'queued', held: 'busy' });
  });

  it('types a long letter in pieces cut between characters, inside one paste', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Панель', { id: 'p-1', mode: 'pane', pane: 'claude-aa' });
    const { sources, calls } = sendSources({
      live: [live('p-1', 'idle')],
      panes: [pane('claude-aa', { sessionId: 'p-1' })],
    });
    const long = `${'письмо 🌲 '.repeat(120)}конец`;
    await sendToNode(tree, node.id, long, { sources });
    const pieces = calls.typed.map(([, data]) => data);
    expect(pieces.length).toBeGreaterThan(3);
    expect(pieces.slice(0, -1).join('')).toBe(`\u001b[200~${long}\u001b[201~`);
    expect(pieces.at(-1)).toBe('\r');
    // No piece splits a character in two.
    for (const piece of pieces) expect(Buffer.from(piece, 'utf8').toString('utf8')).toBe(piece);
  });

  it('keeps a letter to a session that waits for the person, and says what it waits for', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Диалог', { id: 'p-1', mode: 'pane', pane: 'claude-aa' });
    const world: World = {
      live: [live('p-1', 'waiting', { waitingFor: 'permission: Bash' })],
      panes: [pane('claude-aa', { sessionId: 'p-1' })],
    };
    const { sources, calls } = sendSources(world);
    const sent = await sendToNode(tree, node.id, 'да', { sources, spawn: () => undefined });
    expect(sent).toMatchObject({ held: 'waiting', heldFor: 'permission: Bash', letter: { state: 'queued' } });
    expect(calls.typed).toEqual([]);
    world.live = [live('p-1', 'idle')];
    await deliverAll(tree.project.dir, { sources });
    expect(calls.typed.map(([, data]) => data)).toEqual(['\u001b[200~да\u001b[201~', '\r']);
  });

  it('holds letters as waiting on a startup dialog even past START_MS, instead of typing into the dialog', async () => {
    const tree = emptyTree();
    const claudeNode = nodeWithSession(tree, 'Доверие', {
      id: 'p-trust',
      mode: 'pane',
      pane: 'claude-trust',
      started: ago(120_000),
      opened: ago(120_000),
    });
    const codexNode = nodeWithSession(tree, 'Codex доверие', {
      id: 'pane:codex-trust',
      brain: 'codex',
      mode: 'pane',
      pane: 'codex-trust',
      started: ago(120_000),
      opened: ago(120_000),
    });
    const world: World = {
      live: [],
      panes: [pane('claude-trust', { sessionId: 'p-trust' }), pane('codex-trust', { brain: 'codex' })],
      screens: {
        'claude-trust': [
          'Allow external CLAUDE.md file imports?',
          '❯ 1. Yes, allow external imports',
          '  2. No, disable external imports',
        ],
        'codex-trust': ['Do you trust the contents of this directory?', '› 1. Yes, continue', '  2. No, quit'],
      },
    };
    const { sources, calls } = sendSources(world);
    const first = await sendToNode(tree, claudeNode.id, 'начинай', { sources, spawn: () => undefined });
    const second = await sendToNode(tree, codexNode.id, 'и ты начинай', { sources, spawn: () => undefined });
    expect(first).toMatchObject({
      held: 'waiting',
      heldFor: 'внешние импорты CLAUDE.md',
      letter: { state: 'queued', held: 'waiting', heldFor: 'внешние импорты CLAUDE.md' },
    });
    expect(second).toMatchObject({
      held: 'waiting',
      heldFor: 'доверие к папке',
      letter: { state: 'queued', held: 'waiting', heldFor: 'доверие к папке' },
    });
    expect(calls.typed).toEqual([]);

    // Another delivery pass while the dialogs stay on screen still holds both letters.
    const stillHeld = await deliverAll(tree.project.dir, { sources });
    expect(stillHeld).toMatchObject([
      { node: claudeNode.id, held: 'waiting', heldFor: 'внешние импорты CLAUDE.md' },
      { node: codexNode.id, held: 'waiting', heldFor: 'доверие к папке' },
    ]);
    expect(calls.typed).toEqual([]);

    // Once the person confirms in the panes and the turns end, the letters go in typed.
    world.screens = {};
    world.panes = [
      pane('claude-trust', { sessionId: 'p-trust' }),
      pane('codex-trust', { brain: 'codex', sessionId: 'th-trust' }),
    ];
    world.live = [live('p-trust', 'idle'), { ...live('th-trust', 'idle'), brain: 'codex' }];
    await deliverAll(tree.project.dir, { sources });
    expect(calls.typed).toEqual([
      ['claude-trust', '\u001b[200~начинай\u001b[201~'],
      ['claude-trust', '\r'],
      ['codex-trust', '\u001b[200~и ты начинай\u001b[201~'],
      ['codex-trust', '\r'],
    ]);
  });

  it('stops a background session that ended its turn and resumes it in the background with the letter', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Фон', { id: 'bg-1' });
    const { sources, calls } = sendSources({ live: [live('bg-1', 'idle', { state: 'working' })], panes: [] });
    const sent = await sendToNode(tree, node.id, 'добавь тест', { sources });
    expect(sent.how).toBe('resumed');
    expect(calls.stopped).toEqual(['bg-1']);
    expect(calls.opened).toMatchObject([
      {
        brain: 'claude',
        cwd: tree.project.dir,
        resume: 'bg-1',
        prompt: 'добавь тест',
        background: true,
        env: { TREEYARD_NODE: node.id },
      },
    ]);
  });

  it('resumes a finished background session without stopping it, and queues for a busy one', async () => {
    const tree = emptyTree();
    const done = nodeWithSession(tree, 'Кончилась', { id: 'bg-1' });
    const busy = nodeWithSession(tree, 'Работает', { id: 'bg-2' });
    const world: World = { live: [live('bg-2', 'busy')], panes: [] };
    const { sources, calls } = sendSources(world);
    await sendToNode(tree, done.id, 'ещё', { sources });
    expect(calls.stopped).toEqual([]);
    expect(calls.opened).toHaveLength(1);
    expect(await sendToNode(tree, busy.id, 'ещё', { sources, spawn: () => undefined })).toMatchObject({
      held: 'busy',
    });
    expect(calls.opened).toHaveLength(1);
    world.live = [live('bg-2', 'idle', { state: 'done' })];
    await deliverAll(tree.project.dir, { sources });
    expect(calls.opened).toHaveLength(2);
    expect(calls.opened[1]).toMatchObject({ resume: 'bg-2', prompt: 'ещё' });
  });

  it('wakes a sleeping pane with the letter and remembers the new pane', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Спит', { id: 'p-9', mode: 'pane', pane: 'claude-old' });
    const { sources, calls } = sendSources({ live: [], panes: [] });
    const sent = await sendToNode(tree, node.id, 'продолжай', { sources, size: { width: 120, height: 30 } });
    expect(sent).toMatchObject({ how: 'woke', pane: 'claude-new' });
    expect(calls.panes).toMatchObject([
      {
        brain: 'claude',
        resume: 'p-9',
        prompt: 'продолжай',
        label: 'Спит',
        width: 120,
        env: { TREEYARD_NODE: node.id },
      },
    ]);
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions).toMatchObject([
      { id: 'p-9', mode: 'pane', pane: 'claude-new' },
    ]);
  });

  it('wakes a sleeping OpenCode pane without the letter, and types it once the CLI is ready', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Спит OpenCode', {
      id: 'ses_9',
      brain: 'opencode',
      mode: 'pane',
      pane: 'opencode-old',
    });
    const world: World = { live: [], panes: [] };
    const { sources, calls } = sendSources(world);
    const sent = await sendToNode(tree, node.id, 'продолжай', { sources, spawn: () => undefined });
    // OpenCode's TUI loses a prompt given at its start: it wakes bare, the letter waits.
    expect(sent).toMatchObject({ held: 'starting', letter: { state: 'queued' } });
    expect(calls.panes).toHaveLength(1);
    expect(calls.panes[0]).toMatchObject({
      brain: 'opencode',
      resume: 'ses_9',
      env: { OPENCODE_DISABLE_AUTOUPDATE: '1' },
    });
    expect(calls.panes[0]).not.toHaveProperty('prompt');
    expect(loadTree(tree.project.dir).nodes.get(node.id)!.sessions).toMatchObject([
      { pane: 'claude-new', mode: 'pane' },
    ]);
    // OpenCode says nothing of an idle session: once it has had time to start, the letter goes in typed.
    world.panes = [pane('claude-new', { brain: 'opencode', sessionId: 'ses_9' })];
    const later = { ...sources, now: () => Date.now() + 60_000 };
    await deliverAll(tree.project.dir, { sources: later });
    expect(calls.typed).toEqual([
      ['claude-new', '\u001b[200~продолжай\u001b[201~'],
      ['claude-new', '\r'],
    ]);
  });

  it('keeps letters to a node without a session and to a session open in the person’s terminal', async () => {
    const tree = emptyTree();
    const bare = addNode(tree, { title: 'Пусто', status: 'active' });
    const terminal = nodeWithSession(tree, 'Терминал', { id: 't-1', mode: 'terminal' });
    const world: World = { live: [live('t-1', 'idle', { kind: 'interactive' })], panes: [] };
    const { sources, calls } = sendSources(world);
    const spawned: string[] = [];
    const spawn = (dir: string) => spawned.push(dir);
    expect(await sendToNode(tree, bare.id, 'привет', { sources, spawn })).toMatchObject({ held: 'none' });
    expect(journalEntries(loadTree(tree.project.dir).nodes.get(bare.id)!.body).at(-1)).toMatch(/письмо №1: «привет»$/);
    // Nobody to deliver it to until a session starts: no deliverer for it.
    expect(spawned).toEqual([]);
    expect(await sendToNode(tree, terminal.id, 'привет', { sources, spawn })).toMatchObject({ held: 'terminal' });
    expect(spawned).toHaveLength(1);
    expect(calls.typed).toEqual([]);
    // The person closed it: it wakes in a pane with the letter.
    world.live = [];
    await deliverAll(tree.project.dir, { sources });
    expect(calls.panes).toMatchObject([{ resume: 't-1', prompt: 'привет' }]);
    expect(letterByNumber(tree.project.dir, 2)).toMatchObject({ state: 'delivered', delivered: { how: 'woke' } });
    expect(letterByNumber(tree.project.dir, 1)).toMatchObject({ state: 'queued', held: 'none' });
  });

  it('gives the waiting letters to a new session of the node in its first message', () => {
    const tree = emptyTree();
    const coordinator = addNode(tree, { title: 'Координатор' });
    const node = addNode(tree, { title: 'Сайт', doneWhen: 'сайт открывается' });
    addLetter(tree.project.dir, { to: node.id, from: coordinator.id, text: 'возьми шаблон из docs/' });
    addLetter(tree.project.dir, { to: node.id, text: 'и без платных вызовов' });
    const plan = sessionPlan(tree, node.id, 'do', 'claude');
    expect(plan.letters).toEqual([1, 2]);
    expect(plan.prompt).toContain(
      `Письма узлу, которые ждали его сессии, — ответ тому, кто написал:\n\nПисьмо от сессии узла «Координатор» (${coordinator.id}), не от человека; ответ — treeyard send ${coordinator.id} "…":\nвозьми шаблон из docs/\n\nи без платных вызовов`,
    );
    markDelivered(tree.project.dir, plan.letters!, 'first', { session: 'claude 12345678' });
    expect(sessionPlan(tree, node.id, 'do', 'claude').letters).toBeUndefined();
    expect(letterByNumber(tree.project.dir, 2)).toMatchObject({ delivered: { how: 'first' } });
  });
});

describe('the mailbox and its deliverer', () => {
  it('numbers letters one after another, never twice, and keeps each whole', () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const a = addLetter(dir, { to: 'aaaa', text: 'раз' });
    // Somebody took the next number a moment ago: the letter gets the one after it.
    writeFileSync(join(mailDir(dir), '2.json'), JSON.stringify({ n: 2, to: 'bbbb', text: 'чужое', state: 'queued' }));
    const c = addLetter(dir, { to: 'aaaa', text: 'три\nстроки\nцеликом' });
    expect([a.n, c.n]).toEqual([1, 3]);
    expect(readMail(dir).map((item) => item.n)).toEqual([1, 2, 3]);
    expect(queuedFor(dir, 'aaaa').map((item) => item.text)).toEqual(['раз', 'три\nстроки\nцеликом']);
  });

  it('runs once per project, delivers as sessions free up, and stops when nothing is left to deliver', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const node = nodeWithSession(tree, 'Панель', { id: 'p-1', mode: 'pane', pane: 'claude-aa' });
    const bare = addNode(tree, { title: 'Пусто', status: 'active' });
    const world: World = { live: [live('p-1', 'busy')], panes: [pane('claude-aa', { sessionId: 'p-1' })] };
    const { sources, calls } = sendSources(world);
    await sendToNode(tree, node.id, 'когда освободишься', { sources, spawn: () => undefined });
    await sendToNode(tree, bare.id, 'тебе потом', { sources, spawn: () => undefined });
    let passes = 0;
    const running = runDeliverer(dir, {
      sources,
      intervalMs: 10,
      onAttempt: () => {
        passes++;
        if (passes === 3) world.live = [live('p-1', 'idle')];
      },
    });
    // A second one for the same project returns at once.
    expect(await runDeliverer(dir, { sources, intervalMs: 10 })).toBe(0);
    expect(delivererRunning(dir)).toBe(true);
    expect(await running).toBe(1);
    expect(calls.typed[0]).toEqual(['claude-aa', '\u001b[200~когда освободишься\u001b[201~']);
    expect(delivererRunning(dir)).toBe(false);
    // The letter to the node without a session waits for its first one.
    expect(queuedLetters(dir).map((item) => item.to)).toEqual([bare.id]);
  });

  it('is started only for letters a session can take, and only when none runs', () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Фон', { id: 'bg-1' });
    const bare = addNode(tree, { title: 'Пусто', status: 'active' });
    const started: string[] = [];
    const start = (dir: string) => started.push(dir);
    expect(ensureDeliverer(tree, start)).toBe(false);
    addLetter(tree.project.dir, { to: bare.id, text: 'потом' });
    expect(ensureDeliverer(tree, start)).toBe(false);
    addLetter(tree.project.dir, { to: node.id, text: 'сейчас' });
    expect(ensureDeliverer(tree, start)).toBe(true);
    expect(started).toEqual([tree.project.dir]);
    // TREEYARD_DELIVER=off (the tests' environment): the real one never starts.
    expect(ensureDeliverer(tree)).toBe(false);
  });
});
