/**
 * The mailbox of a project: every letter of `treeyard send`, whole, with its number and whether it
 * has reached the session yet. The journals keep one line per letter (mail.ts) and go into git;
 * the mailbox is per machine, in `.tree/.local/mail/`, a file per letter — writers never touch
 * each other's letters, and a number is taken by creating its file, so two senders never share one.
 *
 * A letter waits here while its node's session cannot take it (busy, waiting for the person,
 * asleep, open in the person's terminal, or no session at all); the deliverer (agents/deliver.ts)
 * hands it over as soon as it can, and a new session of the node gets it in its first message.
 */
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWrite, TREE_DIR } from './store.js';
import { nowIso } from './time.js';

/** How a letter reached its session. */
export type Delivery =
  /** Pasted into its live pane. */
  | 'typed'
  /** Its pane was asleep: the same conversation woke in a new pane with the letter. */
  | 'woke'
  /** A Claude Code background session resumed with it. */
  | 'resumed'
  /** In the first message of a new session of the node. */
  | 'first'
  /** `treeyard wait` of the addressee's own session printed it. */
  | 'wait';

/** Why a letter still waits. */
export type Hold =
  /** The session is at work: it gets the letter once its turn is over. */
  | 'busy'
  /** A permission or a question for the person is open: keys typed now would answer it. */
  | 'waiting'
  /** Open in the person's own terminal: nothing to type into until it is closed. */
  | 'terminal'
  /** The CLI has just started and has not said what it is doing yet. */
  | 'starting'
  /** No session to give it to: the node's next session gets it in its first message. */
  | 'none';

export interface MailItem {
  /** The letter's number in this project. */
  n: number;
  /** The node it is addressed to. */
  to: string;
  /** The node whose session wrote it; none for a letter from a shell outside the tree's sessions. */
  from?: string;
  /** Who wrote it, as the journal names them: an agent's CLI or «ты». */
  who?: string;
  text: string;
  /** When it was sent. */
  at: string;
  state: 'queued' | 'delivered';
  /** Queued: why, as last seen. */
  held?: Hold;
  /** `waiting`: what the session waits for, as its CLI says. */
  heldFor?: string;
  /** The letter this one answers: the last one the addressee's node wrote to the sender's before it. */
  replyTo?: number;
  delivered?: {
    at: string;
    how: Delivery;
    /** `claude 1a2b3c4d` */
    session?: string;
    pane?: string;
  };
}

export function mailDir(dir: string): string {
  return join(dir, TREE_DIR, '.local', 'mail');
}

const LETTER_FILE = /^(\d+)\.json$/;

function letterPath(dir: string, n: number): string {
  return join(mailDir(dir), `${n}.json`);
}

function parseItem(text: string): MailItem | undefined {
  try {
    const item = JSON.parse(text) as Partial<MailItem>;
    if (typeof item.n !== 'number' || typeof item.to !== 'string' || typeof item.text !== 'string') return undefined;
    return { state: 'queued', at: '', ...item } as MailItem;
  } catch {
    return undefined;
  }
}

let cache: { dir: string; stamp: string; items: MailItem[] } | undefined;

/**
 * Every letter of the project, oldest first. Read again only when the folder changed: a letter is
 * written by rename, so a new or updated one moves the folder's time.
 */
export function readMail(dir: string): MailItem[] {
  const folder = mailDir(dir);
  let names: string[];
  let stamp: string;
  try {
    const stat = statSync(folder);
    names = readdirSync(folder);
    stamp = `${stat.mtimeMs}:${names.length}`;
  } catch {
    return [];
  }
  if (cache && cache.dir === dir && cache.stamp === stamp) return cache.items;
  const items: MailItem[] = [];
  for (const name of names) {
    if (!LETTER_FILE.test(name)) continue;
    try {
      const item = parseItem(readFileSync(join(folder, name), 'utf8'));
      if (item) items.push(item);
    } catch {
      // A letter being replaced this very moment: the next read has it.
    }
  }
  items.sort((a, b) => a.n - b.n);
  cache = { dir, stamp, items };
  return items;
}

/** Letters of `node`: got (`to`) and sent by its session (`from`). */
export function mailOfNode(dir: string, node: string): MailItem[] {
  return readMail(dir).filter((item) => item.to === node || item.from === node);
}

/** Letters still waiting for node `id`'s session, oldest first. */
export function queuedFor(dir: string, id: string): MailItem[] {
  return readMail(dir).filter((item) => item.to === id && item.state === 'queued');
}

