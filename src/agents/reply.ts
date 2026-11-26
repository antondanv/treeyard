/**
 * Answers to letters and dialogs (`treeyard send --wait`, `--answer`, `--approve`, `--reject`).
 *
 * A letter's answer is the next letter its addressee's session writes back to the sender's node:
 * `send --wait` waits for it, and when the session ends its turn, waits for the person or ends
 * without one, says so with the end of its screen. The sender's own session is the one running
 * the command, so the answer is handed over right there and never typed into it again.
 *
 * `--answer` is the person's own answer to a question a session asks in a dialog: the coordinator
 * passes it on, the session's pane gets it as keys.
 *
 * `--approve` and `--reject` confirm or decline a permission or startup dialog in a pane — only at
 * the person's direct request (`--as ты` / `--as you`), after checking the dialog on the screen,
 * with a journal entry of what was confirmed or declined.
 */
import { capturePane, sendToPane } from '@antondanv/brainyard';

import { t } from '../i18n/i18n.js';
import { LETTER_ANSWER, LETTER_APPROVE, LETTER_REJECT } from '../model/history.js';
import { letterByNumber, type MailItem, markDelivered, readMail, withMailLock } from '../model/mailbox.js';
import { logToNode } from '../model/ops.js';
import { holderOf } from '../model/tree.js';
import type { Status, Tree } from '../model/types.js';
import { DELIVER_SOURCES, type DeliverSources, typeText } from './deliver.js';
import {
  GRACE_MS,
  INTERVAL_MS,
  look,
  newestSession,
  observe,
  type Sight,
  SOURCES,
  screenTail,
  sessionSight,
  type WaitSources,
} from './wait.js';

export interface ReplyResult {
  /** The letter as the mailbox has it now. */
  letter: MailItem;
  /** The answer, from the addressee's node to the sender's. */
  reply?: MailItem;
  /** The addressee, when its session ended its turn, waits for the person or ended without an answer. */
  sight?: Sight;
  timedOut: boolean;
}

export interface ReplyOptions {
  timeoutMs?: number;
  intervalMs?: number;
  graceMs?: number;
  sources?: WaitSources;
}

/** The first letter back from the addressee's node to the sender's after letter `sent`. */
export function replyTo(dir: string, sent: Pick<MailItem, 'n' | 'to' | 'from'>): MailItem | undefined {
  if (!sent.from) return undefined;
  return readMail(dir).find((item) => item.from === sent.to && item.to === sent.from && item.n > sent.n);
}

/**
 * Letters that reached a session through a command it runs (`send --wait`, `wait`): delivered
 * there, so the deliverer does not type them in again after its turn.
 */
export async function takeLetters(dir: string, letters: readonly MailItem[]): Promise<void> {
  const queued = letters.filter((letter) => letter.state === 'queued').map((letter) => letter.n);
  if (queued.length) await withMailLock(dir, async () => void markDelivered(dir, queued, 'wait'));
}

/** Waits for the answer to letter `sent`, or for its addressee to stop without one. */
export async function waitReply(dir: string, sent: MailItem, options: ReplyOptions = {}): Promise<ReplyResult> {
  const sources = options.sources ?? SOURCES;
  const interval = options.intervalMs ?? INTERVAL_MS;
  const grace = options.graceMs ?? GRACE_MS;
  const deadline = options.timeoutMs ? sources.now() + options.timeoutMs : Number.POSITIVE_INFINITY;
  const from = new Map<string, Status>();
  const worked = new Set<string>();
  let wake: (() => void) | undefined;
  // A letter back writes its line into the sender's journal: the tree changes and wakes the wait.
  const watcher = sources.watch(dir, () => wake?.());
  try {
    for (;;) {
      const letter = letterByNumber(dir, sent.n) ?? sent;
      const reply = replyTo(dir, sent);
      if (reply) {
        await takeLetters(dir, [reply]);
        return { letter, reply: letterByNumber(dir, reply.n) ?? reply, timedOut: false };
      }
      let sight: Sight | undefined;
      // Until the session has the letter, its state says nothing about it.
      if (letter.state === 'delivered') {
        [sight] = await look(dir, [sent.to], from, grace, sources, worked, false);
        const reason = sight?.reason;
        if (reason === 'idle' || reason === 'gone' || reason === 'waiting') {
          // The answer may have come with the end of the turn.
          const late = replyTo(dir, sent);
          if (late) {
            await takeLetters(dir, [late]);
            return { letter, reply: letterByNumber(dir, late.n) ?? late, timedOut: false };
          }
          return { letter, sight: sight!, timedOut: false };
        }
      }
      const left = deadline - sources.now();
      if (left <= 0) return { letter, ...(sight ? { sight } : {}), timedOut: true };
      await new Promise<void>((done) => {
        const timer = setTimeout(done, Math.min(interval, left));
        wake = () => {
          clearTimeout(timer);
          done();
        };
      });
      wake = undefined;
    }
  } finally {
    watcher.stop();
  }
}

