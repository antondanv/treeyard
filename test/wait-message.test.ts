import type { PaneInfo, SessionInfo } from '@antondanv/brainyard';
import { describe, expect, it } from 'vitest';

import { readLastMessage } from '../src/agents/last-message.js';
import { type WaitSources, waitFor } from '../src/agents/wait.js';
import { paint } from '../src/cli/print.js';
import { messageOf, sightBlock, waitJson, waitText } from '../src/cli/wait-text.js';
import { addNode, attachSession, logToNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { SessionRef, Tree } from '../src/model/types.js';
import { emptyTree } from './helpers.js';

const plain = paint({ isTTY: false } as NodeJS.WriteStream);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function nodeWithSession(tree: Tree, title: string, ref: Partial<SessionRef> & { id: string }) {
  const node = addNode(tree, { title, status: 'active' });
  attachSession(tree, node.id, {
    brain: 'claude',
    mode: 'pane',
    started: ago(60_000),
    opened: ago(60_000),
    ...ref,
  });
  return node;
}

const live = (id: string, status: string): SessionInfo =>
  ({ brain: 'claude', id, interactive: true, live: { status, kind: 'interactive' } }) as SessionInfo;

const pane = (name: string, sessionId: string): PaneInfo => ({
  pane: name,
  brain: 'claude',
  sessionId,
  attached: false,
  width: 100,
  height: 30,
});

/** Brainyard as the wait sees it: what the sessions say, what their screens show, who is asked. */
function sources(options: {
  live: SessionInfo[];
  panes?: PaneInfo[];
  screens?: Record<string, string[]>;
  message?: WaitSources['message'];
}) {
  const asked = { captured: [] as string[], messages: [] as string[] };
  const made: WaitSources = {
    load: loadTree,
    live: async () => options.live,
    panes: async () => options.panes ?? [],
    paneSession: async () => undefined,
    capture: async (name) => {
      asked.captured.push(name);
      const lines = options.screens?.[name];
      return lines
        ? {
            lines,
            width: 100,
            height: 30,
            cursor: { x: 0, y: 0, visible: true },
            historySize: 0,
            scrollOffset: 0,
            mouseTracking: false,
            mouseSgr: false,
            alternate: false,
          }
        : undefined;
    },
    idle: async (_panes, known) => known,
    watch: () => ({ stop: () => undefined }),
    now: () => Date.now(),
  };
  if (options.message) {
    const read = options.message;
    made.message = async (brain, id) => {
      asked.messages.push(`${brain} ${id}`);
      return read(brain, id);
    };
  }
  return { sources: made, asked };
}

/** A question of several paragraphs and about forty rows: far over twelve rows and 600 signs. */
const LONG = [
  'Нашёл две развилки, мне нужен твой выбор.',
  '',
  ...Array.from({ length: 36 }, (_, row) => `${row + 1}. Вариант ${row + 1}: ${'подробности '.repeat(6).trim()}`),
  '',
  'Какой берём — A или B?',
].join('\n');

const fast = { intervalMs: 5, graceMs: 30_000 };

describe('treeyard wait: the last message of a session', () => {
  it('takes the whole message from the transcript, whatever its length, and leaves the screen alone', async () => {
    expect(LONG.length).toBeGreaterThan(2000);
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Длинный вопрос', { id: 'p-1', pane: 'claude-aa' });
    const { sources: made, asked } = sources({
      live: [live('p-1', 'idle')],
      panes: [pane('claude-aa', 'p-1')],
      screens: { 'claude-aa': ['последние строки экрана'] },
      message: async () => LONG,
    });
    const result = await waitFor(tree.project.dir, [node.id], { ...fast, sources: made });
    expect(result.settled[0]?.session?.message).toBe(LONG);
    expect(result.settled[0]?.session?.screen).toBeUndefined();
    expect(asked.messages).toEqual(['claude p-1']);
    // The screen is only the fallback: no transcript to read, no reason to ask the pane.
    expect(asked.captured).toEqual([]);
  });

  it('falls back to the end of the screen when there is no transcript to read', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Без стенограммы', { id: 'p-2', pane: 'claude-bb' });
    const screens = { 'claude-bb': ['\u001b[1mДать доступ?\u001b[0m', '  1. Да', '  2. Нет'] };
    const base = { live: [live('p-2', 'waiting')], panes: [pane('claude-bb', 'p-2')], screens };
    // A Brainyard that has no reader (the source is absent), one that finds no message, one that fails.
    for (const message of [undefined, async () => undefined, async () => Promise.reject(new Error('нет файла'))]) {
      const { sources: made } = sources({ ...base, ...(message ? { message } : {}) });
      const result = await waitFor(tree.project.dir, [node.id], { ...fast, sources: made });
      expect(result.settled[0]?.session).toMatchObject({ screen: ['Дать доступ?', '  1. Да', '  2. Нет'] });
      expect(result.settled[0]?.session?.message).toBeUndefined();
    }
  });

  it('reads the summary of a session that is gone — a finished run has no pane to look at', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Закончилась', { id: 'bg-1', mode: 'background', pane: undefined });
    const { sources: made, asked } = sources({ live: [], message: async () => 'Готово: 12 тестов зелёные.' });
    const result = await waitFor(tree.project.dir, [node.id], { ...fast, sources: made });
    expect(result.settled).toMatchObject([
      { reason: 'gone', session: { state: 'gone', message: 'Готово: 12 тестов зелёные.' } },
    ]);
    expect(asked.captured).toEqual([]);
  });

  it('does not look for a transcript of a session that has no id yet', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Ещё без id', {
      id: 'pane:codex-cc',
      brain: 'codex',
      pane: 'codex-cc',
    });
    const { sources: made, asked } = sources({
      live: [],
      panes: [{ ...pane('codex-cc', ''), brain: 'codex', sessionId: undefined, cwd: tree.project.dir }],
      screens: { 'codex-cc': ['вопрос на экране'] },
      message: async () => 'чужое сообщение',
    });
    made.idle = async (panes, known) =>
      new Map([...known, ...panes.map((p) => [p.pane, live(p.pane, 'idle')] as const)]);
    const result = await waitFor(tree.project.dir, [node.id], { ...fast, timeoutMs: 40, sources: made });
    expect(asked.messages).toEqual([]);
    expect(result.settled.concat(result.pending)[0]?.session?.message).toBeUndefined();
  });

  it('does not read the transcript of a session that is still at work', async () => {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Работает', { id: 'p-3', pane: 'claude-dd' });
    const { sources: made, asked } = sources({
      live: [live('p-3', 'busy')],
      panes: [pane('claude-dd', 'p-3')],
      message: async () => 'промежуточное',
    });
    const result = await waitFor(tree.project.dir, [node.id], { ...fast, timeoutMs: 40, sources: made });
    expect(result.timedOut).toBe(true);
    expect(asked.messages).toEqual([]);
  });
});

