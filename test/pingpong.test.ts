import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { lastWork, mailLimit, pingPong } from '../src/agents/pingpong.js';
import { PingPongStop, type SendSources, sendToNode } from '../src/agents/send.js';
import { appendJournal, journalEntries } from '../src/model/journal.js';
import { addLetter, readMail } from '../src/model/mailbox.js';
import { NODE_VAR, PROJECT_VAR } from '../src/model/notes.js';
import { addNode, logToNode, setStatus } from '../src/model/ops.js';
import { loadTree, projectFromText, projectToText, writeNode } from '../src/model/store.js';
import { stamp } from '../src/model/time.js';
import type { Tree, TreeNode } from '../src/model/types.js';
import { ensureWorktree, worktreeParent } from '../src/worktree.js';
import { emptyTree, treeyardIn } from './helpers.js';

/** Brainyard that sees no session: a letter just waits in the mailbox, nothing is typed or started. */
const sources: SendSources = {
  live: async () => [],
  panes: async () => [],
  type: async () => {},
  startPane: (async () => {
    throw new Error('no pane should start');
  }) as unknown as SendSources['startPane'],
  open: (async () => {
    throw new Error('nothing should open');
  }) as unknown as SendSources['open'],
  stop: async () => 'stopped',
  pause: async () => undefined,
};

/** Two nodes whose journals have been quiet since long ago: only what a test does counts. */
function pair(tree: Tree = emptyTree()) {
  const a = addNode(tree, { title: 'Координатор', status: 'active' });
  const b = addNode(tree, { title: 'Сайт', status: 'active' });
  for (const node of [a, b]) quiet(tree, node);
  return { tree, a, b };
}

/** The node's journal as of long ago, as if it had done nothing since. */
function quiet(tree: Tree, node: TreeNode): void {
  node.body = node.body.replace(/^- \d{4}-\d{2}-\d{2} \d{2}:\d{2}/gm, '- 2026-01-01 10:00');
  node.body = appendJournal(node.body, '2026-01-01 10:00 · агент · завёл узел');
  writeNode(tree.project.dir, node, false);
}

/** `count` letters between the pair, one way and the other in turn, as the CLI writes them. */
async function exchange(tree: Tree, a: TreeNode, b: TreeNode, count: number) {
  for (let i = 0; i < count; i++) {
    const [from, to] = i % 2 === 0 ? [a, b] : [b, a];
    await sendToNode(tree, to.id, `письмо ${i + 1}`, { sources, sender: from, source: 'claude' });
  }
}

const nonLetterLines = (node: TreeNode) => journalEntries(node.body).filter((line) => !line.includes('письмо №'));

