/**
 * A GitHub Project board beside the tree. `github:` in tree.md names the
 * board and which column each status lives in; `github:` in a node names its
 * card and the column the card was last seen in. `sync` brings new cards in
 * and carries a move over from whichever side made it; a status changed in
 * the tree moves the card right away.
 *
 * Everything goes through `gh`: its login and its scopes, no tokens of ours.
 */
import { execFile, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { t } from './i18n/i18n.js';
import { appendJournal } from './model/journal.js';
import { addNode, onStatusChange, setStatus } from './model/ops.js';
import { writeOverview } from './model/overview.js';
import { nodeFromText, nodePath, writeNode, writeProject } from './model/store.js';
import { stamp } from './model/time.js';
import { ROOT, type Status, type Tree, type TreeNode } from './model/types.js';

/** Runs `gh` with these arguments and gives back its stdout. */
export type Gh = (args: string[]) => Promise<string>;

export const gh: Gh = (args) =>
  new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const failure = new Error(stderr.trim() || error.message) as Error & { code?: unknown };
      // ENOENT: there is no gh at all, not a failed call.
      failure.code = (error as { code?: unknown }).code;
      reject(failure);
    });
  });

export interface Board {
  owner: string;
  number: number;
  projectId: string;
  /** The single-select field the columns are. */
  fieldId: string;
  /** Status → column name; a status without one leaves the card where it is. */
  columns: Partial<Record<Status, string>>;
  /** Column name → option id, to move a card without asking for the field again. */
  options: Record<string, string>;
  /** Where new cards become nodes. */
  parent?: string;
}

/** What a node keeps about its card. */
export interface Card {
  item: string;
  url?: string;
  /** The column the card was in when the two sides last agreed. */
  column?: string;
}

export interface BoardItem {
  id: string;
  title: string;
  status?: string;
  url?: string;
}

/** `antondanv/1`, `https://github.com/users/antondanv/projects/1`, `…/orgs/acme/projects/3`. */
export function parseBoardRef(ref: string): { owner: string; number: number } | undefined {
  const url = /github\.com\/(?:users|orgs)\/([^/\s]+)\/projects\/(\d+)/.exec(ref);
  const short = /^([\w.-]+)\/(\d+)$/.exec(ref.trim());
  const match = url ?? short;
  return match ? { owner: match[1]!, number: Number(match[2]) } : undefined;
}

// Order matters: «In review» is review, not active; «Not started» is not done.
const GUESSES: [Status, RegExp][] = [
  ['review', /review|провер|qa/i],
  ['active', /progress|doing|в работе|wip/i],
  ['waiting', /block|wait|hold|жд[её]т/i],
  ['done', /done|complete|closed|shipped|готов/i],
  ['dropped', /drop|won.?t|cancel|отказ/i],
  ['idea', /backlog|idea|icebox|later|иде/i],
  ['todo', /to.?do|ready|next|^new$|к работе|сделать/i],
];

/** Which column each status goes to, guessed from the column names. */
export function guessColumns(names: string[]): Partial<Record<Status, string>> {
  const columns: Partial<Record<Status, string>> = {};
  for (const name of names) {
    const hit = GUESSES.find(([status, pattern]) => !columns[status] && pattern.test(name));
    if (hit) columns[hit[0]] = name;
  }
  // No column of its own: an idea waits in the to-do column, a stuck task stays in progress.
  if (!columns.todo && columns.idea) columns.todo = columns.idea;
  if (!columns.todo && names[0] && !Object.values(columns).includes(names[0])) columns.todo = names[0];
  return columns;
}

// When several statuses share a column, a card in it becomes the first of these.
const FROM_COLUMN: Status[] = ['todo', 'active', 'review', 'done', 'waiting', 'idea', 'dropped'];

/** A card's column → the status of its node. A card in no known column is an idea. */
export function statusFor(board: Board, column: string | undefined): Status {
  if (!column) return 'idea';
  return FROM_COLUMN.find((status) => board.columns[status] === column) ?? 'idea';
}

