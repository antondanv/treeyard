/**
 * The README's pictures, taken again: the staged coffee roastery of the
 * promo video (scripts/demo/coffee.*.json), planted into a temporary folder
 * by treeyard itself, moved along a little and shot in English and in Russian.
 * A new key or label in the TUI — run it, and the README shows it.
 *
 *   npm run screenshots   → docs/screenshot{,-menu,-agent,-agents,-mail,-worktree}{,.ru}.png
 *
 * The folder and its TREEYARD_HOME are temporary: nothing touches
 * ~/.treeyard, a real tree or tmux. The agents at work are staged too:
 * scripts/demo/stage-brainyard.ts stands in for Brainyard, so the TUI sees
 * sessions and panes that no CLI runs.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Delivery } from '../src/model/mailbox.js';
import type { Stage } from './demo/stage-brainyard.js';

// Before the TUI loads: its Brainyard is the staged one; the stage itself imports the real one.
const STAGE = new URL('./demo/stage-brainyard.ts', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    const fromStage = context.parentURL?.split('?')[0] === STAGE;
    return next(specifier === '@antondanv/brainyard' && !fromStage ? STAGE : specifier, context);
  },
});
const setStage = (stage: Stage) => {
  (globalThis as { treeyardStage?: Stage }).treeyardStage = stage;
};

// Before ink and its colours load: the README shows a truecolor terminal.
process.env.FORCE_COLOR = '3';

const repo = resolve(import.meta.dirname, '..');
const tsx = join(repo, 'node_modules/.bin/tsx');
// The graph needs fewer rows than the menu; below 26 the TUI hides the goal line.
const COLUMNS = 130;

type Lang = 'en' | 'ru';
const TREES: Record<Lang, string> = {
  en: join(repo, 'scripts/demo/coffee.en.json'),
  ru: join(repo, 'scripts/demo/coffee.ru.json'),
};
const SUFFIX: Record<Lang, string> = { en: '', ru: '.ru' };

interface PlannedNode {
  title: string;
  children: PlannedNode[];
}

/** Where the work stands in the picture: positions in tree.json, so both languages move alike. */
const MOVES: [number[], string][] = [
  [[0], 'active'],
  [[0, 0], 'done'],
  [[0, 1], 'done'],
  [[0, 2], 'active'],
  [[1, 1], 'review'],
];
/** The node the pictures select, «Checkout with Stripe», and the branches open around it. */
const SELECTED = [0, 2];
const EXPANDED = [[0], [1]];

/** Where the agents work in the staged pictures: positions in tree.json. */
const AGENTS = {
  /** The coordinator: hands the branch's nodes to sessions and writes to them, from a terminal of its own. */
  coordinator: [1],
  /** Claude Code in a pane, in the node's own worktree. */
  payments: [0, 2],
  /** Codex in a pane, waiting for a person's yes. */
  subscription: [1, 0],
  /** Claude Code in the background, writing back to the coordinator. */
  emails: [1, 1],
};

/** Session ids as the CLIs make them: the TUI shows their first eight characters. */
const SESSION = {
  coordinator: '5e1c9a07-2b4d-4f8e-9c31-7a6d0b2e8f45',
  payments: 'a3f9c2e1-5b7d-4c1e-9a2f-6d8b0e4c7a15',
  subscription: '019a7c3e-4d21-7b90-8e5f-2c6a1d9b3e70',
  emails: 'c7d24b18-9e3a-4f60-b1d5-8a2e7c0f6b93',
};

const SCRIPT: Record<
  Lang,
  {
    asks: string;
    toSubscription: string;
    toEmails: string;
    fromEmails: string;
    askSubscription: string;
    screen: string[];
  }
