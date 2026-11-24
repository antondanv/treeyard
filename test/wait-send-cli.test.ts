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

function setup(extra: NodeJS.ProcessEnv = {}) {
  const tree = emptyTree();
  const home = tempDir('treeyard-claude-home-');
  homes.push(home);
  const sh = treeyardIn(tree.project.dir, {
    CLAUDE_CONFIG_DIR: home,
    BRAINYARD_CLAUDE_BIN: JSON.stringify([process.execPath, fixture]),
    ...extra,
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
  it('queues a letter to a node without a session, and the node’s first session gets it', async () => {
    const { tree, sh, launches } = setup();
    const node = addNode(tree, { title: 'Пусто', doneWhen: 'фон работает' });
    const text = await sh('send', node.id, 'возьми шаблон из docs/', '--as', 'ты');
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain('письмо №1 в очереди: у узла нет сессии — письмо получит первая');
    expect(text.stdout).toContain(`начать её: treeyard open ${node.id} --bg|--pane --task "…"`);
    const json = await sh('send', node.id, 'и без платных вызовов', '--json');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      node: node.id,
      sent: true,
      letter: 2,
      state: 'queued',
      held: 'none',
      how: null,
    });
    const open = await sh('open', node.id, '--bg', '--start', 'do', '--yes', '--json');
    expect(open.code, open.stderr).toBe(0);
    const prompt = launches().at(-1)!.args.at(-1)!;
    expect(prompt).toContain('Письма узлу, которые ждали его сессии');
    expect(prompt).toContain('возьми шаблон из docs/\n\nи без платных вызовов');
    const mail = JSON.parse((await sh('show', node.id, '--only', 'mail', '--json')).stdout).mail;
    expect(mail).toMatchObject([
      { n: 1, state: 'delivered', how: 'first' },
      { n: 2, state: 'delivered', how: 'first' },
    ]);
  }, 60_000);

  it('queues a letter to a busy background session, and treeyard resumes it with the letter once its turn is over', async () => {
    // The deliverer on: nobody sends anything more after the letter.
    const { tree, home, sh, launches } = setup({ TREEYARD_DELIVER: '' });
    const node = addNode(tree, { title: 'Фон', doneWhen: 'фон работает' });
    const open = await sh('open', node.id, '--bg', '--start', 'do', '--yes', '--json');
    const session = JSON.parse(open.stdout).id as string;

    const busy = await sh('send', node.id, 'добавь тест', '--as', 'claude');
    expect(busy.code, busy.stderr).toBe(0);
    expect(busy.stdout).toContain('письмо №1 в очереди: сессия занята — придёт, когда она закончит ход');
    expect(busy.stdout).toContain(`доставит treeyard сам; посмотреть — treeyard show ${node.id} --only mail`);
    const entries = journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body);
    expect(entries.at(-1)).toMatch(
      new RegExp(`· claude · письмо №1 сессии claude ${session.slice(0, 8)}: «добавь тест»$`),
    );

    for (const row of workers(home)) process.kill(row.pid, 'SIGTERM');
    const end = Date.now() + 20_000;
    const resumedWith = () => launches().find((row) => row.args.includes('--resume'));
    while (!resumedWith() && Date.now() < end) await new Promise((done) => setTimeout(done, 200));
    const resumed = resumedWith();
    expect(resumed?.node).toBe(node.id);
    expect(resumed?.args).toEqual(expect.arrayContaining(['--resume', session, '--bg', '--', 'добавь тест']));
    const mail = JSON.parse((await sh('show', node.id, '--only', 'mail', '--json')).stdout).mail;
    expect(mail).toMatchObject([{ n: 1, state: 'delivered', how: 'resumed' }]);
    // One line per letter: the delivery adds none.
    expect(
      journalEntries(loadTree(tree.project.dir).nodes.get(node.id)!.body).filter((e) => e.includes('письмо №1')),
    ).toHaveLength(1);
  }, 60_000);
});

describe('answers between the sessions of two nodes, from the shell', () => {
  it('send --wait prints the answer, and wait of the coordinator returns with a letter to its node', async () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    const coordinator = addNode(tree, { title: 'Координатор', status: 'active' });
    const site = addNode(tree, { title: 'Сайт', status: 'active' });
    const as = (node: string) => treeyardIn(dir, { TREEYARD_NODE: node, TREEYARD_PROJECT: dir });
    const asked = as(coordinator.id)('send', site.id, 'какой порт?', '--wait', '--timeout', '25s');
    await new Promise((done) => setTimeout(done, 3000));
    const back = await as(site.id)('send', coordinator.id, '8080\nи 8443 для https');
    expect(back.code, back.stderr).toBe(0);
    const res = await asked;
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('письмо №1 в очереди: у узла нет сессии — письмо получит первая');
    expect(res.stdout).toMatch(/✉ письмо №2 от «Сайт» · ответ на №1\n {2}8080\n {2}и 8443 для https\n/);

    // Now the coordinator waits for the node, and the node writes to it instead of ending.
    const waiting = as(coordinator.id)('wait', site.id, '--timeout', '25s', '--json');
    await new Promise((done) => setTimeout(done, 3000));
    await as(site.id)('send', coordinator.id, 'нужен ключ API');
    const woke = await waiting;
    expect(woke.code, woke.stderr).toBe(0);
    expect(JSON.parse(woke.stdout)).toMatchObject({
      timedOut: false,
      letters: [{ n: 3, from: site.id, title: 'Сайт', text: 'нужен ключ API', replyTo: null }],
      settled: [{ node: site.id, reason: 'letter' }],
    });
  }, 60_000);
});

