import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { journalEntries } from '../src/model/journal.js';
import { addNode, setStatus } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

// A Claude Code stand-in with real background processes and its own state (CLAUDE_CONFIG_DIR).
const fixture = fileURLToPath(new URL('./fixtures/background-cli.mjs', import.meta.url));
const homes: string[] = [];

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const workers = (home: string): { pid: number; sessionId: string }[] => {
  const state = join(home, 'background.json');
  return existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : [];
};

afterEach(async () => {
  for (const home of homes.splice(0)) {
    const pids = workers(home)
      .map((row) => row.pid)
      .filter(running);
    for (const pid of pids) process.kill(pid, 'SIGTERM');
    const end = Date.now() + 5000;
    while (pids.some(running) && Date.now() < end) await new Promise((done) => setTimeout(done, 20));
  }
});

function setup() {
  const tree = emptyTree();
  const home = tempDir('treeyard-claude-home-');
  homes.push(home);
  const sh = treeyardIn(tree.project.dir, {
    CLAUDE_CONFIG_DIR: home,
    BRAINYARD_CLAUDE_BIN: JSON.stringify([process.execPath, fixture]),
  });
  const launches = (): { args: string[]; node: string }[] => {
    const log = join(home, 'launches.jsonl');
    return existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];
  };
  return { tree, home, sh, launches };
}

describe('treeyard wait from the shell', () => {
  it('answers at once for a node in review, and runs out of time on one in progress', async () => {
    const { tree, sh } = setup();
    const done = addNode(tree, { title: 'Готовое', status: 'active' });
    const busy = addNode(tree, { title: 'В работе', status: 'active' });
    setStatus(tree, done.id, 'review');
    const now = await sh('wait', done.id, busy.id);
    expect(now.code, now.stderr).toBe(0);
    expect(now.stdout).toContain(`◎ Готовое  ${done.id}  на проверке`);
    expect(now.stdout).toMatch(new RegExp(`ещё в работе:\\n◐ В работе  ${busy.id}  в работе`));

    const late = await sh('wait', busy.id, '--timeout', '1s');
    expect(late.code).toBe(124);
    expect(late.stderr).toContain('время вышло (1s)');
  }, 40_000);

  it('wakes when the node leaves «в работе» and says so in JSON', async () => {
    const { tree, sh } = setup();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    const waiting = sh('wait', node.id, '--json', '--timeout', '20s');
    await new Promise((done) => setTimeout(done, 2500));
    const log = await sh('log', node.id, 'итог: всё сделано', '--status', 'review', '--as', 'claude');
    expect(log.code, log.stderr).toBe(0);
    const res = await waiting;
    expect(res.code, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      version: 1,
      timedOut: false,
      settled: [
        {
          node: node.id,
          from: 'active',
          status: 'review',
          reason: 'status',
          entry: { who: 'claude', text: 'итог: всё сделано' },
        },
      ],
      pending: [],
    });
  }, 40_000);

  it('says what is wrong with its arguments', async () => {
    const { tree, sh } = setup();
    const node = addNode(tree, { title: 'Узел', status: 'active' });
    for (const args of [[], ['root'], [node.id, '--timeout', 'скоро']]) {
      const res = await sh('wait', ...args);
      expect(res.code, args.join(' ')).toBe(2);
    }
  }, 40_000);

  it('sees a background session at work, then reports the moment its run is over', async () => {
    const { tree, home, sh } = setup();
    const node = addNode(tree, { title: 'Фон', doneWhen: 'фон работает' });
    const open = await sh('open', node.id, '--bg', '--start', 'do', '--yes', '--json');
    expect(open.code, open.stderr).toBe(0);
    const session = JSON.parse(open.stdout).id as string;
    const waiting = sh('wait', node.id, '--timeout', '25s');
    await new Promise((done) => setTimeout(done, 4000));
    for (const row of workers(home)) process.kill(row.pid, 'SIGTERM');
    const res = await waiting;
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain(`сессия claude ${session.slice(0, 8)} · закончила ход`);
  }, 60_000);
});

describe('treeyard send from the shell', () => {
  it('refuses a node without a session, in text and in JSON', async () => {
    const { tree, sh } = setup();
    const node = addNode(tree, { title: 'Пусто', status: 'active' });
    const text = await sh('send', node.id, 'привет');
    expect(text.code).toBe(1);
    expect(text.stderr).toContain(`у узла ${node.id} нет сессии`);
    const json = await sh('send', node.id, 'привет', '--json');
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({ node: node.id, sent: false });
  }, 40_000);

  it('leaves a busy background session alone, and resumes it with the message once it has ended', async () => {
    const { tree, home, sh, launches } = setup();
    const node = addNode(tree, { title: 'Фон', doneWhen: 'фон работает' });
    const open = await sh('open', node.id, '--bg', '--start', 'do', '--yes', '--json');
    const session = JSON.parse(open.stdout).id as string;

    const busy = await sh('send', node.id, 'добавь тест');
    expect(busy.code).toBe(1);
    expect(busy.stderr).toContain('ещё работает — дождись её: treeyard wait');

    for (const row of workers(home)) process.kill(row.pid, 'SIGTERM');
    await new Promise((done) => setTimeout(done, 300));
    const sent = await sh('send', node.id, 'добавь тест', '--as', 'claude');
    expect(sent.code, sent.stderr).toBe(0);
    expect(sent.stdout).toContain(`фоновая сессия ${session.slice(0, 8)} продолжена с письмом`);
    const resumed = launches().at(-1)!;
    expect(resumed.node).toBe(node.id);
    expect(resumed.args).toEqual(expect.arrayContaining(['--resume', session, '--bg', '--', 'добавь тест']));
    const entries = journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body);
    expect(entries.at(-1)).toMatch(
      new RegExp(`· claude · письмо сессии claude ${session.slice(0, 8)}: «добавь тест»$`),
    );
  }, 60_000);
});