> = {
  en: {
    asks: 'permission to run stripe listen',
    toSubscription:
      "Charge through Stripe Billing, no scheduler of our own. Order emails are another session's node: leave the templates alone.",
    toEmails: 'Subscription sends invoice.paid: add a “charged for your subscription” email on that event too.',
    fromEmails: 'Added the subscription-charged template; the invoice.paid test passes.',
    askSubscription: 'Once it works, tell me which Stripe events you listen to.',
    screen: [
      '> You are working on the node «Checkout with Stripe (test mode)»',
      '',
      '⏺ Read the node: done when a test card payment shows up as an order.',
      '',
      '⏺ Plan: a Checkout Session on the server; the webhook',
      '  checkout.session.completed creates the order.',
      '',
      '⏺ Update(server/payments.ts)',
      '  ⎿  +58 −3',
      '',
      '⏺ Bash(npm test -- payments)',
      '  ⎿  ✓ test card 4242 → order #1042 (3 tests)',
      '',
      '⏺ Now the “Thank you” page after the payment.',
    ],
  },
  ru: {
    asks: 'разрешение на stripe listen',
    toSubscription:
      'Списания делай через Stripe Billing, свой планировщик не нужен. Письма о заказе — узел другой сессии, шаблоны не трогай.',
    toEmails: 'Подписка шлёт invoice.paid — добавь на это событие письмо «списали за подписку».',
    fromEmails: 'Добавил шаблон subscription-charged, тест на invoice.paid проходит.',
    askSubscription: 'Как заработает — напиши, какие события Stripe слушаешь.',
    screen: [
      '> Ты работаешь над узлом «Оплата через Stripe (тестовый режим)»',
      '',
      '⏺ Прочитал узел: готово, когда оплата тестовой картой появляется',
      '  как заказ.',
      '',
      '⏺ План: Checkout Session на сервере, вебхук',
      '  checkout.session.completed создаёт заказ.',
      '',
      '⏺ Update(server/payments.ts)',
      '  ⎿  +58 −3',
      '',
      '⏺ Bash(npm test -- payments)',
      '  ⎿  ✓ тестовая карта 4242 → заказ #1042 (3 теста)',
      '',
      '⏺ Теперь страница «Спасибо» после оплаты.',
    ],
  },
};

const { snapshot } = await import('../src/tui/snapshot.js');
const { framePng } = await import('./screenshot.js');
const { attachSession, logToNode } = await import('../src/model/ops.js');
const { loadTree } = await import('../src/model/store.js');
const { letterFrom, letterTo } = await import('../src/model/mail.js');
const { addLetter, markDelivered, markHeld } = await import('../src/model/mailbox.js');
const { rememberLaunch } = await import('../src/launch-memory.js');
const { setLang } = await import('../src/i18n/i18n.js');
const { worktreeFor } = await import('../src/worktree.js');

const root = mkdtempSync(join(realpathSync(tmpdir()), 'treeyard-readme-'));
try {
  for (const lang of ['en', 'ru'] as const) await shoot(lang);
} finally {
  rmSync(root, { recursive: true, force: true });
}

