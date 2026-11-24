import type { PaneInfo, SessionInfo } from '@antondanv/brainyard';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionPlan } from '../src/agents/context.js';
import { type SendSources, sendToNode } from '../src/agents/send.js';
import { setLang } from '../src/i18n/i18n.js';
import {
  letterFrom,
  letterState,
  lettersOf,
  letterText,
  letterTo,
  parseLetter,
  senderNode,
} from '../src/model/mail.js';
import { addLetter, markDelivered, markHeld } from '../src/model/mailbox.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode, attachSession, logToNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, treeyardIn } from './helpers.js';

afterEach(() => setLang('ru'));

/** A live pane for node `id`'s session, and Brainyard that only records what was typed. */
function paneNode(title: string, tree = emptyTree()) {
  const node = addNode(tree, { title, status: 'active' });
  // Opened a minute ago: a pane that has had time to start takes letters at once.
  const minute = new Date(Date.now() - 60_000).toISOString();
  const ref = {
    brain: 'claude' as const,
    id: `s-${node.id}`,
    mode: 'pane' as const,
    pane: `claude-${node.id}`,
    started: minute,
    opened: minute,
  };
  attachSession(tree, node.id, ref);
  return { tree, node, ref };
}

function typing(panes: PaneInfo[], live: SessionInfo[] = []) {
  const typed: [string, string][] = [];
  const sources: SendSources = {
    live: async () => live,
    panes: async () => panes,
    type: async (pane, data) => {
      typed.push([pane, data]);
    },
    startPane: (async () => {
      throw new Error('no pane should start');
    }) as unknown as SendSources['startPane'],
    open: (async () => {
      throw new Error('nothing should open');
    }) as unknown as SendSources['open'],
    stop: async () => 'stopped',
    pause: async () => undefined,
  };
  return { sources, typed };
}

describe('letters between the sessions of nodes', () => {
  it('go into the journals of both nodes when one node’s session writes to another', async () => {
    const { tree, node: to } = paneNode('Сайт');
    const from = addNode(tree, { title: 'Координатор', status: 'active' });
    const { sources, typed } = typing([
      { pane: `claude-${to.id}`, brain: 'claude', sessionId: `s-${to.id}`, attached: false, width: 80, height: 24 },
    ]);
    await sendToNode(tree, to.id, 'поправь заголовок', { sources, sender: from, source: 'claude' });
    expect(typed.map(([pane]) => pane)).toEqual([`claude-${to.id}`, `claude-${to.id}`]);
    // The other session reads whose letter it is and how to answer, not a message from the person.
    expect(typed[0]![1]).toBe(
      `\u001b[200~Письмо от сессии узла «Координатор» (${from.id}), не от человека; ответ — treeyard send ${from.id} "…":\nпоправь заголовок\u001b[201~`,
    );
    const saved = loadTree(tree.project.dir);
    expect(lettersOf(saved.nodes.get(to.id)!)).toMatchObject([
      { direction: 'in', peer: 'Координатор', text: 'поправь заголовок', who: 'claude' },
    ]);
    expect(lettersOf(saved.nodes.get(from.id)!)).toMatchObject([
      { direction: 'out', peer: 'Сайт', text: 'поправь заголовок' },
    ]);
  });

  it('name the session it went to when nobody’s node wrote it', async () => {
    const { tree, node } = paneNode('Сайт');
    const { sources } = typing([
      { pane: `claude-${node.id}`, brain: 'claude', sessionId: `s-${node.id}`, attached: false, width: 80, height: 24 },
    ]);
    await sendToNode(tree, node.id, 'привет', { sources, source: 'ты' });
    const [letter] = lettersOf(loadTree(tree.project.dir).nodes.get(node.id)!);
    expect(letter).toMatchObject({ direction: 'in', session: `claude s-${node.id}`, who: 'ты', text: 'привет' });
    expect(letterText(letter!)).toBe(`← №1 от ты в сессию claude s-${node.id}: «привет»`);
  });

  it('are read back in either language, and other entries are not letters', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'Бот' });
    const b = addNode(tree, { title: 'Сайт' });
    const ru = letterFrom(a, 'длинный\nтекст', 7);
    setLang('en');
    const en = letterTo(b, 'a reply', 8);
    expect(en).toBe('message #8 to node «Сайт»: «a reply»');
    setLang('ru');
    expect(parseLetter(`2026-11-22 21:45 · claude · ${ru}`)).toMatchObject({
      n: 7,
      direction: 'in',
      peer: 'Бот',
      text: 'длинный текст',
      at: '2026-11-22 21:45',
      who: 'claude',
    });
    expect(parseLetter(`2026-11-22 21:46 · агент · ${en}`)).toMatchObject({ n: 8, direction: 'out', peer: 'Сайт' });
    // Journals from before letters had numbers read as they did.
    expect(parseLetter('2026-11-22 21:44 · claude · письмо от «Бот»: «старое»')).toEqual({
      direction: 'in',
      peer: 'Бот',
      text: 'старое',
      at: '2026-11-22 21:44',
      who: 'claude',
    });
    expect(parseLetter('2026-11-22 21:44 · ты · письмо №3: «из shell»')).toMatchObject({ n: 3, direction: 'in' });
    expect(parseLetter('2026-11-22 21:47 · агент · в работе → на проверке')).toBeUndefined();
    expect(parseLetter('2026-11-22 21:47 · агент · итог: письмо от «Бот» дошло')).toBeUndefined();
  });

  it('know the sender only from a session of this very tree', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Координатор' });
    expect(senderNode(tree, { [NODE_VAR]: node.id, [PROJECT_VAR]: tree.project.dir })?.id).toBe(node.id);
    expect(senderNode(tree, { [NODE_VAR]: node.id, [PROJECT_VAR]: emptyTree().project.dir })).toBeUndefined();
    expect(senderNode(tree, { [NODE_VAR]: node.id })).toBeUndefined();
    expect(senderNode(tree, { [NODE_VAR]: 'zzzz', [PROJECT_VAR]: tree.project.dir })).toBeUndefined();
  });

  it('tell a session opened by a coordinator how to write back to it', () => {
    const tree = emptyTree();
    const coordinator = addNode(tree, { title: 'Координатор' });
    const child = addNode(tree, { title: 'Сайт', parent: coordinator.id, doneWhen: 'сайт открывается' });
    const plan = sessionPlan(tree, child.id, 'do', 'claude', 'без платных вызовов', coordinator);
    expect(plan.prompt).toContain('Задание к узлу:\nбез платных вызовов\n\nТебя запустила сессия узла «Координатор»');
    expect(plan.prompt).toContain(`send ${coordinator.id} "…"\`, затем закончи ход`);
    // Codex in its own sandbox may not reach the tree: if send fails, the question is its last message.
    const codex = sessionPlan(tree, child.id, 'do', 'codex', undefined, coordinator).prompt!;
    expect(codex).toContain(`send ${coordinator.id} "…"\`, затем закончи ход`);
    expect(codex).toContain('Команда упала (песочница) — задай вопрос последним сообщением и закончи ход');
    // Letters wait for a busy coordinator: none is lost.
    expect(plan.prompt).toContain('письмо не пропадёт, ответ придёт следующим сообщением');
    // Its own node, or no coordinator at all, adds nothing.
    expect(sessionPlan(tree, child.id, 'do', 'claude', undefined, child).prompt).not.toContain('Тебя запустила');
    expect(sessionPlan(tree, child.id, 'do', 'claude').prompt).not.toContain('Задание к узлу');
  });

  it('holds a letter for a pane on a startup dialog as waiting, and renders its reason in RU and EN', async () => {
    const { tree, node } = paneNode('Новый проект');
    const name = `claude-${node.id}`;
    const { sources, typed } = typing([
      { pane: name, brain: 'claude', sessionId: `s-${node.id}`, attached: false, width: 80, height: 24 },
    ]);
    sources.capture = async () => ({
      lines: ['Do you trust the files in this folder?', '❯ 1. Yes, I trust this folder', '  2. No, exit'],
    });
    const sent = await sendToNode(tree, node.id, 'привет', { sources, spawn: () => undefined });
    expect(typed).toEqual([]);
    expect(sent).toMatchObject({ held: 'waiting', heldFor: 'доверие к папке' });
    expect(letterState({ state: 'queued', held: sent.held, heldFor: sent.heldFor })).toBe(
      'в очереди: сессия ждёт человека — придёт, когда он ответит (доверие к папке)',
    );
    setLang('en');
    const enSent = await sendToNode(tree, node.id, 'hello', { sources, spawn: () => undefined });
    expect(enSent).toMatchObject({ held: 'waiting', heldFor: 'folder trust' });
    expect(letterState({ state: 'queued', held: enSent.held, heldFor: enSent.heldFor })).toBe(
      'queued: the session waits for the person — it arrives once they answer (folder trust)',
    );
  });
});