export function boardOf(tree: Tree): Board | undefined {
  const raw = tree.project.extra.github as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const ref = parseBoardRef(String(raw.board ?? ''));
  if (!ref || typeof raw.project_id !== 'string' || typeof raw.field_id !== 'string') return undefined;
  const board: Board = {
    ...ref,
    projectId: raw.project_id,
    fieldId: raw.field_id,
    columns: stringMap(raw.columns) as Partial<Record<Status, string>>,
    options: stringMap(raw.options),
  };
  if (typeof raw.parent === 'string' && raw.parent) board.parent = raw.parent;
  return board;
}

function boardData(board: Board): Record<string, unknown> {
  return {
    board: `${board.owner}/${board.number}`,
    project_id: board.projectId,
    field_id: board.fieldId,
    ...(board.parent ? { parent: board.parent } : {}),
    columns: board.columns,
    options: board.options,
  };
}

export function cardOf(node: TreeNode): Card | undefined {
  const raw = node.extra.github as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object' || typeof raw.item !== 'string') return undefined;
  const card: Card = { item: raw.item };
  if (typeof raw.url === 'string') card.url = raw.url;
  if (typeof raw.column === 'string') card.column = raw.column;
  return card;
}

function setCard(node: TreeNode, card: Card): void {
  node.extra.github = {
    item: card.item,
    ...(card.url ? { url: card.url } : {}),
    ...(card.column ? { column: card.column } : {}),
  };
}

/** Ties the tree to a board: finds its Status field and guesses the columns. */
export async function linkBoard(tree: Tree, ref: string, parent?: string, run: Gh = gh): Promise<Board> {
  const parsed = parseBoardRef(ref);
  if (!parsed) throw new Error(t('доска: owner/номер или ссылка на GitHub Project — «{ref}»', { ref }));
  const owner = ['--owner', parsed.owner];
  const view = JSON.parse(await run(['project', 'view', String(parsed.number), ...owner, '--format', 'json'])) as {
    id: string;
  };
  const fields = JSON.parse(
    await run(['project', 'field-list', String(parsed.number), ...owner, '--format', 'json', '--limit', '100']),
  ) as { fields: { id: string; name: string; options?: { id: string; name: string }[] }[] };
  const field = fields.fields.find((item) => item.name.toLowerCase() === 'status' && item.options);
  if (!field?.options?.length) throw new Error(t('на доске нет поля Status с колонками'));
  const options = Object.fromEntries(field.options.map((option) => [option.name, option.id]));
  const board: Board = {
    ...parsed,
    projectId: view.id,
    fieldId: field.id,
    columns: guessColumns(field.options.map((option) => option.name)),
    options,
  };
  board.parent = parent && parent !== ROOT ? parent : githubNode(tree, board).id;
  tree.project.extra.github = boardData(board);
  writeProject(tree.project);
  return board;
}

/** The «GitHub» node at the top that holds what comes from GitHub: the one there, or a new one. */
function githubNode(tree: Tree, board: Board): TreeNode {
  const found = hubNode(tree);
  if (found) return found;
  const node = ensureHub(tree);
  node.body = t('Карточки доски {board} — в узлах внутри. Свериться с доской: treeyard github sync.', {
    board: `${board.owner}/${board.number}`,
  });
  writeNode(tree.project.dir, node);
  return node;
}

/** The node that holds what comes from GitHub, once there is one: `github: hub`. */
export function hubNode(tree: Tree): TreeNode | undefined {
  return [...tree.nodes.values()].find((node) => node.extra.github === 'hub');
}

export function ensureHub(tree: Tree): TreeNode {
  const found = hubNode(tree);
  if (found) return found;
  const node = addNode(tree, { title: GITHUB_TITLE });
  node.extra.github = 'hub';
  writeNode(tree.project.dir, node, false);
  return node;
}

export const GITHUB_TITLE = 'GitHub';

/**
 * No board yet, and nobody said no: the tree shows a «GitHub» node that offers
 * to connect one. `github: off` in tree.md hides it.
 */
