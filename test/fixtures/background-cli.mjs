// A background CLI with real processes and isolated state, for the session lifecycle test.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const home = process.env.CLAUDE_CONFIG_DIR;
if (!home) throw new Error('background fixture requires an isolated CLAUDE_CONFIG_DIR');
const state = join(home, 'background.json');
const read = () => (existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')) : []);
const save = (rows) => {
  const path = `${state}.${process.pid}.tmp`;
  writeFileSync(path, JSON.stringify(rows));
  renameSync(path, state);
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (args.includes('--help')) {
  console.log('--session-id --name --append-system-prompt --resume --bg');
  process.exit(0);
}
if (args[0] === 'agents') {
  console.log(JSON.stringify(read().filter((row) => args.includes('--all') || running(row.pid))));
  process.exit(0);
}
if (args[0] === 'stop') {
  const row = read().find((entry) => entry.id === args[1]);
  if (!row) process.exit(1);
  if (running(row.pid)) process.kill(row.pid, 'SIGTERM');
  const end = Date.now() + 5000;
  while (running(row.pid) && Date.now() < end) await pause(20);
  process.exit(running(row.pid) ? 1 : 0);
}
if (args[0] === 'worker') {
  const id = args[1];
  const cwd = realpathSync(process.cwd());
  const row = {
    id: id.slice(0, 8),
    sessionId: id,
    cwd,
    name: 'Фоновая проверка',
    kind: 'background',
    status: 'busy',
    state: 'working',
    pid: process.pid,
    startedAt: Date.now(),
  };
  const dir = join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.jsonl`),
    [
      {
        type: 'user',
        cwd,
        entrypoint: 'cli',
        timestamp: new Date().toISOString(),
        message: { content: 'Фоновая проверка' },
      },
      { type: 'system', cwd, sessionKind: 'bg' },
    ]
      .map((entry) => `${JSON.stringify(entry)}\n`)
      .join(''),
  );
  save([...read(), row]);
  process.on('SIGTERM', () => {
    save(read().map((entry) => (entry.sessionId === id ? { ...entry, status: 'idle', state: 'done' } : entry)));
    process.exit(0);
  });
  setInterval(() => undefined, 1000);
} else if (args.includes('--bg')) {
  const id = randomUUID();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', id], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const end = Date.now() + 5000;
  while (!read().some((row) => row.sessionId === id) && Date.now() < end) await pause(20);
  if (!read().some((row) => row.sessionId === id)) process.exit(1);
  console.log(`backgrounded · ${id.slice(0, 8)} · Фоновая проверка`);
} else if (args.includes('--resume')) {
  const id = args[args.indexOf('--resume') + 1];
  writeFileSync(join(process.cwd(), 'background-resume.json'), JSON.stringify({ args, id, pid: process.pid }));
  process.stdin.setRawMode?.(true);
  process.stdin.on('data', (data) => {
    writeFileSync(join(process.cwd(), 'background-input.txt'), data);
    if (data.includes('q')) process.exit(0);
  });
  setImmediate(() => console.log(`Background conversation resumed ${id}`));
}