describe('show --only mail', () => {
  it('lists the letters of a node, got and sent, whole and with their state, in text and JSON', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const a = addNode(tree, { title: 'Бот' });
    const b = addNode(tree, { title: 'Сайт' });
    const asked = addLetter(dir, { to: b.id, from: a.id, who: 'claude', text: 'нужен ключ?\nи где он лежит' });
    logToNode(tree, a.id, letterTo(b, asked.text, asked.n), 'claude');
    logToNode(tree, a.id, 'обычная запись', 'claude');
    const answer = addLetter(dir, { to: a.id, from: b.id, who: 'codex', text: 'да, в .env' });
    logToNode(tree, a.id, letterFrom(b, answer.text, answer.n), 'codex');
    markDelivered(dir, [asked.n], 'typed', { session: 'codex 1a2b3c4d', pane: 'codex-aa' });
    markHeld(dir, [answer.n], 'busy');
    // A letter from before the mailbox: the journal's line, no state.
    logToNode(tree, a.id, 'письмо от «Сайт»: «старое»', 'codex');
    const sh = treeyardIn(dir);
    const text = await sh('show', a.id, '--only', 'письма');
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toMatch(
      /письма:\n {2}→ \S+ \S+ {2}№1 узлу «Сайт»: «нужен ключ\?\n {6}и где он лежит» · доставлено: набрано в панели\n {2}← \S+ \S+ {2}№2 от «Сайт»: «да, в \.env» · в очереди: сессия занята — придёт, когда она закончит ход\n {2}← \S+ \S+ {2}от «Сайт»: «старое»\n/,
    );
    expect(text.stdout).not.toContain('обычная запись');
    const json = JSON.parse((await sh('show', a.id, '--only', 'mail', '--json')).stdout);
    expect(json.mail).toMatchObject([
      { n: 1, direction: 'out', peer: 'Сайт', who: 'claude', state: 'delivered', how: 'typed' },
      { n: 2, direction: 'in', peer: 'Сайт', who: 'codex', text: 'да, в .env', state: 'queued', held: 'busy' },
      { direction: 'in', peer: 'Сайт', text: 'старое' },
    ]);
    const other = await sh('show', b.id, '--only', 'mail');
    // The mailbox knows the letters of a node whose journal has no line of them.
    expect(other.stdout).toMatch(/№1 от «Бот»: «нужен ключ\?/);
    const none = await sh('show', addNode(tree, { title: 'Тихий' }).id, '--only', 'mail');
    expect(none.stdout).toContain('письма: —');
  }, 40_000);
});
