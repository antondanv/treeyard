// A deterministic interview; the real CLI imports into a temporary project.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
writeFileSync(join(process.cwd(), 'interview.json'), JSON.stringify({ args, node: process.env.TREEYARD_NODE }));
console.log('planting CLI ready');
process.stdin.setRawMode?.(true);
process.stdin.setEncoding('utf8');
let line = '';
let pending = '';
process.stdin.on('data', (data) => {
  if (data.includes('\u0003')) process.exit(130);
  pending += data;
  while (pending) {
    // Native CLIs ignore terminal replies left over from a full-screen attachment.
    if (pending.startsWith('\u001b')) {
      if (pending.length < 2) return;
      if (pending[1] === '[') {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: a terminal reply, not interview text.
        const csi = /^\u001b\[[0-?]*[ -/]*[@-~]/u.exec(pending);
        if (!csi) return;
        pending = pending.slice(csi[0].length);
      } else if (pending[1] === 'P') {
        const end = pending.indexOf('\u001b\\');
        if (end < 0) return;
        pending = pending.slice(end + 2);
      } else pending = pending.slice(2);
      continue;
    }
    const char = pending[0];
    pending = pending.slice(1);
    if (char !== '\r' && char !== '\n') {
      line += char;
      continue;
    }
    const input = line.trim();
    line = '';
    if (input === 'exit') process.exit(0);
    if (!['plant', 'more'].includes(input)) continue;
    const plan =
      input === 'plant'
        ? {
            title: 'Росток',
            template: 'directions',
            goal: 'Проверить в жизни',
            nodes: [
              {
                title: 'Веха',
                status: 'active',
                children: [{ title: 'Шаг 1', status: 'active', done_when: 'работает' }],
              },
            ],
          }
        : { nodes: [{ title: 'Шаг 2', status: 'todo', done_when: 'проверено' }] };
    const imported = spawnSync(
      process.env.TREEYARD_TEST_TSX,
      ['--tsconfig', process.env.TREEYARD_TEST_TSCONFIG, process.env.TREEYARD_TEST_MAIN, 'import', '--from-json', '-'],
      { input: JSON.stringify(plan), encoding: 'utf8', env: process.env },
    );
    if (imported.status !== 0) {
      console.error(imported.stderr);
      process.exit(1);
    }
    console.log(input === 'plant' ? 'tree planted; conversation continues' : 'another node planted');
  }
});