async function shoot(lang: Lang): Promise<void> {
  const home = join(root, lang, 'home');
  // A home of the pictures' own: the TUI shortens paths under it to ~/Projects/….
  const user = join(root, lang);
  const dir = join(user, 'Projects', 'larchwood-roasters');
  mkdirSync(home, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const settings = { lang, theme: 'dark', confirm: true, animation: false, marquee: false } as const;
  writeFileSync(join(home, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(TREEYARD_|BRAINYARD_|TMUX|CLAUDE)/.test(key)) env[key] = value;
  }
  // A person at the keyboard: only a person may mark a node done.
  Object.assign(env, { TREEYARD_HOME: home, TREEYARD_AS: lang === 'ru' ? 'ты' : 'you' });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
  const treeyard = (...args: string[]) =>
    execFileSync(tsx, ['--tsconfig', join(repo, 'tsconfig.json'), join(repo, 'src/cli/main.ts'), ...args], {
      cwd: dir,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Larchwood Dev');
  git('config', 'user.email', 'dev@larchwood.example');
  git('config', 'commit.gpgsign', 'false');
  git('commit', '-q', '--allow-empty', '-m', 'First commit');
  treeyard('import', '--from-json', TREES[lang]);
  hideGithubOffer(dir);
  // A planted project tells its agents about the tree; without it the header warns.
  writeFileSync(join(dir, 'AGENTS.md'), '# Larchwood Roasters\n');
  treeyard('pointer');

  const planned = JSON.parse(readFileSync(TREES[lang], 'utf8')) as { nodes: PlannedNode[] };
  const ids = idsByTitle(JSON.parse(treeyard('show', '--json')).nodes);
  const idAt = (path: number[]) => {
    let nodes = planned.nodes;
    let node: PlannedNode | undefined;
    for (const index of path) {
      node = nodes[index];
      nodes = node?.children ?? [];
    }
    const id = node && ids.get(node.title);
    if (!id) throw new Error(`no node at ${path.join('.')} in ${TREES[lang]}`);
    return id;
  };
  for (const [path, status] of MOVES) treeyard('set', idAt(path), `status=${status}`);
  git('add', '-A');
  git('commit', '-q', '-m', 'Plant the goal tree');

  process.env.TREEYARD_HOME = home;
  const realHome = process.env.HOME;
  // The staged letters are written in the picture's language.
  setLang(lang);
  const take = async (name: string, rows: number, keys: string[] = [], selected = SELECTED, live = false) => {
    const ui = { selected: idAt(selected), expanded: EXPANDED.map(idAt) };
    // Live: the TUI asks the staged Brainyard for sessions and panes; no quiet pane is put to sleep.
    const frameSettings = live ? { ...settings, sleepAfter: 0, maxPanes: 0 } : settings;
    // Only the frame sees the pictures' home: Chrome needs the real one.
    process.env.HOME = user;
    const frame = await snapshot(dir, { columns: COLUMNS, rows, ui, keys, settings: frameSettings, settle: 400, live });
    process.env.HOME = realHome;
    console.log(framePng(frame, join(repo, 'docs', `${name}${SUFFIX[lang]}.png`), COLUMNS, rows));
  };
  await take('screenshot', 26);
  // The menus open with the last launch on top: Claude Code planning in a pane, in the node's worktree.
  rememberLaunch(dir, { brain: 'claude', start: 'plan', model: 'opus', effort: 'high', pane: true, worktree: true });
  await take('screenshot-menu', 36, ['\r'], SELECTED, true);
  await take('screenshot-agent', 30, ['c'], SELECTED, true);

  stageAgents(lang, dir, idAt, treeyard);
  await take('screenshot-agents', 34, [], AGENTS.payments, true);
  await take('screenshot-mail', 34, ['i'], AGENTS.coordinator, true);
  await take('screenshot-worktree', 34, ['p', 'i'], AGENTS.payments, true);
  setStage({ sessions: [], panes: [], screens: {} });
}

/**
 * Several agents at once: a coordinator on a branch, Claude Code in a pane in
 * its node's worktree, Codex waiting for you, Claude Code in the background —
 * and the letters between them in the journals.
 */
function stageAgents(
  lang: Lang,
  dir: string,
  idAt: (path: number[]) => string,
  treeyard: (...args: string[]) => string,
): void {
  const script = SCRIPT[lang];
  const id = (path: number[]) => idAt(path);
  treeyard('set', id(AGENTS.coordinator), id(AGENTS.subscription), id(AGENTS.emails), 'status=active');
  treeyard('worktree', 'add', id(AGENTS.payments));
  const worktree = worktreeFor(dir, id(AGENTS.payments))?.path;
  if (!worktree) throw new Error(`no worktree for ${id(AGENTS.payments)}`);

  const tree = loadTree(dir);
  const node = (path: number[]) => {
    const found = tree.nodes.get(id(path));
    if (!found) throw new Error(`no node ${id(path)}`);
    return found;
  };
  const started = new Date(Date.now() - 25 * 60_000).toISOString();
  // The coordinator is the session the person talks to, in a terminal of their own.
  attachSession(tree, id(AGENTS.coordinator), { brain: 'claude', id: SESSION.coordinator, mode: 'terminal', started });
  attachSession(tree, id(AGENTS.payments), {
    brain: 'claude',
    id: SESSION.payments,
    mode: 'pane',
    pane: 'claude-payments',
    dir: worktree,
    started,
  });
  attachSession(tree, id(AGENTS.subscription), {
    brain: 'codex',
    id: SESSION.subscription,
    mode: 'pane',
    pane: 'codex-subscription',
    started,
  });
  attachSession(tree, id(AGENTS.emails), { brain: 'claude', id: SESSION.emails, mode: 'background', started });

  // As `treeyard send` from one node's session to another: the mailbox, then a line in both journals.
  const send = (from: number[], to: number[], text: string, how?: Delivery) => {
    const item = addLetter(dir, { to: id(to), from: id(from), who: 'claude', text });
    logToNode(tree, id(to), letterFrom(node(from), text, item.n), 'claude');
    logToNode(tree, id(from), letterTo(node(to), text, item.n), 'claude');
    if (how) markDelivered(dir, [item.n], how);
    else markHeld(dir, [item.n], 'waiting', script.asks);
  };
  send(AGENTS.coordinator, AGENTS.subscription, script.toSubscription, 'typed');
  // Handed over between two tool calls: the session was at work.
  send(AGENTS.coordinator, AGENTS.emails, script.toEmails, 'turn');
  send(AGENTS.emails, AGENTS.coordinator, script.fromEmails, 'typed');
  // Waits while Codex asks the person for a permission.
  send(AGENTS.coordinator, AGENTS.subscription, script.askSubscription);

  const pane = (name: string, brain: 'claude' | 'codex', sessionId: string, cwd: string) => ({
    pane: name,
    brain,
    sessionId,
    cwd,
    attached: false,
    width: 72,
    height: 28,
    startedAt: started,
    activityAt: new Date().toISOString(),
  });
  const session = (brain: 'claude' | 'codex', sessionId: string, cwd: string, live: SessionLive) => ({
    brain,
    id: sessionId,
    cwd,
    interactive: true,
    startedAt: started,
    updatedAt: new Date().toISOString(),
    live,
  });
  setStage({
    sessions: [
      session('claude', SESSION.coordinator, dir, { kind: 'interactive', status: 'idle' }),
      session('claude', SESSION.payments, worktree, { kind: 'interactive', status: 'busy' }),
      session('codex', SESSION.subscription, dir, { kind: 'interactive', status: 'waiting', waitingFor: script.asks }),
      { ...session('claude', SESSION.emails, dir, { kind: 'background', status: 'busy' }), background: true },
    ],
    panes: [
      pane('claude-payments', 'claude', SESSION.payments, worktree),
      pane('codex-subscription', 'codex', SESSION.subscription, dir),
    ],
    screens: { 'claude-payments': script.screen },
  });
}

interface SessionLive {
  kind: string;
  status: string;
  waitingFor?: string;
}

interface ShownNode {
  id: string;
  title: string;
  children: ShownNode[];
}

function idsByTitle(nodes: ShownNode[], ids = new Map<string, string>()): Map<string, string> {
  for (const node of nodes) {
    ids.set(node.title, node.id);
    idsByTitle(node.children, ids);
  }
  return ids;
}

/** What `,` → «GitHub node» → hide writes: the offer node is noise in a staged tree. */
function hideGithubOffer(dir: string): void {
  const path = join(dir, '.tree', 'tree.md');
  const text = readFileSync(path, 'utf8');
  const end = text.indexOf('\n---', 4);
  if (!text.startsWith('---\n') || end < 0) throw new Error(`no front matter in ${path}`);
  writeFileSync(path, `${text.slice(0, end)}\ngithub: off${text.slice(end)}`);
}
