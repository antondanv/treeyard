// OpenCode stand-in, used only on an isolated tmux server with a test's own XDG_DATA_HOME.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('--session --prompt --agent --model --auto');
  process.exit(0);
}
// Never the person's own OpenCode store.
const data = process.env.XDG_DATA_HOME;
if (!data?.includes('treeyard-opencode-')) throw new Error('the OpenCode stand-in needs a test XDG_DATA_HOME');

/** `--flag value` or `--flag=value`. */
const value = (flag) => {
  const bound = args.find((arg) => arg.startsWith(`${flag}=`));
  if (bound) return bound.slice(flag.length + 1);
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};

const cwd = process.env.PWD ?? process.cwd();
const home = join(data, 'opencode');
mkdirSync(home, { recursive: true });
// The columns Brainyard reads from OpenCode's own database.
const db = new DatabaseSync(join(home, 'opencode.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT,
    permission TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
  CREATE TABLE IF NOT EXISTS message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
  CREATE TABLE IF NOT EXISTS part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER,
    data TEXT);
`);
let id = value('--session');
if (!id) {
  // Like OpenCode: the first message starts the session, and the answer completes the turn.
  const now = Date.now();
  id = `ses_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO session VALUES (?, NULL, ?, ?, NULL, ?, ?, NULL)').run(
    id,
    cwd,
    `New session - ${new Date(now).toISOString()}`,
    now,
    now + 2,
  );
  const message = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
  message.run(`${id}-ask`, id, now, JSON.stringify({ role: 'user', time: { created: now } }));
  message.run(
    `${id}-answer`,
    id,
    now + 1,
    JSON.stringify({ role: 'assistant', time: { created: now + 1, completed: now + 2 } }),
  );
  db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)').run(
    `${id}-text`,
    `${id}-ask`,
    id,
    now,
    JSON.stringify({ type: 'text', text: value('--prompt') ?? '' }),
  );
}
db.close();
writeFileSync(join(cwd, `opencode-${id}.json`), JSON.stringify({ args, id }));
console.log(`opencode stand-in ready ${id}`);
process.stdin.setRawMode?.(true);
process.stdin.resume();
