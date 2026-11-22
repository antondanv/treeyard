import type { PaneInfo, SessionInfo } from '@antondanv/brainyard';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionPlan } from '../src/agents/context.js';
import { type SendSources, sendToNode } from '../src/agents/send.js';
import { setLang } from '../src/i18n/i18n.js';
import { letterFrom, lettersOf, letterText, letterTo, parseLetter, senderNode } from '../src/model/mail.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode, attachSession, logToNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, treeyardIn } from './helpers.js';

afterEach(() => setLang('ru'));

/** A live pane for node `id`'s session, and Brainyard that only records what was typed. */
function paneNode(title: string, tree = emptyTree()) {
  const node = addNode(tree, { title, status: 'active' });
  const ref = { brain: 'claude' as const, id: `s-${node.id}`, mode: 'pane' as const, pane: `claude-${node.id}` };
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
    expect(letterText(letter!)).toBe(`← от ты в сессию claude s-${node.id}: «привет»`);
  });

  it('are read back in either language, and other entries are not letters', () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'Бот' });
    const b = addNode(tree, { title: 'Сайт' });
    const ru = letterFrom(a, 'длинный\nтекст');
    setLang('en');
    const en = letterTo(b, 'a reply');
    expect(en).toBe('message to node «Сайт»: «a reply»');
    setLang('ru');
    expect(parseLetter(`2026-11-22 21:45 · claude · ${ru}`)).toMatchObject({
      direction: 'in',
      peer: 'Бот',
      text: 'длинный текст',
      at: '2026-11-22 21:45',
      who: 'claude',
    });
    expect(parseLetter(`2026-11-22 21:46 · агент · ${en}`)).toMatchObject({ direction: 'out', peer: 'Сайт' });
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
    // Codex's sandbox keeps it away from tmux: its question is its last message.
    const codex = sessionPlan(tree, child.id, 'do', 'codex', undefined, coordinator).prompt!;
    expect(codex).toContain('задай последним сообщением и закончи ход');
    expect(codex).not.toContain(' send ');
    // Its own node, or no coordinator at all, adds nothing.
    expect(sessionPlan(tree, child.id, 'do', 'claude', undefined, child).prompt).not.toContain('Тебя запустила');
    expect(sessionPlan(tree, child.id, 'do', 'claude').prompt).not.toContain('Задание к узлу');
  });
});

describe('show --only mail', () => {
  it('lists the letters of a node, got and sent, in text and JSON', async () => {
    const tree = emptyTree();
    const a = addNode(tree, { title: 'Бот' });
    const b = addNode(tree, { title: 'Сайт' });
    logToNode(tree, a.id, letterTo(b, 'нужен ключ?'), 'claude');
    logToNode(tree, a.id, 'обычная запись', 'claude');
    logToNode(tree, a.id, letterFrom(b, 'да, в .env'), 'codex');
    const sh = treeyardIn(tree.project.dir);
    const text = await sh('show', a.id, '--only', 'письма');
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toMatch(
      /письма:\n {2}→ \S+ \S+ {2}узлу «Сайт»: «нужен ключ\?»\n {2}← \S+ \S+ {2}от «Сайт»: «да, в \.env»/,
    );
    expect(text.stdout).not.toContain('обычная запись');
    const json = JSON.parse((await sh('show', a.id, '--only', 'mail', '--json')).stdout);
    expect(json.mail).toMatchObject([
      { direction: 'out', peer: 'Сайт', who: 'claude' },
      { direction: 'in', peer: 'Сайт', who: 'codex', text: 'да, в .env' },
    ]);
    const none = await sh('show', b.id, '--only', 'mail');
    expect(none.stdout).toContain('письма: —');
  }, 40_000);
});
