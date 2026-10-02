// Interactive stand-in used only on an isolated tmux server and temporary tree.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('--session-id --name --append-system-prompt --resume');
  process.exit(0);
}
if (args[0] === 'agents') {
  console.log('[]');
  process.exit(0);
}
const value = (flag) => args[args.indexOf(flag) + 1];
const id = args.includes('--resume') ? value('--resume') : value('--session-id');
writeFileSync(join(process.cwd(), `pane-${id}.json`), JSON.stringify({ args, id, cwd: process.cwd() }));
console.log('pane CLI ready');
process.stdout.write('\u001b[31mred\u001b[0m\r\n');
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  if (data === '\u0014') {
    for (let n = 0; n < 100; n++) process.stdout.write(`history line ${String(n).padStart(3, '0')}\r\n`);
    return;
  }
  if (data === '\u0013') {
    process.stdout.write('\u001b[?1049h\u001b[?1000h\u001b[?1006hmouse CLI ready\r\n');
    return;
  }
  process.stdout.write(`got:${JSON.stringify(data)}\r\n`);
  // Like Claude Code: the conversation is written down once something was sent — and only
  // into a test's own CLAUDE_CONFIG_DIR, never a real one.
  const home = process.env.CLAUDE_CONFIG_DIR;
  if (home && data.includes('\r')) {
    const cwd = process.env.PWD ?? process.cwd();
    const dir = join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(dir, { recursive: true });
    const entry = {
      type: 'user',
      cwd,
      sessionId: id,
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: data },
    };
    appendFileSync(join(dir, `${id}.jsonl`), `${JSON.stringify(entry)}\n`);
  }
});
