/**
 * The README's pictures, taken again: the staged coffee roastery from the
 * promo video (video/demo/coffee), planted into a temporary folder by
 * treeyard itself, moved along a little and shot in English and in Russian.
 * A new key or label in the TUI — run it, and the README shows it.
 *
 *   npm run screenshots   → docs/screenshot{,-menu}{,.ru}.png
 *
 * The folder and its TREEYARD_HOME are temporary: nothing touches
 * ~/.treeyard, a real tree or tmux.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Before ink and its colours load: the README shows a truecolor terminal.
process.env.FORCE_COLOR = '3';

const repo = resolve(import.meta.dirname, '..');
const tsx = join(repo, 'node_modules/.bin/tsx');
// The graph needs fewer rows than the menu; below 26 the TUI hides the goal line.
const COLUMNS = 130;

type Lang = 'en' | 'ru';
const TREES: Record<Lang, string> = {
  en: join(repo, 'video/demo/coffee/tree.json'),
  ru: join(repo, 'video/demo/coffee/tree.ru.json'),
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

const { snapshot } = await import('../src/tui/snapshot.js');
const { framePng } = await import('./screenshot.js');

const root = mkdtempSync(join(realpathSync(tmpdir()), 'treeyard-readme-'));
try {
  for (const lang of ['en', 'ru'] as const) await shoot(lang);
} finally {
  rmSync(root, { recursive: true, force: true });
}

async function shoot(lang: Lang): Promise<void> {
  const home = join(root, lang, 'home');
  const dir = join(root, lang, 'larchwood-roasters');
  mkdirSync(home, { recursive: true });
  mkdirSync(dir, { recursive: true });
  const settings = { lang, theme: 'dark', confirm: true, animation: false, marquee: false } as const;
  writeFileSync(join(home, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(TREEYARD_|BRAINYARD_|TMUX|CLAUDE)/.test(key)) env[key] = value;
  }
  // A person at the keyboard: only a person may mark a node done.
  Object.assign(env, { TREEYARD_HOME: home, TREEYARD_AS: 'you' });
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
  const ui = { selected: idAt(SELECTED), expanded: EXPANDED.map(idAt) };
  const take = async (name: string, rows: number, keys: string[] = []) => {
    const frame = await snapshot(dir, { columns: COLUMNS, rows, ui, keys, settings, settle: 200 });
    console.log(framePng(frame, join(repo, 'docs', `${name}${SUFFIX[lang]}.png`), COLUMNS, rows));
  };
  await take('screenshot', 26);
  await take('screenshot-menu', 36, ['\r']);
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
