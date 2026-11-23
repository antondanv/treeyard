/**
 * `treeyard send`: the coordinator writes the next message to a node's own session instead of
 * starting a new one — a new session reads the whole conversation again, the same one goes on.
 *
 * The letter goes into the project's mailbox first (model/mailbox.ts), whatever the addressee is
 * doing, and gets a number; then it is delivered at once if the session can take it, and otherwise
 * waits — busy, waiting for the person, asleep, open in the person's terminal or no session yet —
 * for the deliverer (deliver.ts) to hand it over. Nothing is refused for the addressee's state.
 */
import { t } from '../i18n/i18n.js';
import { letterFrom, letterFromShell, letterHeading, letterTo, letterToSession } from '../model/mail.js';
import { addLetter, type Delivery, type Hold, letterByNumber, type MailItem, withMailLock } from '../model/mailbox.js';
import { logToNode } from '../model/ops.js';
import { holderOf } from '../model/tree.js';
import type { SessionRef, Tree, TreeNode } from '../model/types.js';
import {
  type Attempt,
  DELIVER_SOURCES,
  type DeliverSources,
  deliverNode,
  ensureDeliverer,
  shortId,
  spawnDeliverer,
} from './deliver.js';
import type { PaneSize } from './panes.js';
import { newestSession, observe } from './wait.js';

export { letterHeading };

export interface Sent {
  /** The letter as the mailbox has it after this send: queued or delivered. */
  letter: MailItem;
  /** Delivered now: how. */
  how?: Delivery;
  /** The session it went to, or waits for. */
  ref?: SessionRef;
  /** The pane it went to, when it went to one. */
  pane?: string;
  /** Still waiting: why. */
  held?: Hold;
  heldFor?: string;
  /** The deliverer was started for it. */
  deliverer?: boolean;
  warnings: string[];
}

/** Why a message was not sent; the CLI prints it and exits 1. */
export class NotSent extends Error {}

/** What send uses of Brainyard; tests put their own. */
export type SendSources = DeliverSources;
export const SEND_SOURCES: SendSources = DELIVER_SOURCES;

export interface SendOptions {
  size?: PaneSize;
  /** Who writes, for the journal: the agent's name or «ты». */
  source?: string;
  /** The node whose session writes (see `senderNode`): the letter goes into its journal too. */
  sender?: TreeNode | undefined;
  sources?: SendSources;
  /** Starts the deliverer for a letter that waits; tests put their own. */
  spawn?: (dir: string) => void;
}

/** Writes `text` to node `id`: into the mailbox, and to its newest session as soon as it can take it. */
export async function sendToNode(tree: Tree, id: string, text: string, options: SendOptions = {}): Promise<Sent> {
  const sources = options.sources ?? SEND_SOURCES;
  const node = holderOf(tree, id);
  if (!node) throw new NotSent(t('нет узла {id}', { id }));
  const dir = tree.project.dir;
  const sender = options.sender && options.sender.id !== id ? tree.nodes.get(options.sender.id) : undefined;
  const ref = newestSession(node);
  const letter = addLetter(dir, {
    to: id,
    ...(sender ? { from: sender.id } : {}),
    ...(options.source ? { who: options.source } : {}),
    text,
  });
  // One line per letter in each journal, whatever happens to it next.
  if (sender) {
    logToNode(tree, id, letterFrom(sender, text, letter.n), options.source);
    logToNode(tree, sender.id, letterTo(node, text, letter.n), options.source);
  } else if (ref) logToNode(tree, id, letterToSession(ref.brain, shortId(ref), text, letter.n), options.source);
  else logToNode(tree, id, letterFromShell(text, letter.n), options.source);

  const world = await observe(dir, sources);
  let attempt: Attempt | undefined;
  try {
    attempt = await withMailLock(dir, () =>
      deliverNode(tree, id, world, { sources, ...(options.size ? { size: options.size } : {}) }),
    );
  } catch (error) {
    // The lock is held by a delivery that takes long: the deliverer picks the letter up.
    attempt = { node: id, letters: [letter.n], warnings: [error instanceof Error ? error.message : String(error)] };
  }
  const now = letterByNumber(dir, letter.n) ?? letter;
  const sent: Sent = { letter: now, warnings: [...(attempt?.warnings ?? [])] };
  const to = attempt?.ref ?? ref;
  if (to) sent.ref = to;
  if (now.state === 'delivered') {
    if (now.delivered?.how) sent.how = now.delivered.how;
    if (now.delivered?.pane) sent.pane = now.delivered.pane;
    return sent;
  }
  if (attempt?.error) sent.warnings.push(t('не доставлено сразу: {error}', { error: attempt.error }));
  sent.held = now.held ?? attempt?.held ?? 'busy';
  if (now.heldFor) sent.heldFor = now.heldFor;
  if (sent.held !== 'none') sent.deliverer = ensureDeliverer(tree, options.spawn ?? spawnDeliverer);
  return sent;
}