export function offerShown(tree: Tree): boolean {
  return !boardOf(tree) && !hubNode(tree) && tree.project.extra.github !== 'off' && tree.project.extra.github !== false;
}

// ── Connecting: gh, then a repository, then a board ─────────────────────────

export interface GhState {
  installed: boolean;
  /** Logged in as. */
  user?: string;
  /** Classic token scopes; undefined when gh does not say (a fine-grained token). */
  scopes?: string[];
}

export async function ghState(run: Gh = gh): Promise<GhState> {
  let out: string;
  try {
    // Headers and body: the login, and the scopes in X-Oauth-Scopes.
    out = await run(['api', '-i', 'user']);
  } catch (error) {
    return { installed: (error as { code?: unknown }).code !== 'ENOENT' };
  }
  const state: GhState = { installed: true };
  const user = /"login"\s*:\s*"([^"]+)"/.exec(out)?.[1];
  if (user) state.user = user;
  const scopes = /^x-oauth-scopes:[ \t]*(.*)$/im.exec(out)?.[1];
  if (scopes !== undefined)
    state.scopes = scopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
  return state;
}

/** gh is there, logged in, and may read and move cards on boards. */
export function ghReady(state: GhState): boolean {
  return Boolean(state.installed && state.user && (!state.scopes || state.scopes.includes('project')));
}

export interface Repo {
  owner: string;
  name: string;
}

/** `git@github.com:o/r.git`, `https://github.com/o/r` → o/r. */
export function parseRepoUrl(url: string): Repo | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? { owner: match[1]!, name: match[2]! } : undefined;
}

function git(dir: string, args: string[]): { ok: boolean; out: string; err: string } {
  const got = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return { ok: got.status === 0, out: got.stdout ?? '', err: (got.stderr ?? '').trim() };
}

/** The project's GitHub repository: origin first, then any remote on github.com. */
export function repoOf(dir: string): Repo | undefined {
  const remotes = git(dir, ['remote', '-v']).out.split('\n');
  const urls = remotes.map((line) => line.split(/\s+/)).filter(([, url]) => url);
  const origin = urls.find(([name]) => name === 'origin');
  const ordered = origin ? [origin, ...urls] : urls;
  for (const [, url] of ordered) {
    const repo = parseRepoUrl(url!);
    if (repo) return repo;
  }
  return undefined;
}

