/**
 * Answers to letters (`treeyard send --wait`, `treeyard send --answer`).
 *
 * A letter's answer is the next letter its addressee's session writes back to the sender's node:
 * `send --wait` waits for it, and when the session ends its turn, waits for the person or ends
 * without one, says so with the end of its screen. The sender's own session is the one running
 * the command, so the answer is handed over right there and never typed into it again.
 *
 * `--answer` is the person's own answer to a question a session asks in a dialog: the coordinator
 * passes it on, the session's pane gets it as keys. A permission is not a question: only the
 * person gives it, in the pane.
 */
import { capturePane, sendToPane } from '@antondanv/brainyard';

import { t } from '../i18n/i18n.js';
import { LETTER_ANSWER } from '../model/history.js';
import { letterByNumber, type MailItem, markDelivered, readMail, withMailLock } from '../model/mailbox.js';
import { logToNode } from '../model/ops.js';
import { holderOf } from '../model/tree.js';
import type { Status, Tree } from '../model/types.js';
import { DELIVER_SOURCES, type DeliverSources } from './deliver.js';
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

/** A choice of a dialog, as its screen shows it: `❯ 2. зелёный`. */
export interface DialogOption {
  n: number;
  label: string;
  /** The row the cursor is on. */
  selected: boolean;
  /** «Type something», «Other»: the answer is typed. */
  free: boolean;
}

const OPTION = /^\s*([❯›>▸▶])?\s*(\d{1,2})[.)]\s+(.+?)\s*$/;
const FREE = /^(type something|other|something else|none of the above|свой вариант|другое|ввести|напиши)/i;

/** The numbered choices on the screen, in order; the last list on it when there are several. */
export function dialogOptions(screen: readonly string[]): DialogOption[] {
  let options: DialogOption[] = [];
  for (const row of screen) {
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
      t('сессия ждёт человека не в панели — ответить можно только в ней: claude attach {short}', {
        short: ref.id.slice(0, 8),
      }),
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
    await keys(pane, `${PASTE_START}${typed}${PASTE_END}`);
    await sources.pause(300);
  }
  await keys(pane, '\r');
  await sources.pause(1200);
  const screen = screenTail((await capture(pane))?.lines ?? []);
  logToNode(tree, id, t(LETTER_ANSWER, { text: typed ?? `${option.n}. ${option.label}` }), options.source);
  return { option, ...(typed ? { text: typed } : {}), pane, screen };
}
