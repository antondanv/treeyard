import { beforeEach, describe, expect, it } from 'vitest';

import { contextText, sessionPlan } from '../src/agents/context.js';
import { taskArg } from '../src/cli/commands.js';
import { setLang } from '../src/i18n/i18n.js';
import { addNode } from '../src/model/ops.js';
import { ROOT } from '../src/model/types.js';
import { emptyTree, withStdin } from './helpers.js';

const TASK = 'без платных вызовов; "завод" не перезапускать';

beforeEach(() => setLang('ru'));

describe('a coordinator task in the first message', () => {
  it('goes after the standard prompt as its own paragraph in plan, do and goal', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Бот', doneWhen: 'бот отвечает' });
    for (const start of ['plan', 'do', 'goal'] as const) {
      const base = sessionPlan(tree, node.id, start, 'claude');
      const plan = sessionPlan(tree, node.id, start, 'claude', TASK);
      expect(plan.prompt).toBe(`${base.prompt}\n\nЗадание к узлу:\n${TASK}`);
      expect(plan.system).toBe(base.system);
      expect(plan.permissionMode).toBe(base.permissionMode);
    }
  });

  it('is labeled in English too', () => {
    setLang('en');
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Bot', doneWhen: 'bot answers' });
    expect(sessionPlan(tree, node.id, 'do', 'codex', 'no paid calls').prompt).toContain(
      '\n\nTask for this node:\nno paid calls',
    );
  });

  it('becomes the first message in chat, with no "wait for my question"', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Бот' });
    expect(sessionPlan(tree, node.id, 'chat', 'claude').prompt).toBeUndefined();
    const plan = sessionPlan(tree, node.id, 'chat', 'claude', `  ${TASK}\n`);
    expect(plan.prompt).toBe(TASK);
    expect(plan.system).not.toContain('Дождись моего вопроса');
    expect(sessionPlan(tree, ROOT, 'chat', 'claude', TASK).prompt).toBe(TASK);
  });

  it('is ignored when empty, so calls without a task work as before', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Бот', doneWhen: 'x' });
    expect(sessionPlan(tree, node.id, 'do', 'claude', '  ').prompt).toBe(
      sessionPlan(tree, node.id, 'do', 'claude').prompt,
    );
  });
});

describe('--task parsing', () => {
  it('takes the text, reads stdin for "-", rejects an empty one', async () => {
    expect(await taskArg(undefined)).toBeUndefined();
    expect(await taskArg('  one ')).toBe('one');
    expect(await taskArg('-', async () => 'long "quoted"\n')).toBe('long "quoted"');
    await expect(taskArg('-', async () => '\n')).rejects.toThrow();
    await expect(taskArg('')).rejects.toThrow();
  });

  it('waits for a slow pipe on stdin instead of failing with EAGAIN', async () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Бот', doneWhen: 'бот отвечает' });
    const res = await withStdin(tree.project.dir, { late: `${TASK}\n` }, 'context', node.id, '--task', '-');
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`Задание к узлу:\n${TASK}\n`);
  }, 40_000);
});

describe('the coordinator line in the tree commands', () => {
  const OPEN = 'open <id> --bg --task';

  it('is in the root context and in a node with unfinished children, not in a leaf', () => {
    for (const lang of ['ru', 'en'] as const) {
      setLang(lang);
      const tree = emptyTree();
      const parent = addNode(tree, { title: 'Направление' });
      const kid = addNode(tree, { title: 'Шаг', parent: parent.id });
      const leaf = addNode(tree, { title: 'Лист' });
      expect(contextText(tree, ROOT)).toContain(OPEN);
      expect(contextText(tree, parent.id)).toContain(OPEN);
      expect(contextText(tree, leaf.id)).not.toContain(OPEN);
      expect(contextText(tree, kid.id)).not.toContain(OPEN);
    }
  });

  it('disappears when every child is closed', () => {
    const tree = emptyTree();
    const parent = addNode(tree, { title: 'Направление' });
    addNode(tree, { title: 'Шаг', parent: parent.id, status: 'done' });
    addNode(tree, { title: 'Отброшен', parent: parent.id, status: 'dropped' });
    expect(contextText(tree, parent.id)).not.toContain(OPEN);
  });
});
