/**
 * A GitHub Project board beside the tree. `github:` in tree.md names the
 * board and which column each status lives in; `github:` in a node names its
 * card and the column the card was last seen in. `sync` brings new cards in
 * and carries a move over from whichever side made it; a status changed in
 * the tree moves the card right away.
 *
 * Everything goes through `gh`: its login and its scopes, no tokens of ours.
 */
import { execFile } from 'node:child_process';
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
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
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
  if (parent && parent !== ROOT) board.parent = parent;
  tree.project.extra.github = boardData(board);
  writeProject(tree.project);
  return board;
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
