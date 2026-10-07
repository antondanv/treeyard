import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { journalEntries } from '../src/model/journal.js';
import { NODE_VAR } from '../src/model/notes.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** Every command of the general help, as `treeyard <word>` starts its entries. */
const COMMANDS = [
  'init',
  'import',
  'pointer',
  'skills',
  'templates',
  'show',
  'add',
  'set',
  'log',
  'note',
  'image',
  'diff',
  'context',
  'open',
  'sessions',
  'github',
  'config',
];

function shell(cwd: string, lang: 'ru' | 'en' = 'ru') {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: lang,
    NO_COLOR: '1',
  };
  delete env[NODE_VAR];
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.FORCE_COLOR;
  return (...args: string[]) =>
    run(process.execPath, ['--import', tsx, cli, ...args], { cwd, env, timeout: 30_000 }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
}

/** The command lines of the general help: between the «Commands» heading and the statuses. */
function commandBlock(help: string): string[] {
  const lines = help.split('\n');
  const from = lines.findIndex((line) => /^(Команды|Commands)$/.test(line)) + 1;
  const to = lines.findIndex((line) => /^(Статусы|Statuses)\b/.test(line));
  return lines.slice(from, to).filter((line) => line.trim());
}

describe('treeyard <command> --help', () => {
  it('prints the lines of that command, in Russian', async () => {
    const sh = shell(tempDir());
    for (const flag of ['--help', '-h']) {
      const log = await sh('log', flag);
      expect(log.code).toBe(0);
      expect(log.stderr).toBe('');
      expect(log.stdout).toContain('treeyard log <id> "<текст>" [--as имя]');
      expect(log.stdout).toContain('--project <папка>');
      expect(log.stdout).not.toContain('treeyard show');
      expect(log.stdout).toContain('treeyard help');
    }
  }, 40_000);

  it('prints it in English', async () => {
    const sh = shell(tempDir(), 'en');
    const log = await sh('log', '--help');
    expect(log.stdout).toContain('treeyard log <id> "<text>" [--as name]');
    expect(log.stdout).toContain("a line in the node's journal");
    expect(log.stdout).toContain('all commands — treeyard help');
    expect(log.stdout).not.toContain('Команды');
    expect(log.stdout).not.toContain('treeyard add');
  }, 40_000);

  it('keeps every line of a command that takes several, continuations included', async () => {
    const sh = shell(tempDir(), 'en');
    const diff = (await sh('diff', '--help')).stdout;
    expect(diff).toContain('treeyard diff <id> [--commit <sha>]');
    expect(diff).toContain('treeyard diff <id> --add <sha> | --rm <sha>');
    expect(diff).toContain('treeyard diff <id> --working');
    expect(diff).not.toContain('treeyard image');

    const add = (await sh('add', '-h')).stdout;
    expect(add).toContain('[--done-when "…"]');
    expect(add).toContain('treeyard add "<title>" --project ../X --for <id>');
    expect(add).not.toContain('treeyard set');

    const github = (await sh('github', '--help')).stdout;
    expect(github).toContain('a GitHub Project board');
    expect(github).toContain("repository's issues");
    expect(github).not.toContain('treeyard config');
  }, 40_000);

  it('works for every command, and together they are the whole list of the general help', async () => {
    const sh = shell(tempDir(), 'en');
    const [general, ...each] = await Promise.all([sh('help'), ...COMMANDS.map((command) => sh(command, '--help'))]);
    const known = new Set<string>();
    each.forEach((result, i) => {
      expect(result.code, COMMANDS[i]).toBe(0);
      expect(result.stdout, COMMANDS[i]).toContain(`  treeyard ${COMMANDS[i]}`);
      for (const line of result.stdout.split('\n')) known.add(line);
    });
    expect(commandBlock(general!.stdout).length).toBeGreaterThan(COMMANDS.length);
    for (const line of commandBlock(general!.stdout)) expect(known, line).toContain(line);
  }, 60_000);

  it('knows the aliases, and treeyard help <command> says the same', async () => {
    const sh = shell(tempDir(), 'en');
    const show = (await sh('show', '--help')).stdout;
    expect((await sh('tree', '--help')).stdout).toBe(show);
    expect((await sh('help', 'show')).stdout).toBe(show);
    expect((await sh('help', 'tree')).stdout).toBe(show);
    expect((await sh('config', '-h')).stdout).toBe((await sh('settings', '-h')).stdout);
    expect((await sh('help', 'help')).stdout).toBe((await sh('help')).stdout);
  }, 60_000);

  it('does not invent commands', async () => {
    const sh = shell(tempDir());
    for (const args of [
      ['help', 'nope'],
      ['nope', '--help'],
    ]) {
      const result = await sh(...args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('нет такой команды «nope»');
    }
  }, 40_000);

  it('leaves what follows -- alone: it is text', async () => {
    const dir = tempDir();
    createTree(dir, getTemplate('directions')!, { title: 'Главное', answers: { goal: 'работает' }, skeleton: false });
    const node = addNode(loadTree(dir), { title: 'Узел' });
    const result = await shell(dir)('log', node.id, '--as', 'тест', '--', '--help');
    expect(result.code).toBe(0);
    expect(journalEntries(loadTree(dir).nodes.get(node.id)!.body)[0]).toContain('тест · --help');
  }, 40_000);
});