describe('the brake on letters going round in a circle', () => {
  it('lets six letters through and stops the seventh, telling the sender what to do', async () => {
    const { tree, a, b } = pair();
    await exchange(tree, a, b, 6);
    const lines = journalEntries(b.body).length;
    const error = await sendToNode(tree, b.id, 'ещё одно', { sources, sender: a, source: 'claude' }).catch((e) => e);
    expect(error).toBeInstanceOf(PingPongStop);
    expect(error.stop).toEqual({ letters: 6, limit: 6, from: a.id, to: b.id });
    expect(error.message).toBe(
      [
        'письмо не отправлено: у «Координатор» и «Сайт» писем подряд — 6 (предел 6), а записи в журнал, смены статуса или коммита ни у одного из них за это время не было — похоже, сессии переписываются по кругу',
        'Спроси координатора или человека, как быть; сделал своё дело — запиши его в журнал (treeyard log), счёт начнётся заново.',
        'Координатор или человек велел продолжать — то же письмо с --force.',
      ].join('\n  '),
    );
    // Nothing of it is written: no letter, no journal line, on either node.
    expect(readMail(tree.project.dir)).toHaveLength(6);
    expect(journalEntries(b.body)).toHaveLength(lines);
    // The other direction is stopped just the same: the pair, not the sender, is counted.
    await expect(sendToNode(tree, a.id, 'и ответ', { sources, sender: b })).rejects.toBeInstanceOf(PingPongStop);
  });

  it('goes on with --force, and the letter is a letter like any other', async () => {
    const { tree, a, b } = pair();
    await exchange(tree, a, b, 6);
    const sent = await sendToNode(tree, b.id, 'продолжай', { sources, sender: a, source: 'claude', force: true });
    expect(sent.letter.n).toBe(7);
    expect(readMail(tree.project.dir)).toHaveLength(7);
    // Forcing is for this letter: the next one is stopped again until someone does something else.
    await expect(sendToNode(tree, b.id, 'ещё', { sources, sender: a })).rejects.toBeInstanceOf(PingPongStop);
  });

  it('starts counting again after a journal entry that is not a letter, from either node', async () => {
    for (const writer of ['sender', 'addressee'] as const) {
      const { tree, a, b } = pair();
      await exchange(tree, a, b, 6);
      await expect(sendToNode(tree, b.id, 'ещё', { sources, sender: a })).rejects.toBeInstanceOf(PingPongStop);
      logToNode(tree, writer === 'sender' ? a.id : b.id, 'поправил тест; осталось проверить', 'claude');
      const sent = await sendToNode(tree, b.id, 'готово, глянь', { sources, sender: a, source: 'claude' });
      expect(sent.letter.n).toBe(7);
    }
  });

  it('starts counting again after a change of status', async () => {
    const { tree, a, b } = pair();
    await exchange(tree, a, b, 6);
    setStatus(tree, b.id, 'review');
    expect(nonLetterLines(tree.nodes.get(b.id)!).some((line) => line.includes('на проверке'))).toBe(true);
    await sendToNode(tree, a.id, 'на проверке', { sources, sender: b, source: 'claude' });
    expect(readMail(tree.project.dir)).toHaveLength(7);
  });

  it('starts counting again after a commit, but not one made before the letters', async () => {
    const { tree, a, b } = pair();
    await exchange(tree, a, b, 6);
    const before = Date.now() - 3_600_000;
    await expect(
      sendToNode(tree, b.id, 'ещё', { sources, sender: a, commitAt: (_dir, id) => (id === a.id ? before : undefined) }),
    ).rejects.toBeInstanceOf(PingPongStop);
    const sent = await sendToNode(tree, b.id, 'ещё', {
      sources,
      sender: a,
      commitAt: (_dir, id) => (id === b.id ? Date.now() : undefined),
    });
    expect(sent.letter.n).toBe(7);
  });

  it('does not count the letters themselves as something else done', async () => {
    const { tree, a, b } = pair();
    await exchange(tree, a, b, 6);
    // Each letter is a journal line on both nodes, and the node's last work is still the old one.
    expect(journalEntries(a.body).filter((line) => line.includes('письмо №'))).toHaveLength(6);
    expect(lastWork(a, tree.project.dir, () => undefined)).toBe(new Date(2026, 0, 1, 10, 0, 59, 999).getTime());
  });

  it('counts only the pair: letters to others and from a shell are not part of it', async () => {
    const { tree, a, b } = pair();
    const c = addNode(tree, { title: 'Бот', status: 'active' });
    quiet(tree, c);
    await exchange(tree, a, b, 5);
    // Six letters from a shell and three to a third node change nothing for the pair.
    for (let i = 0; i < 6; i++) await sendToNode(tree, b.id, `от человека ${i}`, { sources, source: 'ты' });
    for (let i = 0; i < 3; i++) await sendToNode(tree, c.id, `другому ${i}`, { sources, sender: a, source: 'claude' });
    const sent = await sendToNode(tree, b.id, 'шестое', { sources, sender: a, source: 'claude' });
    expect(sent.letter.n).toBe(15);
    await expect(sendToNode(tree, b.id, 'седьмое', { sources, sender: a })).rejects.toBeInstanceOf(PingPongStop);
  });

  it('never stops a letter from a shell without a node, however many', async () => {
    const { tree, b } = pair();
    for (let i = 0; i < 12; i++) await sendToNode(tree, b.id, `письмо ${i}`, { sources, source: 'ты' });
    expect(readMail(tree.project.dir)).toHaveLength(12);
  });

  it('takes the limit from the project: a number, or 0 for none', async () => {
    const { tree, a, b } = pair();
    expect(mailLimit(tree.project)).toBe(6);
    tree.project.mailLimit = 2;
    await exchange(tree, a, b, 2);
    await expect(sendToNode(tree, b.id, 'третье', { sources, sender: a })).rejects.toBeInstanceOf(PingPongStop);
    tree.project.mailLimit = 0;
    expect(pingPong(tree, a.id, b.id)).toBeUndefined();
    await exchange(tree, a, b, 10);
    expect(readMail(tree.project.dir)).toHaveLength(12);
  });

  it('is cheap when the pair has written little: no journals, no git', async () => {
    const { tree, a, b } = pair();
    await exchange(tree, a, b, 5);
    const asked: string[] = [];
    expect(pingPong(tree, a.id, b.id, { commitAt: (_dir, id) => void asked.push(id) })).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('counts only the letters that came after the last thing either node did', () => {
    const { tree, a, b } = pair();
    const hour = 3_600_000;
    // Four letters two hours ago, work an hour ago, two letters since: two in a row, not six.
    for (let i = 0; i < 4; i++)
      addLetter(tree.project.dir, {
        to: b.id,
        from: a.id,
        text: 'давно',
        at: new Date(Date.now() - 2 * hour).toISOString(),
      });
    a.body = appendJournal(a.body, `${stamp(new Date(Date.now() - hour))} · claude · поправил тест`);
    for (let i = 0; i < 2; i++) addLetter(tree.project.dir, { to: a.id, from: b.id, text: 'недавно' });
    expect(pingPong(tree, a.id, b.id)).toBeUndefined();
    tree.project.mailLimit = 2;
    expect(pingPong(tree, a.id, b.id)).toEqual({ letters: 2, limit: 2, from: a.id, to: b.id });
  });
});

describe('the limit in the project’s tree.md', () => {
  it('is read and written as mail_limit, 0 included', () => {
    const tree = emptyTree();
    for (const [value, limit] of [
      [10, 10],
      [0, 0],
    ] as const) {
      tree.project.mailLimit = value;
      const again = projectFromText(projectToText(tree.project), tree.project.dir);
      expect(again.mailLimit).toBe(value);
      expect(mailLimit(again)).toBe(limit);
    }
    delete tree.project.mailLimit;
    expect(projectToText(tree.project)).not.toContain('mail_limit');
    expect(mailLimit(tree.project)).toBe(6);
  });

  it('reports a value that is not a whole number and uses the default', () => {
    const problems: string[] = [];
    const project = projectFromText('---\ntitle: Т\nmail_limit: много\n---\n', '/tmp/x', problems);
    expect(project.mailLimit).toBeUndefined();
    expect(problems).toEqual(['tree.md: mail_limit — целое число, 0 — без тормоза']);
    expect(projectFromText('---\ntitle: Т\nmail_limit: -1\n---\n', '/tmp/x', []).mailLimit).toBeUndefined();
  });
});

describe('commits of a node’s worktree', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    }).trim();
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(worktreeParent(dir), { recursive: true, force: true });
  });

  it('count as something else done, read from the branch with no hook', async () => {
    const { tree, a, b } = pair();
    const main = tree.project.dir;
    made.push(main);
    writeFileSync(join(main, 'app.txt'), 'код\n');
    writeFileSync(join(main, '.gitignore'), '.tree/.local/\n');
    git(main, 'init', '-q', '-b', 'main');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'start');
    const { worktree } = await ensureWorktree(loadTree(main), a.id);
    writeFileSync(join(worktree.path, 'work.txt'), 'работа\n');
    git(worktree.path, 'add', 'work.txt');
    git(worktree.path, 'commit', '-q', '-m', 'feat: work');
    const hour = 3_600_000;
    const letters = (at: number) => {
      for (let i = 0; i < 6; i++)
        addLetter(main, {
          to: i % 2 ? a.id : b.id,
          from: i % 2 ? b.id : a.id,
          text: 'туда-сюда',
          at: new Date(at).toISOString(),
        });
    };
    // Six letters an hour ago, the commit after them: the commit is the work done since.
    letters(Date.now() - hour);
    expect(pingPong(tree, a.id, b.id)).toBeUndefined();
    // Six more, an hour from now (the commit cannot be after them): nothing done since, stopped.
    letters(Date.now() + hour);
    expect(pingPong(tree, a.id, b.id)).toMatchObject({ letters: 6, from: a.id, to: b.id });
    // The node without a worktree has no commits to show.
    expect(lastWork(tree.nodes.get(b.id)!, main)).toBeLessThan(Date.now() - hour);
  });
});