/** Every letter still waiting, of any node. */
export function queuedLetters(dir: string): MailItem[] {
  return readMail(dir).filter((item) => item.state === 'queued');
}

export function letterByNumber(dir: string, n: number): MailItem | undefined {
  try {
    return parseItem(readFileSync(letterPath(dir, n), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Puts a new letter into the mailbox, queued, under the next free number. */
export function addLetter(dir: string, letter: Omit<MailItem, 'n' | 'state' | 'at'> & { at?: string }): MailItem {
  const folder = mailDir(dir);
  mkdirSync(folder, { recursive: true });
  let n =
    readdirSync(folder)
      .map((name) => Number(LETTER_FILE.exec(name)?.[1] ?? 0))
      .reduce((max, each) => Math.max(max, each), 0) + 1;
  for (;;) {
    const item: MailItem = { ...letter, n, state: 'queued', at: letter.at ?? nowIso() };
    try {
      // `wx`: the number belongs to whoever creates its file first.
      const fd = openSync(letterPath(dir, n), 'wx');
      try {
        writeSync(fd, `${JSON.stringify(item, null, 2)}\n`);
      } finally {
        closeSync(fd);
      }
      cache = undefined;
      return item;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      n++;
    }
  }
}

/** Writes a letter back after its state changed. */
export function saveLetter(dir: string, item: MailItem): void {
  atomicWrite(letterPath(dir, item.n), `${JSON.stringify(item, null, 2)}\n`);
  cache = undefined;
}

/** Marks letters as reached their session. Letters someone else delivered meanwhile stay as they are. */
export function markDelivered(
  dir: string,
  numbers: readonly number[],
  how: Delivery,
  where: { session?: string; pane?: string } = {},
): MailItem[] {
  const done: MailItem[] = [];
  for (const n of numbers) {
    const item = letterByNumber(dir, n);
    if (!item || item.state === 'delivered') continue;
    const { held: _held, heldFor: _for, ...rest } = item;
    const next: MailItem = { ...rest, state: 'delivered', delivered: { at: nowIso(), how, ...where } };
    saveLetter(dir, next);
    done.push(next);
  }
  return done;
}

/** Remembers why letters still wait, when that changed: `show` and the TUI say it. */
export function markHeld(dir: string, numbers: readonly number[], held: Hold, heldFor?: string): void {
  for (const n of numbers) {
    const item = letterByNumber(dir, n);
    if (item?.state !== 'queued') continue;
    if (item.held === held && item.heldFor === heldFor) continue;
    const { heldFor: _for, ...rest } = item;
    saveLetter(dir, { ...rest, held, ...(heldFor ? { heldFor } : {}) });
  }
}

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, someone else's.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** A lock older than this was left by a process that died mid-delivery. */
const STALE_LOCK_MS = 120_000;

/** A file held by one live process at a time: `.lock` for a delivery, `.deliverer` for the deliverer. */
export function takeFile(dir: string, name: string): boolean {
  const folder = mailDir(dir);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = holderPid(dir, name);
      let age = 0;
      try {
        age = Date.now() - statSync(path).mtimeMs;
      } catch {}
      // The deliverer lives for hours; a delivery that holds the lock this long has died with it.
      const stale = !holder || !running(holder) || (name === LOCK && age > STALE_LOCK_MS);
      if (!stale) return false;
      try {
        unlinkSync(path);
      } catch {}
    }
  }
  return false;
}

export function holderPid(dir: string, name: string): number | undefined {
  try {
    const pid = Number(readFileSync(join(mailDir(dir), name), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export function dropFile(dir: string, name: string): void {
  if (holderPid(dir, name) !== process.pid) return;
  try {
    unlinkSync(join(mailDir(dir), name));
  } catch {}
}

export const LOCK = '.lock';
export const DELIVERER = '.deliverer';

/** Whether a deliverer runs for this project now. */
export function delivererRunning(dir: string): boolean {
  const pid = holderPid(dir, DELIVERER);
  return Boolean(pid && running(pid));
}

/** Runs `fn` while holding the project's delivery lock: one delivery at a time, whoever starts it. */
export async function withMailLock<T>(dir: string, fn: () => Promise<T>, waitMs = 15_000): Promise<T> {
  const end = Date.now() + waitMs;
  while (!takeFile(dir, LOCK)) {
    if (Date.now() > end) throw new Error('mailbox lock');
    await new Promise((done) => setTimeout(done, 100));
  }
  try {
    return await fn();
  } finally {
    dropFile(dir, LOCK);
  }
}