describe('treeyard send --approve / --reject from the shell', () => {
  it('refuses without --as ты/--as you (and with an agent --as or TREEYARD_AS), in text and JSON', async () => {
    const { tree, sh } = setup();
    const node = addNode(tree, { title: 'Разрешение', status: 'active' });

    const bare = await sh('send', node.id, '--approve');
    expect(bare.code).toBe(1);
    expect(bare.stderr).toContain('разрешения даёт только человек');
    expect(bare.stderr).toContain('--as ты');

    const bareReject = await sh('send', node.id, '--reject', '--json');
    expect(bareReject.code).toBe(1);
    expect(JSON.parse(bareReject.stdout)).toMatchObject({
      node: node.id,
      resolved: false,
      decision: 'reject',
    });

    const asAgent = await sh('send', node.id, '--approve', '--as', 'claude');
    expect(asAgent.code).toBe(1);
    expect(asAgent.stderr).toContain('«claude» — не человек');

    const envAgent = await treeyardIn(tree.project.dir, { TREEYARD_AS: 'antigravity' })('send', node.id, '--approve');
    expect(envAgent.code).toBe(1);
    expect(envAgent.stderr).toContain('разрешения даёт только человек');

    const en = await treeyardIn(tree.project.dir, { TREEYARD_LANG: 'en' })('send', node.id, '--approve');
    expect(en.code).toBe(1);
    expect(en.stderr).toContain('only the person gives permissions');
    expect(en.stderr).toContain('--as you');
  }, 40_000);

  it('checks mutual exclusivity of --approve, --reject, --answer, --wait, --timeout, --force', async () => {
    const { tree, sh } = setup();
    const node = addNode(tree, { title: 'Флаги', status: 'active' });

    const cases: [string[], RegExp][] = [
      [['send', node.id, '--approve', '--reject', '--as', 'ты'], /выбери одно: --answer, --approve или --reject/],
      [['send', node.id, '--approve', '--answer', '1', '--as', 'ты'], /выбери одно: --answer, --approve или --reject/],
      [['send', node.id, '--approve', '--wait', '--as', 'ты'], /не сочетаются с --wait, --timeout и --force/],
      [['send', node.id, '--reject', '--timeout', '5s', '--as', 'ты'], /не сочетаются с --wait, --timeout и --force/],
      [['send', node.id, '--approve', '--force', '--as', 'ты'], /не сочетаются с --wait, --timeout и --force/],
      [['send', node.id, '--reject', '2', '--as', 'ты'], /treeyard send/],
    ];
    for (const [args, pattern] of cases) {
      const res = await sh(...args);
      expect(res.code, args.join(' ')).toBe(2);
      expect(res.stderr, args.join(' ')).toMatch(pattern);
    }
  }, 40_000);

  it('passes the person check with --as ты/--as you and reports when the node is not waiting for permission', async () => {
    const { tree, sh } = setup();
    const node = addNode(tree, { title: 'Ожидание', status: 'active' });

    const res = await sh('send', node.id, '--approve', '2', '--as', 'ты', '--json');
    expect(res.code).toBe(1);
    expect(res.stderr).toContain(`сессия узла ${node.id} не ждёт разрешения`);
    expect(JSON.parse(res.stdout)).toMatchObject({
      node: node.id,
      resolved: false,
      decision: 'approve',
    });

    const en = await treeyardIn(tree.project.dir, { TREEYARD_LANG: 'en' })('send', node.id, '--reject', '--as', 'you');
    expect(en.code).toBe(1);
    expect(en.stderr).toContain(`the session of node ${node.id} is not waiting for a permission`);

    const helpRu = await sh('send', '--help');
    expect(helpRu.code).toBe(0);
    expect(helpRu.stdout).toContain('--approve [пункт] --as ты | --reject --as ты');

    const helpEn = await treeyardIn(tree.project.dir, { TREEYARD_LANG: 'en' })('send', '--help');
    expect(helpEn.code).toBe(0);
    expect(helpEn.stdout).toContain('--approve [choice] --as you | --reject --as you');
  }, 40_000);
});