describe('treeyard send in a node’s session', () => {
  const asNode = (tree: Tree, node: TreeNode) =>
    treeyardIn(tree.project.dir, { [NODE_VAR]: node.id, [PROJECT_VAR]: tree.project.dir });

  /** Six letters already between the pair, and both journals quiet: the next one is the seventh. */
  function stalled() {
    const { tree, a, b } = pair();
    for (let i = 0; i < 6; i++)
      addLetter(tree.project.dir, { to: i % 2 ? a.id : b.id, from: i % 2 ? b.id : a.id, text: `письмо ${i + 1}` });
    return { tree, a, b };
  }

  it('does not send the seventh letter, says why and what to do, and exits 1', async () => {
    const { tree, a, b } = stalled();
    const sh = asNode(tree, a);
    const result = await sh('send', b.id, 'ещё одно');
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('письмо не отправлено: у «Координатор» и «Сайт» писем подряд — 6 (предел 6)');
    expect(result.stderr).toContain('Спроси координатора или человека');
    expect(result.stderr).toContain('--force');
    expect(readMail(tree.project.dir)).toHaveLength(6);
  });

  it('puts the reason into --json', async () => {
    const { tree, a, b } = stalled();
    const result = await asNode(tree, a)('send', b.id, 'ещё одно', '--json');
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      node: b.id,
      sent: false,
      reason: 'ping-pong',
      from: a.id,
      letters: 6,
      limit: 6,
    });
    expect(JSON.parse(result.stdout).error).toContain('--force');
  });

  it('sends with --force', async () => {
    const { tree, a, b } = stalled();
    const result = await asNode(tree, a)('send', b.id, 'продолжаем', '--force', '--json');
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ sent: true, letter: 7 });
  });

  it('does not brake a letter from a shell without a node', async () => {
    const { tree, a, b } = stalled();
    const result = await treeyardIn(tree.project.dir)('send', b.id, 'от человека', '--json');
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ sent: true, letter: 7 });
    // And the person's own letter does not make the pair’s count any longer: still the sixth stopped.
    const again = await asNode(tree, a)('send', b.id, 'ещё одно');
    expect(again.code).toBe(1);
  });

  it('is set by `treeyard config mail_limit`: a number, off, and back to the default', async () => {
    const { tree, a, b } = stalled();
    const sh = treeyardIn(tree.project.dir);
    const shown = await sh('config');
    expect(shown.stdout).toMatch(/mail_limit\s+6 \(по умолчанию\)/);
    expect((await sh('config', 'mail_limit', '8')).stdout).toBe('mail_limit = 8\n');
    expect(loadTree(tree.project.dir).project.mailLimit).toBe(8);
    // Eight is more than the six letters between them: not stopped.
    expect((await asNode(tree, a)('send', b.id, 'можно', '--json')).code).toBe(0);
    expect((await sh('config', 'mail_limit', 'off')).stdout).toBe('mail_limit = off\n');
    expect(loadTree(tree.project.dir).project.mailLimit).toBe(0);
    // Without a value it shows, and does not reset.
    expect((await sh('config', 'mail_limit')).stdout).toBe('off\n');
    expect((await sh('config', 'mail_limit', 'default')).stdout).toBe('mail_limit = 6 (по умолчанию)\n');
    expect(loadTree(tree.project.dir).project.mailLimit).toBeUndefined();
    const bad = await sh('config', 'mail_limit', 'много');
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('mail_limit: число писем подряд, off — без тормоза, default — как по умолчанию');
  });
});