describe('treeyard wait: the text and the JSON', () => {
  async function sight(message: WaitSources['message'], screens?: Record<string, string[]>) {
    const tree = emptyTree();
    const node = nodeWithSession(tree, 'Длинный вопрос', { id: 'p-1', pane: 'claude-aa' });
    logToNode(tree, node.id, `итог: ${'очень длинная запись журнала '.repeat(30)}`, 'claude');
    const { sources: made } = sources({
      live: [live('p-1', 'idle')],
      panes: [pane('claude-aa', 'p-1')],
      ...(screens ? { screens } : {}),
      ...(message ? { message } : {}),
    });
    return waitFor(tree.project.dir, [node.id], { ...fast, sources: made });
  }

  it('prints the message whole, under its own heading, with a short pointer to the journal entry', async () => {
    const result = await sight(async () => LONG, { 'claude-aa': ['экран'] });
    const text = waitText(result, plain);
    expect(text).toContain('последнее сообщение:');
    expect(text).not.toContain('конец экрана:');
    // Every row of it, none cut: neither at twelve rows nor at 600 signs.
    for (const row of LONG.split('\n')) expect(text).toContain(row ? `│ ${row}` : '│');
    expect(text).toContain('Какой берём — A или B?');
    expect(text).not.toContain('экран\n');
    // The journal entry is long; next to the whole message it is a pointer.
    const entry = text.split('\n').find((line) => line.includes('итог:'))!;
    expect(entry.length).toBeLessThan(260);
    expect(entry.endsWith('…')).toBe(true);
  });

  it('prints the end of the screen, as before, where there is no transcript', async () => {
    const result = await sight(undefined, { 'claude-aa': ['вопрос', 'на экране'] });
    const text = waitText(result, plain);
    expect(text).toContain('конец экрана:');
    expect(text).not.toContain('последнее сообщение:');
    expect(text).toContain('│ вопрос');
    expect(text).toContain('│ на экране');
    // No message to point at: the journal entry keeps its long form.
    const entry = text.split('\n').find((line) => line.includes('итог:'))!;
    expect(entry.length).toBeGreaterThan(400);
  });

  it('gives --json the message as a field of its own, not inside the session', async () => {
    const whole = await sight(async () => LONG, { 'claude-aa': ['экран'] });
    const json = waitJson(whole) as { settled: Record<string, unknown>[] };
    expect(json.settled[0]).toMatchObject({ message: { text: LONG, source: 'transcript' } });
    expect(json.settled[0]!.session).not.toHaveProperty('message');
    expect(json.settled[0]!.session).not.toHaveProperty('screen');

    const screen = waitJson(await sight(undefined, { 'claude-aa': ['вопрос', 'на экране'] })) as typeof json;
    expect(screen.settled[0]).toMatchObject({
      message: { text: 'вопрос\nна экране', source: 'screen' },
      session: { screen: ['вопрос', 'на экране'] },
    });

    const nothing = waitJson(await sight(undefined)) as typeof json;
    expect(nothing.settled[0]).toMatchObject({ message: null });
  });

  it('shows no message for a node that has no session', () => {
    expect(messageOf(undefined)).toBeNull();
    const block = sightBlock(
      { id: 'abcd', title: 'Без сессии', status: 'review', from: 'active', reason: 'status' },
      plain,
    );
    expect(block).not.toContain('│');
  });
});

describe('Brainyard’s lastMessage', () => {
  it('is asked for the session by its CLI and id, and gives the text', async () => {
    const calls: unknown[][] = [];
    const lib = {
      lastMessage: async (...args: unknown[]) => {
        calls.push(args);
        return { text: '\n  Вопрос целиком.\n\n', at: '2026-11-23T20:00:00Z' };
      },
    };
    expect(await readLastMessage(lib, 'codex', 'th-1')).toBe('Вопрос целиком.');
    expect(calls).toEqual([['codex', 'th-1']]);
  });

  it('gives nothing when Brainyard has no reader yet, or finds no message', async () => {
    expect(await readLastMessage({}, 'claude', 'a')).toBeUndefined();
    expect(await readLastMessage({ lastMessage: 'не функция' }, 'claude', 'a')).toBeUndefined();
    expect(await readLastMessage({ lastMessage: async () => undefined }, 'claude', 'a')).toBeUndefined();
    expect(await readLastMessage({ lastMessage: async () => ({ text: '  ' }) }, 'claude', 'a')).toBeUndefined();
    expect(await readLastMessage({ lastMessage: async () => ({ text: 5 }) }, 'claude', 'a')).toBeUndefined();
  });
});