/** A choice of a dialog, as its screen shows it: `❯ 2. green`. */
export interface DialogOption {
  n: number;
  label: string;
  /** The row the cursor is on. */
  selected: boolean;
  /** «Type something», «Other»: the answer is typed. */
  free: boolean;
}

const OPTION = /^\s*([❯›>▸▶])?\s*(\d{1,2})[.)]\s+(.+?)\s*$/;
const CURSOR = /^(\s*)([❯›>▸▶])(\s+)(.+?)\s*$/;
const FREE = /^(type something|other|something else|none of the above|свой вариант|другое|ввести|напиши)/i;
const RULE = /^[╭╮╰╯┌┐└┘├┤┬┴┼─━═╌╍┄┅┈┉\s]+$/;
const FOOTER = /^(?:enter\b|esc(?:ape)?\b|press\b|use\s+(?:arrow|↑|↓)|↑\/↓|tab\b|ctrl\+)/i;
const TURN_AFTER = /^[⏺●✦◆]/;
const AFFIRMATIVE =
  /^(?:yes|allow|approve|accept|trust|proceed|continue|confirm|always|once|permit|ok|да|разреш\S*|доверя\S*|подтверд\S*|продолж\S*)\b/i;
const NEGATIVE =
  /^(?:no|deny|reject|cancel|decline|abort|exit|quit|skip|don't|do not|never|disallow|disable|require approval|нет|отклон\S*|отмен\S*|запрет\S*|не доверя\S*|выйти)\b/i;

function unboxRow(line: string): string {
  return line.replace(/^\s*[│┃║]\s?/, '').replace(/\s?[│┃║]\s*$/, '');
}

/** The numbered choices on the screen, in order; the last list on it when there are several. */
export function dialogOptions(screen: readonly string[]): DialogOption[] {
  let options: DialogOption[] = [];
  for (const raw of screen) {
    const row = unboxRow(raw);
    const match = OPTION.exec(row);
    if (!match) continue;
    const n = Number(match[2]);
    // A new list starts at 1: an earlier one on the screen was a past answer.
    if (n === 1) options = [];
    if (options.length && n !== options.at(-1)!.n + 1) continue;
    const label = match[3]!.replace(/\.$/, '');
    options.push({ n, label, selected: Boolean(match[1]), free: FREE.test(label) });
  }
  return options;
}

function isPermissionLabel(label: string): boolean {
  return AFFIRMATIVE.test(label) || NEGATIVE.test(label);
}

/**
 * Unnumbered arrow-driven choices near the bottom of a screen (e.g. Antigravity's
 * `> Yes, I trust this folder` / `  No, exit`). Requires a cursor marker, at least two options,
 * and at least one affirmative/negative label so normal terminal output never passes for a dialog.
 */
function unnumberedPermissionOptions(rows: readonly string[]): DialogOption[] {
  const window = rows.slice(-18);
  let cursorIdx = -1;
  let cursorIndent = 0;
  let labelCol = 0;
  let cursorLabel = '';
  for (let i = window.length - 1; i >= 0; i--) {
    const match = CURSOR.exec(window[i]!);
    if (!match) continue;
    const label = match[4]!.replace(/\.$/, '');
    if (!label || FOOTER.test(label)) continue;
    cursorIdx = i;
    cursorIndent = match[1]!.length;
    labelCol = match[1]!.length + match[2]!.length + match[3]!.length;
    cursorLabel = label;
    break;
  }
  if (cursorIdx === -1) return [];
  if (window.length - 1 - cursorIdx > 8) return [];

  const siblingLabel = (line: string): 'desc' | string | undefined => {
    const trimmed = line.trim();
    if (!trimmed || FOOTER.test(trimmed) || TURN_AFTER.test(trimmed) || CURSOR.test(line)) return undefined;
    if (/[?:]$/.test(trimmed)) return undefined;
    const indent = /^(\s*)/.exec(line)![1]!.length;
    const label = trimmed.replace(/\.$/, '');
    if (indent > labelCol + 1) return 'desc';
    const aligned =
      indent === labelCol ||
      (cursorIndent === 0 && indent >= 1 && indent <= labelCol + 1) ||
      (indent === cursorIndent && isPermissionLabel(label));
    return aligned ? label : undefined;
  };

  const before: string[] = [];
  let skips = 0;
  for (let i = cursorIdx - 1; i >= 0; i--) {
    const hit = siblingLabel(window[i]!);
    if (hit === 'desc') {
      if (++skips > 2) break;
      continue;
    }
    if (!hit) break;
    skips = 0;
    before.unshift(hit);
  }

  const after: string[] = [];
  let lastOptionIdx = cursorIdx;
  skips = 0;
  for (let i = cursorIdx + 1; i < window.length; i++) {
    const hit = siblingLabel(window[i]!);
    if (hit === 'desc') {
      if (++skips > 2) break;
      continue;
    }
    if (!hit) break;
    skips = 0;
    after.push(hit);
    lastOptionIdx = i;
  }

  if (window.length - 1 - lastOptionIdx > 6) return [];
  if (window.slice(lastOptionIdx + 1).some((row) => TURN_AFTER.test(row.trim()))) return [];

  const labels = [...before, cursorLabel, ...after];
  if (labels.length < 2) return [];
  if (!labels.some(isPermissionLabel)) return [];
  return labels.map((label, idx) => ({
    n: idx + 1,
    label,
    selected: idx === before.length,
    free: FREE.test(label),
  }));
}

/**
 * Choices of a permission or startup dialog on the screen: numbered (`1. Yes, proceed`) or
 * arrow-driven without numbers (`> Yes, I trust this folder` / `  No, exit`), near the bottom of
 * the screen. Empty when no dialog is visible — never guesses on a blank or chat screen.
 */
export function permissionOptions(screen: readonly string[]): DialogOption[] {
  const rows = screen
    .filter((line) => line.trim() && !RULE.test(line))
    .map(unboxRow)
    .filter((line) => line.trim());
  if (!rows.length) return [];

  // Numbered list near the bottom of the screen.
  let numbered: { option: DialogOption; row: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const match = OPTION.exec(rows[i]!);
    if (!match) continue;
    const n = Number(match[2]);
    if (n === 1) numbered = [];
    if (numbered.length && n !== numbered.at(-1)!.option.n + 1) continue;
    const label = match[3]!.replace(/\.$/, '');
    numbered.push({ option: { n, label, selected: Boolean(match[1]), free: FREE.test(label) }, row: i });
  }
  if (numbered.length >= 2) {
    const lastRow = numbered.at(-1)!.row;
    const tail = rows.slice(lastRow + 1);
    const nearBottom = tail.length <= 6 && !tail.some((row) => TURN_AFTER.test(row.trim()));
    if (nearBottom && numbered.some((item) => isPermissionLabel(item.option.label))) {
      return numbered.map((item) => item.option);
    }
  }

  return unnumberedPermissionOptions(rows);
}

/** Whether what the session waits for is a question it asks, not a permission. */
export function isQuestion(waitingFor: string | undefined): boolean {
  return /^input\b/i.test(waitingFor?.trim() ?? '');
}

export interface Answered {
  /** The choice made, or the free-text row the text went into. */
  option: DialogOption;
  /** Typed into the free-text row. */
  text?: string;
  pane: string;
  /** The end of the screen after the answer. */
  screen: string[];
}

/** Why an answer cannot go to the session; the CLI prints it and exits 1. */
export class NotAnswered extends Error {}

/** What an answer uses of Brainyard; tests put their own. */
export type AnswerSources = DeliverSources & {
  capture?(pane: string): Promise<{ lines: string[] } | undefined>;
  keys?(pane: string, data: string): Promise<void>;
};

export interface AnswerOptions {
  /** Who passes it on, for the journal. */
  source?: string;
  sources?: AnswerSources;
}

const UP = '\u001b[A';
const DOWN = '\u001b[B';
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';

/**
 * Passes the person's answer to the question node `id`'s session waits on: a choice by its number
 * or its words, or any other text into the dialog's free-text row. Moves with the arrows and
 * Enter, as a person would, in Claude Code and Codex alike.
 */
export async function answerQuestion(
  tree: Tree,
  id: string,
  answer: string,
  options: AnswerOptions = {},
): Promise<Answered> {
  const sources: AnswerSources = options.sources ?? DELIVER_SOURCES;
  const capture = sources.capture ?? ((pane: string) => capturePane(pane));
  const keys = sources.keys ?? ((pane: string, data: string) => sendToPane(pane, data));
  const node = holderOf(tree, id);
  if (!node) throw new NotAnswered(t('нет узла {id}', { id }));
  const ref = newestSession(node);
  const world = await observe(tree.project.dir, sources);
  const sight = ref ? sessionSight(ref, world) : undefined;
  if (!ref || !sight || sight.state !== 'waiting')
    throw new NotAnswered(
      t('сессия узла {id} не ждёт ответа на вопрос — обычное письмо: treeyard send {id} "…"', { id }),
    );
  if (!sight.pane)
    throw new NotAnswered(
      ref.brain === 'claude'
        ? t('сессия ждёт человека не в панели — ответить можно только в ней: claude attach {short}', {
            short: ref.id.slice(0, 8),
          })
        : t('сессия ждёт человека не в панели — ответь в терминале, где она открыта'),
    );
  if (!isQuestion(sight.waitingFor))
    throw new NotAnswered(
      t('сессия ждёт разрешения ({why}) — его даёт только человек: tmux -L brainyard attach -t {pane}', {
        why: sight.waitingFor ?? '?',
        pane: sight.pane,
      }),
    );
  const pane = sight.pane;
  const before = screenTail((await capture(pane))?.lines ?? [], 40);
  const choices = dialogOptions(before);
  if (!choices.length)
    throw new NotAnswered(t('не вижу вариантов вопроса на экране панели {pane} — ответь в ней сам', { pane }));
  const wanted = answer.trim();
  const byNumber = /^\d+$/.test(wanted) ? choices.find((choice) => choice.n === Number(wanted)) : undefined;
  const byWords = choices.find((choice) => choice.label.toLowerCase() === wanted.toLowerCase());
  const free = choices.find((choice) => choice.free);
  const option = byNumber ?? byWords ?? free;
  if (!option)
    throw new NotAnswered(
      t('нет такого варианта, а своего текста вопрос не принимает: {choices}', {
        choices: choices.map((choice) => `${choice.n}. ${choice.label}`).join(' · '),
      }),
    );
  const at = Math.max(
    0,
    choices.findIndex((choice) => choice.selected),
  );
  const to = choices.indexOf(option);
  const step = to > at ? DOWN : UP;
  for (let move = 0; move < Math.abs(to - at); move++) {
    await keys(pane, step);
    await sources.pause(60);
  }
  const typed = option === byNumber || option === byWords ? undefined : wanted;
  if (typed) {
    await typeText({ type: keys }, pane, `${PASTE_START}${typed}${PASTE_END}`);
    await sources.pause(300);
  }
  await keys(pane, '\r');
  await sources.pause(1200);
  const screen = screenTail((await capture(pane))?.lines ?? []);
  logToNode(tree, id, t(LETTER_ANSWER, { text: typed ?? `${option.n}. ${option.label}` }), options.source);
  return { option, ...(typed ? { text: typed } : {}), pane, screen };
}

export type PermissionDecision = 'approve' | 'reject';

export interface PermissionResolved {
  decision: PermissionDecision;
  /** The choice selected with Enter; undefined when `--reject` pressed Escape. */
  option?: DialogOption;
  /** Which key confirmed the action. */
  key: 'enter' | 'escape';
  /** What the session waited for (`approve Bash`, `folder trust`, …). */
  waitingFor?: string;
  pane: string;
  /** The end of the screen after the key was sent. */
  screen: string[];
}

export interface PermissionOptions extends AnswerOptions {
  /** Optional choice number or words for `--approve` (e.g. `2` or `Yes, proceed`). */
  choice?: string;
}

/** Human-readable description of what was approved or rejected, for the journal and CLI output. */
export function permissionSummary(resolved: Pick<PermissionResolved, 'option' | 'waitingFor'>): string {
  const chosen = resolved.option ? `«${resolved.option.n}. ${resolved.option.label}»` : 'Esc';
  return resolved.waitingFor ? `${resolved.waitingFor} — ${chosen}` : chosen;
}

const ESC = '\u001b';

/** Picks a choice by number, exact words, or unique case-insensitive substring match. */
function matchPermissionChoice(choices: readonly DialogOption[], raw: string): DialogOption | undefined {
  const wanted = raw.trim();
  if (/^\d+$/.test(wanted)) return choices.find((choice) => choice.n === Number(wanted));
  const lower = wanted.toLowerCase();
  const exact = choices.find((choice) => choice.label.toLowerCase() === lower);
  if (exact) return exact;
  const partial = choices.filter((choice) => choice.label.toLowerCase().includes(lower));
  return partial.length === 1 ? partial[0] : undefined;
}

/**
 * Approves or rejects a permission or startup dialog in node `id`'s pane — only called after the
 * CLI verified that the person requested it (`--as ты` / `--as you` or an interactive terminal).
 * Verifies the session is waiting on a non-question dialog, reads the choices off the screen,
 * sends arrows + Enter (or Escape on `--reject` when no negative option is listed), and records
 * what was confirmed or declined in the node's journal.
 */
export async function resolvePermission(
  tree: Tree,
  id: string,
  decision: PermissionDecision,
  options: PermissionOptions = {},
): Promise<PermissionResolved> {
  const sources: AnswerSources = options.sources ?? DELIVER_SOURCES;
  const capture = sources.capture ?? ((pane: string) => capturePane(pane));
  const keys = sources.keys ?? ((pane: string, data: string) => sendToPane(pane, data));
  const node = holderOf(tree, id);
  if (!node) throw new NotAnswered(t('нет узла {id}', { id }));
  const ref = newestSession(node);
  const world = await observe(tree.project.dir, sources);
  const sight = ref ? sessionSight(ref, world) : undefined;
  if (!ref || !sight || sight.state !== 'waiting')
    throw new NotAnswered(t('сессия узла {id} не ждёт разрешения', { id }));
  if (!sight.pane)
    throw new NotAnswered(
      ref.brain === 'claude'
        ? t('сессия ждёт человека не в панели — подтвердить можно только в ней: claude attach {short}', {
            short: ref.id.slice(0, 8),
          })
        : t('сессия ждёт человека не в панели — подтвердить можно только в терминале, где она открыта'),
    );
  if (isQuestion(sight.waitingFor))
    throw new NotAnswered(
      t('сессия ждёт ответа на вопрос ({why}), а не разрешения — используй treeyard send {id} --answer "…"', {
        why: sight.waitingFor ?? '?',
        id,
      }),
    );
  const pane = sight.pane;
  const before = screenTail((await capture(pane))?.lines ?? [], 40);
  const choices = permissionOptions(before);
  if (!choices.length)
    throw new NotAnswered(
      t('не вижу диалога разрешения на экране панели {pane} — проверь в ней сам: tmux -L brainyard attach -t {pane}', {
        pane,
      }),
    );

  let option: DialogOption | undefined;
  let key: 'enter' | 'escape' = 'enter';
  if (decision === 'approve') {
    const wanted = options.choice?.trim();
    if (wanted) {
      option = matchPermissionChoice(choices, wanted);
      if (!option)
        throw new NotAnswered(
          t('нет такого варианта разрешения: {choices}', {
            choices: choices.map((choice) => `${choice.n}. ${choice.label}`).join(' · '),
          }),
        );
    } else {
      option = choices.find((choice) => AFFIRMATIVE.test(choice.label)) ?? choices.find((c) => !NEGATIVE.test(c.label));
      if (!option)
        throw new NotAnswered(
          t('не нашёл утвердительного варианта на экране панели {pane}: {choices}', {
            pane,
            choices: choices.map((choice) => `${choice.n}. ${choice.label}`).join(' · '),
          }),
        );
    }
  } else {
    option = choices.find((choice) => NEGATIVE.test(choice.label));
    if (!option) key = 'escape';
  }

  if (option) {
    const at = Math.max(
      0,
      choices.findIndex((choice) => choice.selected),
    );
    const to = choices.indexOf(option);
    const step = to > at ? DOWN : UP;
    for (let move = 0; move < Math.abs(to - at); move++) {
      await keys(pane, step);
      await sources.pause(60);
    }
    await keys(pane, '\r');
  } else {
    await keys(pane, ESC);
  }
  await sources.pause(1200);
  const screen = screenTail((await capture(pane))?.lines ?? []);
  const resolved: PermissionResolved = {
    decision,
    ...(option ? { option } : {}),
    key,
    ...(sight.waitingFor ? { waitingFor: sight.waitingFor } : {}),
    pane,
    screen,
  };
  const what = permissionSummary(resolved);
  logToNode(tree, id, t(decision === 'approve' ? LETTER_APPROVE : LETTER_REJECT, { what }), options.source);
  return resolved;
}