export async function listRepos(run: Gh = gh): Promise<{ nameWithOwner: string; isPrivate: boolean }[]> {
  return JSON.parse(
    await run(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,isPrivate', '--no-archived']),
  ) as { nameWithOwner: string; isPrivate: boolean }[];
}

/** A git repository here, if there is none yet, and a remote to `owner/name`: origin, or `github` when origin is taken. */
export function connectRepo(dir: string, nameWithOwner: string): Repo {
  const repo = parseRepoUrl(`github.com/${nameWithOwner}`);
  if (!repo) throw new Error(t('репозиторий: owner/имя — «{repo}»', { repo: nameWithOwner }));
  if (!git(dir, ['rev-parse', '--git-dir']).ok) {
    const init = git(dir, ['init']);
    if (!init.ok) throw new Error(init.err);
  }
  const taken = git(dir, ['remote']).out.split('\n').includes('origin');
  const added = git(dir, [
    'remote',
    'add',
    taken ? 'github' : 'origin',
    `https://github.com/${repo.owner}/${repo.name}.git`,
  ]);
  if (!added.ok) throw new Error(added.err);
  return repo;
}

/** A new repository on GitHub for this folder, private unless asked; nothing is pushed. */
export async function createRepo(dir: string, name: string, isPrivate = true, run: Gh = gh): Promise<Repo> {
  if (!git(dir, ['rev-parse', '--git-dir']).ok) {
    const init = git(dir, ['init']);
    if (!init.ok) throw new Error(init.err);
  }
  const taken = git(dir, ['remote']).out.split('\n').includes('origin');
  const out = await run([
    'repo',
    'create',
    name,
    isPrivate ? '--private' : '--public',
    '--source',
    dir,
    '--remote',
    taken ? 'github' : 'origin',
  ]);
  const repo =
    parseRepoUrl(
      out
        .trim()
        .split('\n')
        .find((line) => line.includes('github.com')) ?? '',
    ) ?? repoOf(dir);
  if (!repo) throw new Error(t('репозиторий создан, но remote не найден — git remote -v'));
  return repo;
}

export interface BoardInfo {
  number: number;
  title: string;
  owner: string;
}

export async function listBoards(owner: string, run: Gh = gh): Promise<BoardInfo[]> {
  const raw = JSON.parse(await run(['project', 'list', '--owner', owner, '--format', 'json', '--limit', '100'])) as {
    projects: { number: number; title: string; closed?: boolean }[];
  };
  return raw.projects
    .filter((project) => !project.closed)
    .map((project) => ({ number: project.number, title: project.title, owner }));
}

/** A new board, linked to the repository so it shows on the repo's Projects tab. */
export async function createBoard(repo: Repo, title: string, run: Gh = gh): Promise<BoardInfo> {
  const made = JSON.parse(
    await run(['project', 'create', '--owner', repo.owner, '--title', title, '--format', 'json']),
  ) as { number: number };
  try {
    await run(['project', 'link', String(made.number), '--owner', repo.owner, '--repo', `${repo.owner}/${repo.name}`]);
  } catch {
    // Linking only shows the board on the repo's tab; the board works without it.
  }
  return { number: made.number, title, owner: repo.owner };
}

export function setOffer(tree: Tree, shown: boolean): void {
  if (boardOf(tree)) return;
  if (shown) delete tree.project.extra.github;
  else tree.project.extra.github = 'off';
  writeProject(tree.project);
}

export async function boardItems(board: Board, run: Gh = gh): Promise<BoardItem[]> {
  const raw = JSON.parse(
    await run([
      'project',
      'item-list',
      String(board.number),
      '--owner',
      board.owner,
      '--format',
      'json',
      '--limit',
      '1000',
    ]),
  ) as { items: { id: string; title?: string; status?: string; content?: { title?: string; url?: string } }[] };
  return raw.items.map((item) => ({
    id: item.id,
    title: item.content?.title ?? item.title ?? '',
    ...(item.status ? { status: item.status } : {}),
    ...(item.content?.url ? { url: item.content.url } : {}),
  }));
}

/** Moves a card to a column and remembers it in the node. */
export async function moveCard(tree: Tree, node: TreeNode, column: string, run: Gh = gh): Promise<void> {
  const board = boardOf(tree);
  const card = cardOf(node);
  if (!board || !card) return;
  const option = board.options[column];
  if (!option) throw new Error(t('на доске нет колонки «{column}»', { column }));
  await run([
    'project',
    'item-edit',
    '--id',
    card.item,
    '--project-id',
    board.projectId,
    '--field-id',
    board.fieldId,
    '--single-select-option-id',
    option,
  ]);
  remember(tree, node, { ...card, column });
}

/**
 * The card's column, written into the node as it is on disk now: a push ends
 * after the TUI or an agent may have written the node again.
 */
function remember(tree: Tree, node: TreeNode, card: Card, journal?: string): void {
  setCard(node, card);
  let fresh: TreeNode;
  try {
    fresh = nodeFromText(readFileSync(nodePath(tree.project.dir, node.id), 'utf8'), node.id);
  } catch {
    return;
  }
  setCard(fresh, card);
  if (journal) {
    fresh.body = appendJournal(fresh.body, journal);
    node.body = fresh.body;
  }
  writeNode(tree.project.dir, fresh, Boolean(journal));
}

/** The column a node's status puts its card in, when it differs from where the card is. */
export function pendingMove(tree: Tree, node: TreeNode): string | undefined {
  const board = boardOf(tree);
  const card = cardOf(node);
  if (!board || !card) return undefined;
  const column = board.columns[node.status];
  return column && column !== card.column ? column : undefined;
}

export interface Push {
  node: TreeNode;
  column: string;
  error?: string;
}

const inFlight = new Set<Promise<Push>>();

/**
 * From now on a status changed in this process moves the card. A failure
 * goes to the node's journal; the next `sync` makes up for it.
 */
let following = false;

export function followStatuses(run: Gh = gh): () => void {
  // One listener per process: the CLI follows before it opens the TUI, which follows too.
  if (following) return () => {};
  following = true;
  const stop = onStatusChange((tree, node) => {
    const column = pendingMove(tree, node);
    if (!column) return;
    const push = moveCard(tree, node, column, run).then(
      (): Push => ({ node, column }),
      (error: unknown): Push => {
        const message = (error as Error).message.split('\n')[0] ?? '';
        remember(
          tree,
          node,
          cardOf(node)!,
          t('{p1} · github · карточку не сдвинуть в «{column}»: {message}', { p1: stamp(), column, message }),
        );
        return { node, column, error: message };
      },
    );
    inFlight.add(push);
    void push.finally(() => inFlight.delete(push));
  });
  return () => {
    stop();
    following = false;
  };
}

/** Waits for the cards moved so far: the CLI says how it went before it exits. */
export async function settlePushes(): Promise<Push[]> {
  return Promise.all([...inFlight]);
}

export interface SyncResult {
  added: TreeNode[];
  /** Moved on the board: the node followed. */
  pulled: TreeNode[];
  /** Changed in the tree: the card followed. */
  pushed: TreeNode[];
  failed: { node: TreeNode; error: string }[];
  /** Cards in a done column that have no node: left on the board. */
  skipped: number;
}

/**
 * Both ways at once. For a card already in the tree: if the board moved it
 * since the last sync, the node follows; else if the node's status moved,
 * the card follows. A new card becomes a node, unless it is already done.
 */
export async function syncBoard(tree: Tree, run: Gh = gh): Promise<SyncResult> {
  const board = boardOf(tree);
  if (!board) throw new Error(t('дерево не привязано к доске — treeyard github link <owner>/<номер>'));
  const items = await boardItems(board, run);
  const byItem = new Map<string, TreeNode>();
  for (const node of tree.nodes.values()) {
    const card = cardOf(node);
    if (card) byItem.set(card.item, node);
  }
  const result: SyncResult = { added: [], pulled: [], pushed: [], failed: [], skipped: 0 };
  const parent = board.parent && tree.nodes.has(board.parent) ? board.parent : ROOT;
  const closed = new Set([board.columns.done, board.columns.dropped].filter(Boolean));
  for (const item of items) {
    const node = byItem.get(item.id);
    const column = item.status ?? '';
    if (!node) {
      if (column && closed.has(column)) {
        result.skipped++;
        continue;
      }
      const added = addNode(
        tree,
        {
          title: item.title,
          parent,
          status: statusFor(board, column),
          ...(item.url ? { body: t('Карточка: {url}', { url: item.url }) } : {}),
        },
        'github',
      );
      setCard(added, { item: item.id, ...(item.url ? { url: item.url } : {}), ...(column ? { column } : {}) });
      writeNode(tree.project.dir, added, false);
      result.added.push(added);
      continue;
    }
    const card = cardOf(node)!;
    if (column !== (card.column ?? '')) {
      // The board moved it. The column is remembered first, so the status change does not push it back.
      setCard(node, { ...card, ...(column ? { column } : { column: undefined }) });
      const status = statusFor(board, column);
      if (board.columns[node.status] === column || (!column && node.status === 'idea')) {
        writeNode(tree.project.dir, node, false);
      } else {
        setStatus(tree, node.id, status, {
          source: 'github',
          note: t('карточка в «{column}»', { column: column || '—' }),
        });
        result.pulled.push(node);
      }
      continue;
    }
    const move = pendingMove(tree, node);
    if (!move) continue;
    try {
      await moveCard(tree, node, move, run);
      result.pushed.push(node);
    } catch (error) {
      result.failed.push({ node, error: (error as Error).message.split('\n')[0] ?? '' });
    }
  }
  writeOverview(tree);
  return result;
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string' && item) out[key] = item;
  return out;
}
