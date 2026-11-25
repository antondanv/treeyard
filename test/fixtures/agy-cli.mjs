// Antigravity stand-in, used only on an isolated tmux server with a test's own HOME.
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const logs = process.env.TREEYARD_TEST_AGY_LOGS === '1';
if (args.includes('--help')) {
  console.log(`--conversation --model --effort --mode --prompt-interactive${logs ? ' --log-file' : ''}`);
  process.exit(0);
}
// Never the person's own Antigravity store: Brainyard reads it from the home folder.
if (!homedir().includes('treeyard-')) throw new Error('the Antigravity stand-in needs a test HOME');

const cwd = process.env.PWD ?? process.cwd();
const at = args.indexOf('--conversation');
const id = at >= 0 ? args[at + 1] : randomUUID();
const prompt = args.find((arg) => arg.startsWith('--prompt-interactive='))?.slice('--prompt-interactive='.length);
const home = join(homedir(), '.gemini', 'antigravity-cli');
mkdirSync(home, { recursive: true });
if (logs) {
  const { DatabaseSync } = await import('node:sqlite');
  const log = args[args.indexOf('--log-file') + 1];
  const logDir = join(home, 'log');
  if (!log?.startsWith(`${logDir}/`)) throw new Error('expected a launch-specific log in the test HOME');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(log, `Creating CLI server backend: workspaceDirs=[${cwd}]\nCreated conversation ${id}\n`);
  const db = new DatabaseSync(join(home, 'conversation_summaries.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_summaries (
    conversation_id text primary key, title text, workspace_uris text, status text,
    not_fully_idle numeric, killed numeric, last_modified_time datetime, last_user_input_time datetime
  )`);
  const now = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO conversation_summaries VALUES (?, ?, ?, ?, 0, 0, ?, ?)').run(
    id,
    id,
    '',
    'CASCADE_RUN_STATUS_RUNNING',
    now,
    now,
  );
  db.close();
} else {
  // Like agy: what was typed goes to its history, with the conversation and the workspace.
  const entry = { conversationId: id, workspace: cwd, timestamp: Date.now(), display: prompt ?? '' };
  appendFileSync(join(home, 'history.jsonl'), `${JSON.stringify(entry)}\n`);
}
console.log(`agy stand-in ready ${id}`);
process.stdin.setRawMode?.(true);
process.stdin.resume();
