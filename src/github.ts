/**
 * A GitHub Project board and a repository's issues beside the tree. `github:`
 * in tree.md names the board and which column each status lives in, and the
 * repository; `github:` in a node names its card and the column the card was
 * last seen in, and its issue and whether it was open. `sync` brings new cards
 * and issues in and carries a change over from whichever side made it; a
 * status changed in the tree moves the card and closes the issue right away.
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

/** What a node keeps about its issue. */
export interface IssueRef {
  number: number;
  url?: string;
  /** Open or closed when the two sides last agreed; gone when GitHub no longer has it. */
  state?: 'open' | 'closed' | 'gone';
}

export interface Issue {
  number: number;
  title: string;
  url: string;
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

/** `github:` in tree.md when it holds a link, not `off`. */
function linked(tree: Tree): Record<string, unknown> | undefined {
  const raw = tree.project.extra.github;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
}

export function boardOf(tree: Tree): Board | undefined {
  const raw = linked(tree);
  if (!raw) return undefined;
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

/** The repository whose issues come into the tree: `github.repo` in tree.md. */
export function linkedRepo(tree: Tree): Repo | undefined {
  const raw = linked(tree);
  return typeof raw?.repo === 'string' ? parseRepoUrl(`github.com/${raw.repo}`) : undefined;
}

/** Where cards and issues become nodes. */
function parentFor(tree: Tree): string {
  const parent = linked(tree)?.parent;
  return typeof parent === 'string' && tree.nodes.has(parent) ? parent : ROOT;
}

function nodeData(node: TreeNode): Record<string, unknown> {
  const raw = node.extra.github;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** A node can be a card and an issue at once: each side changes only its own keys. */
function patchNode(node: TreeNode, patch: Record<string, unknown>): void {
  const data = { ...nodeData(node), ...patch };
  for (const [key, value] of Object.entries(data)) if (value === undefined || value === '') delete data[key];
  node.extra.github = data;
}

export function cardOf(node: TreeNode): Card | undefined {
  const raw = nodeData(node);
  if (typeof raw.item !== 'string') return undefined;
  const card: Card = { item: raw.item };
  if (typeof raw.url === 'string') card.url = raw.url;
  if (typeof raw.column === 'string') card.column = raw.column;
  return card;
}

function setCard(node: TreeNode, card: Card): void {
  // A draft card has no url; the issue's url stays.
  patchNode(node, { item: card.item, column: card.column, ...(card.url ? { url: card.url } : {}) });
}

export function issueOf(node: TreeNode): IssueRef | undefined {
  const raw = nodeData(node);
  if (typeof raw.issue !== 'number') return undefined;
  const issue: IssueRef = { number: raw.issue };
  if (typeof raw.url === 'string') issue.url = raw.url;
  if (raw.state === 'open' || raw.state === 'closed' || raw.state === 'gone') issue.state = raw.state;
  return issue;
}

function setIssue(node: TreeNode, issue: IssueRef): void {
  patchNode(node, { issue: issue.number, state: issue.state, ...(issue.url ? { url: issue.url } : {}) });
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
  board.parent = whereNew(
    tree,
    parent,
    t('Карточки доски {board} — в узлах внутри. Свериться с доской: treeyard github sync.', {
      board: `${board.owner}/${board.number}`,
    }),
  );
  // The repository linked before stays linked.
  tree.project.extra.github = { ...linked(tree), ...boardData(board) };
  writeProject(tree.project);
  return board;
}

/** Ties the tree to a repository: its issues become nodes. */
export async function linkRepo(tree: Tree, ref: string, parent?: string, run: Gh = gh): Promise<Repo> {
  const repo = parseRepoRef(ref);
  if (!repo) throw new Error(t('репозиторий: owner/имя или ссылка на него — «{ref}»', { ref }));
  if (!(await repoExists(repo, run)))
    throw new Error(
      t('на GitHub нет репозитория {repo} (или он тебе не виден)', { repo: `${repo.owner}/${repo.name}` }),
    );
  const where = whereNew(
    tree,
    parent,
    t('Issues репозитория {repo} — в узлах внутри. Свериться: treeyard github sync.', {
      repo: `${repo.owner}/${repo.name}`,
    }),
  );
  tree.project.extra.github = { ...linked(tree), repo: `${repo.owner}/${repo.name}`, parent: where };
  writeProject(tree.project);
  return repo;
}

/** `antondanv/app`, `https://github.com/antondanv/app/issues` → the repository; a board's `owner/N` is not one. */
export function parseRepoRef(ref: string): Repo | undefined {
  const url = /github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/.exec(ref.trim());
  if (url && url[1] !== 'users' && url[1] !== 'orgs') return { owner: url[1]!, name: url[2]! };
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(ref.trim());
  return short && !/^\d+$/.test(short[2]!) ? { owner: short[1]!, name: short[2]! } : undefined;
}

/** Where new nodes from GitHub go: the node asked for, the one used before, or the «GitHub» node. */
function whereNew(tree: Tree, parent: string | undefined, body: string): string {
  if (parent && parent !== ROOT) return parent;
  const before = parentFor(tree);
  return before !== ROOT ? before : githubNode(tree, body).id;
}

/** The «GitHub» node at the top that holds what comes from GitHub: the one there, or a new one. */
function githubNode(tree: Tree, body: string): TreeNode {
  const found = hubNode(tree);
  if (found) return found;
  const node = ensureHub(tree);
  node.body = body;
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
 * Issues are linked, a board is not: the «GitHub» node is a real one by now,
 * and it is where connecting a board is still on offer.
 */
export function boardOffered(tree: Tree): boolean {
  return Boolean(linkedRepo(tree)) && !boardOf(tree);
}

/**
 * No board yet, and nobody said no: the tree shows a «GitHub» node that offers
 * to connect one. `github: off` in tree.md hides it.
 */
export function offerShown(tree: Tree): boolean {
  return (
    !boardOf(tree) &&
    !linkedRepo(tree) &&
    !hubNode(tree) &&
    tree.project.extra.github !== 'off' &&
    tree.project.extra.github !== false
  );
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

/** The remote that points to GitHub, and its repository: origin first, then any remote on github.com. */
function githubRemote(dir: string): { remote: string; repo: Repo } | undefined {
  const remotes = git(dir, ['remote', '-v']).out.split('\n');
  const urls = remotes.map((line) => line.split(/\s+/)).filter(([, url]) => url);
  const origin = urls.find(([name]) => name === 'origin');
  const ordered = origin ? [origin, ...urls] : urls;
  for (const [remote, url] of ordered) {
    const repo = parseRepoUrl(url!);
    if (repo) return { remote: remote!, repo };
  }
  return undefined;
}

/** The project's GitHub repository, as git remotes name it — it may be gone from GitHub since. */
export function repoOf(dir: string): Repo | undefined {
  return githubRemote(dir)?.repo;
}

/** Is it on GitHub, and can this login see it? A remote outlives a deleted repository. */
export async function repoExists(repo: Repo, run: Gh = gh): Promise<boolean> {
  try {
    await run(['repo', 'view', `${repo.owner}/${repo.name}`, '--json', 'name']);
    return true;
  } catch (error) {
    if (/could not resolve to a repository|not found|404/i.test((error as Error).message)) return false;
    throw error;
  }
}

export async function listRepos(run: Gh = gh): Promise<{ nameWithOwner: string; isPrivate: boolean }[]> {
  return JSON.parse(
    await run(['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,isPrivate', '--no-archived']),
  ) as { nameWithOwner: string; isPrivate: boolean }[];
}

/**
 * Points the project at `repo`: a git repository here if there is none yet; the
 * remote that already points to GitHub is moved (its repository may be gone),
 * else origin, or `github` when origin belongs to another host.
 */
function pointRemote(dir: string, repo: Repo): void {
  if (!git(dir, ['rev-parse', '--git-dir']).ok) {
    const init = git(dir, ['init']);
    if (!init.ok) throw new Error(init.err);
  }
  const url = `https://github.com/${repo.owner}/${repo.name}.git`;
  const current = githubRemote(dir);
  const taken = git(dir, ['remote']).out.split('\n').includes('origin');
  const done = current
    ? git(dir, ['remote', 'set-url', current.remote, url])
    : git(dir, ['remote', 'add', taken ? 'github' : 'origin', url]);
  if (!done.ok) throw new Error(done.err);
}

/** One of your repositories becomes this project's. */
export function connectRepo(dir: string, nameWithOwner: string): Repo {
  const repo = parseRepoUrl(`github.com/${nameWithOwner}`);
  if (!repo) throw new Error(t('репозиторий: owner/имя — «{repo}»', { repo: nameWithOwner }));
  pointRemote(dir, repo);
  return repo;
}

/** A new repository on GitHub for this folder; nothing is pushed. */
export async function createRepo(dir: string, name: string, isPrivate = true, run: Gh = gh): Promise<Repo> {
  const out = await run(['repo', 'create', name, isPrivate ? '--private' : '--public']);
  const repo = parseRepoUrl(
    out
      .trim()
      .split('\n')
      .find((line) => line.includes('github.com')) ?? '',
  );
  if (!repo) throw new Error(t('gh не сказал, где новый репозиторий: {out}', { out: out.trim() }));
  pointRemote(dir, repo);
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
  if (linked(tree)) return;
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
  remember(tree, node, (into) => setCard(into, { ...card, column }));
}

/**
 * What a push learned, written into the node as it is on disk now: a push ends
 * after the TUI or an agent may have written the node again.
 */
function remember(tree: Tree, node: TreeNode, patch: (into: TreeNode) => void, journal?: string): void {
  patch(node);
  let fresh: TreeNode;
  try {
    fresh = nodeFromText(readFileSync(nodePath(tree.project.dir, node.id), 'utf8'), node.id);
  } catch {
    return;
  }
  patch(fresh);
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

const closedStatus = (status: Status) => status === 'done' || status === 'dropped';

type IssueMove = 'close' | 'drop' | 'reopen';

/** What the node's status asks of its issue, when the issue is not that way yet. */
export function pendingIssue(tree: Tree, node: TreeNode): IssueMove | undefined {
  const issue = issueOf(node);
  if (!linkedRepo(tree) || !issue || issue.state === 'gone') return undefined;
  const closed = issue.state === 'closed';
  if (closedStatus(node.status) && !closed) return node.status === 'dropped' ? 'drop' : 'close';
  if (!closedStatus(node.status) && closed) return 'reopen';
  return undefined;
}

/** Closes or reopens the node's issue and remembers it in the node. */
export async function moveIssue(tree: Tree, node: TreeNode, move: IssueMove, run: Gh = gh): Promise<void> {
  const repo = linkedRepo(tree);
  const issue = issueOf(node);
  if (!repo || !issue) return;
  const args = [
    'issue',
    move === 'reopen' ? 'reopen' : 'close',
    String(issue.number),
    '-R',
    `${repo.owner}/${repo.name}`,
  ];
  if (move === 'drop') args.push('--reason', 'not planned');
  await run(args);
  remember(tree, node, (into) => setIssue(into, { ...issue, state: move === 'reopen' ? 'open' : 'closed' }));
}

function issueText(number: number, move: IssueMove): string {
  return move === 'reopen' ? t('issue #{number} открыта снова', { number }) : t('issue #{number} закрыта', { number });
}

export interface Push {
  node: TreeNode;
  /** What happened on GitHub: «the card is in Review», «issue #3 closed». */
  text: string;
  column?: string;
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
  const track = (push: Promise<Push>) => {
    inFlight.add(push);
    void push.finally(() => inFlight.delete(push));
  };
  const stop = onStatusChange((tree, node) => {
    const column = pendingMove(tree, node);
    const move = pendingIssue(tree, node);
    // One after the other: both write the same node file.
    let chain: Promise<unknown> = Promise.resolve();
    if (column) {
      const push = moveCard(tree, node, column, run).then(
        (): Push => ({ node, text: t('карточка в «{column}»', { column }), column }),
        (error: unknown): Push => {
          const message = (error as Error).message.split('\n')[0] ?? '';
          remember(
            tree,
            node,
            () => {},
            t('{p1} · github · карточку не сдвинуть в «{column}»: {message}', { p1: stamp(), column, message }),
          );
          return { node, text: t('карточка в «{column}»', { column }), column, error: message };
        },
      );
      track(push);
      chain = push;
    }
    if (move) {
      const number = issueOf(node)!.number;
      const push = chain.then(() =>
        moveIssue(tree, node, move, run).then(
          (): Push => ({ node, text: issueText(number, move) }),
          (error: unknown): Push => {
            const message = (error as Error).message.split('\n')[0] ?? '';
            remember(
              tree,
              node,
              () => {},
              t('{p1} · github · не вышло: {text} — {message}', {
                p1: stamp(),
                text: issueText(number, move),
                message,
              }),
            );
            return { node, text: issueText(number, move), error: message };
          },
        ),
      );
      track(push);
    }
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
  const byIssue = new Map<string, TreeNode>();
  for (const node of tree.nodes.values()) {
    const card = cardOf(node);
    if (card) byItem.set(card.item, node);
    const issue = issueOf(node);
    if (issue?.url && !card) byIssue.set(issue.url, node);
  }
  const result: SyncResult = { added: [], pulled: [], pushed: [], failed: [], skipped: 0 };
  const parent = board.parent && tree.nodes.has(board.parent) ? board.parent : ROOT;
  const closed = new Set([board.columns.done, board.columns.dropped].filter(Boolean));
  for (const item of items) {
    let node = byItem.get(item.id);
    const column = item.status ?? '';
    const same = item.url ? byIssue.get(item.url) : undefined;
    if (!node && same) {
      // The issue is in the tree already: the card joins its node, and the board takes it from here.
      setCard(same, { item: item.id, ...(item.url ? { url: item.url } : {}) });
      writeNode(tree.project.dir, same, false);
      node = same;
    }
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

export async function openIssues(repo: Repo, run: Gh = gh): Promise<Issue[]> {
  return JSON.parse(
    await run([
      'issue',
      'list',
      '-R',
      `${repo.owner}/${repo.name}`,
      '--state',
      'open',
      '--limit',
      '1000',
      '--json',
      'number,title,url',
    ]),
  ) as Issue[];
}

/** An issue no longer among the open ones: closed (and why), open after all, or gone from GitHub. */
async function issueState(
  repo: Repo,
  number: number,
  run: Gh,
): Promise<{ state: 'open' | 'closed' | 'gone'; reason?: string }> {
  let out: string;
  try {
    out = await run([
      'issue',
      'view',
      String(number),
      '-R',
      `${repo.owner}/${repo.name}`,
      '--json',
      'state,stateReason',
    ]);
  } catch (error) {
    if (/could not resolve to an issue|not found|404|transferred/i.test((error as Error).message))
      return { state: 'gone' };
    throw error;
  }
  const raw = JSON.parse(out) as { state?: string; stateReason?: string };
  return raw.state?.toUpperCase() === 'OPEN'
    ? { state: 'open' }
    : { state: 'closed', ...(raw.stateReason ? { reason: raw.stateReason } : {}) };
}

export interface IssueSyncResult {
  added: TreeNode[];
  /** Closed or reopened on GitHub: the node followed. */
  pulled: TreeNode[];
  /** Closed or reopened in the tree: the issue followed. */
  pushed: TreeNode[];
  failed: { node: TreeNode; error: string }[];
  /** Deleted or moved to another repository: the node stays as it is. */
  gone: TreeNode[];
}

/**
 * Open issues become nodes (ideas: someone still has to look at them), once.
 * For an issue already in the tree: if GitHub closed or reopened it since the
 * last sync, the node follows; else if the node was closed or reopened here,
 * the issue follows.
 */
export async function syncIssues(tree: Tree, run: Gh = gh): Promise<IssueSyncResult> {
  const repo = linkedRepo(tree);
  if (!repo) throw new Error(t('дерево не привязано к репозиторию — treeyard github link <owner>/<репозиторий>'));
  // gh lists the newest first; the tree gets them in the order they were filed.
  const open = (await openIssues(repo, run)).sort((a, b) => a.number - b.number);
  const byNumber = new Map<number, TreeNode>();
  const byUrl = new Map<string, TreeNode>();
  for (const node of tree.nodes.values()) {
    const issue = issueOf(node);
    if (issue) byNumber.set(issue.number, node);
    else if (cardOf(node)?.url) byUrl.set(cardOf(node)!.url!, node);
  }
  const result: IssueSyncResult = { added: [], pulled: [], pushed: [], failed: [], gone: [] };
  const parent = parentFor(tree);
  for (const issue of open) {
    if (byNumber.has(issue.number)) continue;
    const card = byUrl.get(issue.url);
    if (card) {
      // It came as a card from the board: the same node, now with its issue.
      setIssue(card, { number: issue.number, url: issue.url, state: 'open' });
      writeNode(tree.project.dir, card, false);
      byNumber.set(issue.number, card);
      continue;
    }
    const added = addNode(
      tree,
      { title: issue.title, parent, status: 'idea', body: t('Issue: {url}', { url: issue.url }) },
      'github',
    );
    setIssue(added, { number: issue.number, url: issue.url, state: 'open' });
    writeNode(tree.project.dir, added, false);
    result.added.push(added);
  }
  const openNumbers = new Set(open.map((issue) => issue.number));
  for (const [number, node] of byNumber) {
    const ref = issueOf(node)!;
    if (ref.state === 'gone') continue;
    const known = ref.state ?? 'open';
    let now: { state: 'open' | 'closed' | 'gone'; reason?: string };
    if (openNumbers.has(number)) now = { state: 'open' };
    // Closed then and closed now: no need to ask GitHub about every old issue.
    else if (known === 'closed') now = { state: 'closed' };
    else {
      try {
        now = await issueState(repo, number, run);
      } catch (error) {
        result.failed.push({ node, error: (error as Error).message.split('\n')[0] ?? '' });
        continue;
      }
    }
    if (now.state === 'gone') {
      setIssue(node, { ...ref, state: 'gone' });
      node.body = appendJournal(
        node.body,
        t('{p1} · github · issue #{number} больше нет в {repo}: удалена или перенесена', {
          p1: stamp(),
          number,
          repo: `${repo.owner}/${repo.name}`,
        }),
      );
      writeNode(tree.project.dir, node);
      result.gone.push(node);
      continue;
    }
    if (now.state !== known) {
      // GitHub changed it. The state is remembered first, so the status change does not push it back.
      setIssue(node, { ...ref, state: now.state });
      const status: Status | undefined =
        now.state === 'open'
          ? closedStatus(node.status)
            ? 'todo'
            : undefined
          : closedStatus(node.status)
            ? undefined
            : /not.?planned/i.test(now.reason ?? '')
              ? 'dropped'
              : 'done';
      if (!status) {
        writeNode(tree.project.dir, node, false);
        continue;
      }
      setStatus(tree, node.id, status, {
        source: 'github',
        note: now.state === 'open' ? t('issue открыта снова') : t('issue закрыта'),
      });
      result.pulled.push(node);
      continue;
    }
    const move = pendingIssue(tree, node);
    if (!move) continue;
    try {
      await moveIssue(tree, node, move, run);
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
