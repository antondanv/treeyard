import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { panesAvailable } from '@antondanv/brainyard';
import { afterAll, describe, expect, it } from 'vitest';

import { REPORT_URL, VERSION } from '../src/crash.js';
import { addNode } from '../src/model/ops.js';
import { emptyTree, tempDir } from './helpers.js';

const run = promisify(execFile);
// tmux is the terminal here, on its own server.
const socket = `treeyard-test-${process.pid}-crash`;
const preload = fileURLToPath(new URL('./fixtures/crash-preload.mjs', import.meta.url));
// One process, no tsx runner in between: the signal goes to treeyard itself.
const tsx = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
const tsconfig = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
const main = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const hasTmux = panesAvailable();

const term = async (...args: string[]) =>
  (await run('tmux', ['-L', socket, '-f', '/dev/null', ...args], { timeout: 10_000 })).stdout;
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(check: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await check()) && Date.now() < end) await pause(100);
  expect(await check()).toBe(true);
}

/** On, then off: a mode turned on in the raw output is turned off after its last switch-on. */
const ON_OFF: [string, string][] = [
  ['\u001b[?1000h', '\u001b[?1000l'],
  ['\u001b[?1006h', '\u001b[?1006l'],
  ['\u001b[?1004h', '\u001b[?1004l'],
  ['\u001b[?7l', '\u001b[?7h'],
  ['\u001b[?1049h', '\u001b[?1049l'],
];

describe.skipIf(!hasTmux)('a fall in a real terminal', () => {
  afterAll(async () => {
    await term('kill-server').catch(() => undefined);
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGHUP', 129],
    ['error', 1],
  ])(
    '%s: the terminal is back as the shell had it',
    async (how, code) => {
      const tree = emptyTree();
      addNode(tree, { title: 'Узел перед падением' });
      const work = tempDir('treeyard-crash-');
      const home = tempDir('treeyard-home-');
      const pidFile = join(work, 'pid');
      const crashFile = join(work, 'crash-now');
      const raw = join(work, 'raw');
      const session = `fall-${how}`;
      const target = `=${session}:`;
      const env = {
        TREEYARD_HOME: home,
        TREEYARD_LANG: 'ru',
        TREEYARD_SKILLS: 'off',
        TREEYARD_TEST_PID_FILE: pidFile,
        TREEYARD_TEST_CRASH_FILE: crashFile,
        TSX_TSCONFIG_PATH: tsconfig,
        BRAINYARD_TMUX_SOCKET: `${socket}-panes`,
        TERM: 'xterm-256color',
        CI: 'true',
      };
      // After treeyard: its exit code and whether the line discipline is cooked again.
      await term(
        'new-session',
        '-d',
        '-s',
        session,
        '-x',
        '110',
        '-y',
        '30',
        '-c',
        tree.project.dir,
        ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
        '--',
        'sh',
        '-c',
        `"${process.execPath}" --import "${tsx}" --import "${preload}" "${main}"; echo "exit $?"; stty -a | tr ' ' '\\n' | grep -x -- '-*icanon'; sleep 60`,
      );
      await term('pipe-pane', '-o', '-t', target, `cat >> '${raw}'`);
      const flags = async () =>
        (
          await term(
            'display-message',
            '-p',
            '-t',
            target,
            '#{alternate_on} #{mouse_any_flag} #{mouse_sgr_flag} #{wrap_flag} #{cursor_flag}',
          )
        ).trim();
      const screen = async () => (await term('capture-pane', '-p', '-t', target)).trimEnd();
      await until(async () => (await screen()).includes('Узел перед падением'));
      expect(await flags()).toBe('1 1 1 0 0');

      if (how === 'error') writeFileSync(crashFile, '');
      else await run('kill', ['-s', how, readFileSync(pidFile, 'utf8').trim()]);
      await until(async () => (await screen()).includes('exit '));
      await pause(200);

      const text = await screen();
      // Main screen, no mouse reports, autowrap on, the cursor shown; the keyboard is cooked again.
      expect(await flags()).toBe('0 0 0 1 1');
      expect(text).toContain(`exit ${code}`);
      expect(text.split('\n')).toContain('icanon');
      const output = readFileSync(raw, 'latin1');
      for (const [on, off] of ON_OFF)
        expect(output.lastIndexOf(off), JSON.stringify(on)).toBeGreaterThan(output.lastIndexOf(on));

      if (how !== 'error') {
        expect(text).not.toContain('упал');
        return;
      }
      const logs = existsSync(join(home, 'crashes')) ? readdirSync(join(home, 'crashes')) : [];
      expect(logs).toHaveLength(1);
      const log = join(home, 'crashes', logs[0]!);
      expect(readFileSync(log, 'utf8')).toContain(`treeyard ${VERSION}`);
      expect(readFileSync(log, 'utf8')).toContain('Error: проверка падения');
      // The message stays on the main screen; tmux wraps the long path, so it is read unwrapped.
      const flat = (await term('capture-pane', '-p', '-J', '-t', target)).replace(/\s+/g, ' ');
      expect(flat).toContain(`✗ treeyard ${VERSION} упал: проверка падения`);
      expect(flat).toContain(`подробности — в ${log}`);
      expect(flat).toContain(`сообщи об ошибке: ${REPORT_URL} — приложи этот файл`);
    },
    60_000,
  );
});
