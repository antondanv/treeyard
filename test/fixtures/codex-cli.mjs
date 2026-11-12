// Codex stand-in, used only on an isolated tmux server with a test's own CODEX_HOME.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('--model --config');
  process.exit(0);
}
// Never the person's own Codex store.
const home = process.env.CODEX_HOME;
if (!home?.includes('treeyard-')) throw new Error('the Codex stand-in needs a test CODEX_HOME');

const cwd = process.env.PWD ?? process.cwd();
// `codex resume <id>` goes on with that thread; a new one gets its id once it starts.
const id = args[0] === 'resume' ? args[1] : randomUUID();
const now = new Date();
const day = join(home, 'sessions', ...now.toISOString().slice(0, 10).split('-'));
mkdirSync(day, { recursive: true });
// The first line of a rollout, as Brainyard reads it: the thread's id, folder and start.
const meta = { id, timestamp: now.toISOString(), cwd, source: 'cli', originator: 'codex_cli_rs' };
const prompt = args[args.indexOf('--') + 1];
const lines = [{ timestamp: now.toISOString(), type: 'session_meta', payload: meta }];
if (args.includes('--') && prompt)
  lines.push({ timestamp: now.toISOString(), type: 'event_msg', payload: { type: 'user_message', message: prompt } });
writeFileSync(
  join(day, `rollout-${now.toISOString().replace(/[:.]/g, '-')}-${id}.jsonl`),
  `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
);
console.log(`codex stand-in ready ${id}`);
process.stdin.setRawMode?.(true);
process.stdin.resume();
