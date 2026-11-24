import type { PaneInfo, SessionInfo } from '@antondanv/brainyard';
import { describe, expect, it } from 'vitest';

import {
  type AnswerSources,
  answerQuestion,
  dialogOptions,
  isQuestion,
  NotAnswered,
  waitReply,
} from '../src/agents/reply.js';
import { type SendSources, sendToNode } from '../src/agents/send.js';
import { type WaitSources, waitFor } from '../src/agents/wait.js';
import { journalEntries } from '../src/model/journal.js';
import { mailOf } from '../src/model/mail.js';
import { addLetter, letterByNumber, markDelivered } from '../src/model/mailbox.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import type { Tree } from '../src/model/types.js';
import { emptyTree } from './helpers.js';

const minute = () => new Date(Date.now() - 60_000).toISOString();

/** A node «в работе» whose session runs in pane `claude-<id>`. */
function paneNode(tree: Tree, title: string) {
  const node = addNode(tree, { title, status: 'active' });
  attachSession(tree, node.id, {
    brain: 'claude',
    id: `s-${node.id}`,
    mode: 'pane',
    pane: `claude-${node.id}`,
    started: minute(),
    opened: minute(),
  });
  return node;
}

const pane = (name: string, session: string): PaneInfo => ({
  pane: name,
  brain: 'claude',
  sessionId: session,
  attached: false,
  width: 100,
  height: 30,
});

const live = (id: string, status: string, extra: Record<string, unknown> = {}): SessionInfo =>
  ({ brain: 'claude', id, interactive: true, live: { status, kind: 'interactive', ...extra } }) as SessionInfo;

/** The sessions of the machine as a test sets them, for every reader at once. */
interface World {
  live: SessionInfo[];
  panes: PaneInfo[];
  screens: Record<string, string[]>;
}

function sources(world: World) {
  const typed: [string, string][] = [];
  const send: SendSources & AnswerSources = {
    live: async () => world.live,
    panes: async () => world.panes,
    type: async (name, data) => {
      typed.push([name, data]);
    },
    keys: async (name, data) => {
      typed.push([name, data]);
    },
    capture: async (name) => (world.screens[name] ? { lines: world.screens[name]! } : undefined),
    startPane: (async () => {
      throw new Error('no pane should start');
    }) as unknown as SendSources['startPane'],
    open: (async () => {
      throw new Error('nothing should open');
    }) as unknown as SendSources['open'],
    stop: async () => 'stopped',
    pause: async () => undefined,
  };
  const wait: WaitSources = {
    load: loadTree,
    live: async () => world.live,
    panes: async () => world.panes,
    paneSession: async () => undefined,
    capture: async (name) =>
      world.screens[name]
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
    watch: () => ({ stop: () => undefined }),
    now: () => Date.now(),
  };
  return { send, wait, typed };
}

const fast = { intervalMs: 5, graceMs: 0 };

/** Claude Code's question dialog, as a pane showed it on 23.11. */
const QUESTION = [
  ' ☐ Цвет',
  'Какой цвет?',
  '❯ 1. красный',
  '     Красный цвет',
  '  2. зелёный',
  '     Зелёный цвет',
  '  3. синий',
  '     Синий цвет',
  '  4. Type something.',
  '────────────────────────────────',
  '  5. Chat about this',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
];

