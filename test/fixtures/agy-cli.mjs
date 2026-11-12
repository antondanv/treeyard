// Antigravity stand-in, used only on an isolated tmux server with a test's own HOME.
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('--conversation --model --effort --mode --prompt-interactive');
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
// Like agy: what was typed goes to its history, with the conversation and the workspace.
const entry = { conversationId: id, workspace: cwd, timestamp: Date.now(), display: prompt ?? '' };
appendFileSync(join(home, 'history.jsonl'), `${JSON.stringify(entry)}\n`);
console.log(`agy stand-in ready ${id}`);
process.stdin.setRawMode?.(true);
process.stdin.resume();
