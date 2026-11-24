/**
 * The last message of a session, whole, from the CLI's own transcript (Claude Code's jsonl, Codex's
 * rollout, OpenCode's database): the question a session ended its turn with, or its summary, of any
 * length. Reading a CLI's store is Brainyard's job, not treeyard's — `lastMessage(brain, id)`.
 *
 * Brainyard before the version that adds it has no such function: the answer is then nothing and
 * `treeyard wait` falls back to the end of the pane's screen.
 */
import * as brainyard from '@antondanv/brainyard';

/** What Brainyard's `lastMessage` takes and gives; only the text is used here. */
type Reader = (brain: string, id: string) => Promise<{ text?: unknown } | undefined>;

/** The text of the session's last message, or undefined: no reader, no transcript, no message. */
export async function readLastMessage(lib: object, brain: string, id: string): Promise<string | undefined> {
  const read: unknown = Reflect.get(lib, 'lastMessage');
  if (typeof read !== 'function') return undefined;
  const found = await (read as Reader)(brain, id);
  const text = typeof found?.text === 'string' ? found.text.trim() : '';
  return text || undefined;
}

/** The last message of a session of Brainyard's CLIs. */
export function lastMessage(brain: string, id: string): Promise<string | undefined> {
  return readLastMessage(brainyard, brain, id);
}