describe('an answer to a letter', () => {
  it('is the next letter back from the addressee’s node, marked as answering it', async () => {
    const tree = emptyTree();
    const coordinator = paneNode(tree, 'Координатор');
    const site = paneNode(tree, 'Сайт');
    const world: World = {
      live: [live(`s-${site.id}`, 'busy'), live(`s-${coordinator.id}`, 'busy')],
      panes: [],
      screens: {},
    };
    const { send } = sources(world);
    const asked = await sendToNode(tree, site.id, 'какой порт?', {
      sources: send,
      sender: coordinator,
      spawn: () => undefined,
    });
    const answered = await sendToNode(loadTree(tree.project.dir), coordinator.id, '8080', {
      sources: send,
      sender: site,
      spawn: () => undefined,
    });
    expect(answered.letter).toMatchObject({ n: 2, replyTo: 1, from: site.id, to: coordinator.id });
    expect(asked.letter.replyTo).toBeUndefined();
    const mail = mailOf(loadTree(tree.project.dir), loadTree(tree.project.dir).nodes.get(coordinator.id)!);
    expect(mail.map((letter) => [letter.n, letter.direction, letter.replyTo])).toEqual([
      [1, 'out', undefined],
      [2, 'in', 1],
    ]);
  });

  it('send --wait gets the answer, and the sender’s session is not typed it again', async () => {
    const tree = emptyTree();
    const coordinator = addNode(tree, { title: 'Координатор', status: 'active' });
    const site = paneNode(tree, 'Сайт');
    const dir = tree.project.dir;
    const sent = addLetter(dir, { to: site.id, from: coordinator.id, text: 'какой порт?' });
    const world: World = { live: [live(`s-${site.id}`, 'busy')], panes: [], screens: {} };
    const { wait } = sources(world);
    const waiting = waitReply(dir, sent, { ...fast, sources: wait, timeoutMs: 2000 });
    await new Promise((done) => setTimeout(done, 30));
    addLetter(dir, { to: coordinator.id, from: site.id, text: '8080', replyTo: sent.n });
    const result = await waiting;
    expect(result).toMatchObject({ timedOut: false, reply: { n: 2, text: '8080', state: 'delivered' } });
    expect(letterByNumber(dir, 2)?.delivered?.how).toBe('wait');
  });

  it('send --wait says when the session ended its turn without one, with the end of its screen', async () => {
    const tree = emptyTree();
    const coordinator = addNode(tree, { title: 'Координатор', status: 'active' });
    const site = paneNode(tree, 'Сайт');
    const dir = tree.project.dir;
    const sent = addLetter(dir, { to: site.id, from: coordinator.id, text: 'какой порт?' });
    const world: World = {
      live: [live(`s-${site.id}`, 'busy')],
      panes: [pane(`claude-${site.id}`, `s-${site.id}`)],
      screens: { [`claude-${site.id}`]: ['⏺ Порт не нашёл — в README его нет.'] },
    };
    const { wait } = sources(world);
    // Queued: the session's state says nothing about the letter yet.
    const early = await waitReply(dir, sent, { ...fast, sources: wait, timeoutMs: 50 });
    expect(early).toMatchObject({ timedOut: true });
    markDelivered(dir, [sent.n], 'typed');
    world.live = [live(`s-${site.id}`, 'idle')];
    const result = await waitReply(dir, sent, { ...fast, sources: wait, timeoutMs: 2000 });
    expect(result.reply).toBeUndefined();
    expect(result.sight).toMatchObject({
      reason: 'idle',
      session: { screen: ['⏺ Порт не нашёл — в README его нет.'] },
    });
  });

  it('wait of the coordinator returns with a letter its node got, whole, and hands it over', async () => {
    const tree = emptyTree();
    const coordinator = addNode(tree, { title: 'Координатор', status: 'active' });
    const site = paneNode(tree, 'Сайт');
    const bot = paneNode(tree, 'Бот');
    const dir = tree.project.dir;
    const world: World = { live: [live(`s-${site.id}`, 'busy'), live(`s-${bot.id}`, 'busy')], panes: [], screens: {} };
    const { wait } = sources(world);
    const nothing = await waitFor(dir, [site.id, bot.id], {
      ...fast,
      sources: wait,
      inbox: coordinator.id,
      timeoutMs: 30,
    });
    expect(nothing).toMatchObject({ timedOut: true, letters: [] });
    addLetter(dir, { to: coordinator.id, from: site.id, text: 'нужен ключ API\nи доступ к staging' });
    const result = await waitFor(dir, [site.id, bot.id], { ...fast, sources: wait, inbox: coordinator.id });
    expect(result.letters).toMatchObject([
      { n: 1, from: site.id, fromTitle: 'Сайт', text: 'нужен ключ API\nи доступ к staging' },
    ]);
    expect(result.settled).toMatchObject([{ id: site.id, reason: 'letter' }]);
    expect(result.pending.map((sight) => sight.id)).toEqual([bot.id]);
    expect(letterByNumber(dir, 1)?.delivered?.how).toBe('wait');
    // Handed over: the next wait does not return with it again.
    const again = await waitFor(dir, [site.id], { ...fast, sources: wait, inbox: coordinator.id, timeoutMs: 30 });
    expect(again.letters).toEqual([]);
  });
});

describe('the person’s answer to a question in a dialog', () => {
  it('reads the choices off the screen, and tells a question from a permission', () => {
    expect(dialogOptions(QUESTION)).toEqual([
      { n: 1, label: 'красный', selected: true, free: false },
      { n: 2, label: 'зелёный', selected: false, free: false },
      { n: 3, label: 'синий', selected: false, free: false },
      { n: 4, label: 'Type something', selected: false, free: true },
      { n: 5, label: 'Chat about this', selected: false, free: false },
    ]);
    // Codex's question dialog.
    expect(dialogOptions(['Question 1/1', 'Which port?', '› 1. 8080', '  2. 3000', '  3. Other'])).toMatchObject([
      { n: 1, selected: true },
      { n: 2 },
      { n: 3, label: 'Other', free: true },
    ]);
    expect(isQuestion('input needed')).toBe(true);
    expect(isQuestion('input')).toBe(true);
    expect(isQuestion('approve Bash')).toBe(false);
    expect(isQuestion('approval')).toBe(false);
    expect(isQuestion('dialog open')).toBe(false);
    expect(isQuestion(undefined)).toBe(false);
  });

  it('moves to the choice and presses Enter, by its number or its words', async () => {
    const tree = emptyTree();
    const node = paneNode(tree, 'Вопрос');
    const name = `claude-${node.id}`;
    const world: World = {
      live: [live(`s-${node.id}`, 'waiting', { waitingFor: 'input needed' })],
      panes: [pane(name, `s-${node.id}`)],
      screens: { [name]: QUESTION },
    };
    const { send, typed } = sources(world);
    const answered = await answerQuestion(tree, node.id, '3', { sources: send, source: 'ты' });
    expect(answered.option).toMatchObject({ n: 3, label: 'синий' });
    expect(typed).toEqual([
      [name, '\u001b[B'],
      [name, '\u001b[B'],
      [name, '\r'],
    ]);
    expect(journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body).at(-1)).toMatch(
      / · ты · ответ человека в диалог: «3\. синий»$/,
    );
    typed.length = 0;
    await answerQuestion(loadTree(tree.project.dir), node.id, 'Зелёный', { sources: send });
    expect(typed).toEqual([
      [name, '\u001b[B'],
      [name, '\r'],
    ]);
  });

  it('puts any other text into the row of one’s own answer', async () => {
    const tree = emptyTree();
    const node = paneNode(tree, 'Вопрос');
    const name = `claude-${node.id}`;
    const world: World = {
      live: [live(`s-${node.id}`, 'waiting', { waitingFor: 'input needed' })],
      panes: [pane(name, `s-${node.id}`)],
      screens: { [name]: QUESTION },
    };
    const { send, typed } = sources(world);
    const answered = await answerQuestion(tree, node.id, 'бирюзовый', { sources: send });
    expect(answered).toMatchObject({ option: { n: 4 }, text: 'бирюзовый' });
    expect(typed).toEqual([
      [name, '\u001b[B'],
      [name, '\u001b[B'],
      [name, '\u001b[B'],
      [name, '\u001b[200~бирюзовый\u001b[201~'],
      [name, '\r'],
    ]);
  });

  it('never answers a permission, a session that does not wait, or a dialog without choices', async () => {
    const tree = emptyTree();
    const node = paneNode(tree, 'Вопрос');
    const name = `claude-${node.id}`;
    const world: World = {
      live: [live(`s-${node.id}`, 'waiting', { waitingFor: 'approve Bash' })],
      panes: [pane(name, `s-${node.id}`)],
      screens: { [name]: ['Do you want to proceed?', '❯ 1. Yes', '  2. No'] },
    };
    const { send, typed } = sources(world);
    await expect(answerQuestion(tree, node.id, '1', { sources: send })).rejects.toThrow(
      /ждёт разрешения \(approve Bash\) — его даёт только человек/,
    );
    world.live = [live(`s-${node.id}`, 'busy')];
    await expect(answerQuestion(tree, node.id, '1', { sources: send })).rejects.toThrow(NotAnswered);
    world.live = [live(`s-${node.id}`, 'waiting', { waitingFor: 'input needed' })];
    world.screens[name] = ['Какой цвет?'];
    await expect(answerQuestion(tree, node.id, '1', { sources: send })).rejects.toThrow(/не вижу вариантов/);
    world.screens[name] = ['❯ 1. красный', '  2. зелёный'];
    await expect(answerQuestion(tree, node.id, 'бирюзовый', { sources: send })).rejects.toThrow(
      /нет такого варианта.*1\. красный · 2\. зелёный/,
    );
    expect(typed).toEqual([]);
  });
});
