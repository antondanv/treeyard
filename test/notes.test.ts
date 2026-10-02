import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { setLang } from '../src/i18n/i18n.js';
import { description, journalEntries } from '../src/model/journal.js';
import { addNote, NODE_VAR, noteOrigin, notesBranch, originText } from '../src/model/notes.js';
import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { childrenOf } from '../src/model/tree.js';
import { ROOT } from '../src/model/types.js';
import { DEFAULTS, loadSettings, saveSettings } from '../src/settings.js';
import { emptyTree, tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
// The command runs in other folders, where a bare `tsx` would not be found.
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

afterEach(() => {
  setLang('ru');
});

describe('notes', () => {
  it('finds the «Замечания» branch, the top one first, and plants it when there is none', () => {
    const tree = emptyTree();
    const planted = notesBranch(tree);
    expect(planted).toMatchObject({ title: 'Замечания', parent: ROOT, who: 'human' });
    expect(planted.doneWhen).toContain('разобрано');
    expect(notesBranch(loadTree(tree.project.dir)).id).toBe(planted.id);

    const other = emptyTree();
    const deep = addNode(other, { title: 'Notes', parent: addNode(other, { title: 'Веха' }).id });
    expect(notesBranch(other).id).toBe(deep.id);
    const top = addNode(other, { title: 'Замечания' });
    expect(notesBranch(other).id).toBe(top.id);
  });

  it('a note is an idea in the branch: the title on one line, where it came from in the description', () => {
    const tree = emptyTree();
    const branch = addNode(tree, { title: 'Замечания' });
    const from = emptyTree();
    const work = addNode(from, { title: 'Закрыть один узел' });
    const note = addNote(tree, '  ширина\n  сбрасывается ', { project: 'Factoyard', node: work }, 'claude');
    const saved = loadTree(tree.project.dir).nodes.get(note.id)!;
    expect(saved).toMatchObject({ title: 'ширина сбрасывается', parent: branch.id, status: 'idea' });
    expect(description(saved.body)).toBe(`Откуда: Factoyard › «Закрыть один узел» (${work.id})`);
    expect(journalEntries(saved.body)).toEqual([expect.stringContaining('· claude · завёл узел')]);
    expect(childrenOf(loadTree(tree.project.dir), branch.id).map((n) => n.id)).toEqual([note.id]);
  });

  it('knows the node: named, then the session’s TREEYARD_NODE, then the Claude Code session it holds', () => {
    const tree = emptyTree();
    const named = addNode(tree, { title: 'Named' });
    const started = addNode(tree, { title: 'Started from' });
    const holder = addNode(tree, { title: 'Holds the session' });
    attachSession(tree, holder.id, { brain: 'claude', id: 'session-1' });
    const env = { [NODE_VAR]: started.id, CLAUDE_CODE_SESSION_ID: 'session-1' };

    expect(noteOrigin(tree, '/x', env, named.id).node?.id).toBe(named.id);
    expect(noteOrigin(tree, '/x', env).node?.id).toBe(started.id);
    expect(noteOrigin(tree, '/x', { ...env, [NODE_VAR]: 'gone' }).node?.id).toBe(holder.id);
    expect(noteOrigin(tree, '/x', { [NODE_VAR]: '', CLAUDE_CODE_SESSION_ID: 'other' })).toEqual({ project: 'Тест' });
    expect(noteOrigin(undefined, '/somewhere/Factoyard', env)).toEqual({ project: 'Factoyard' });
    expect(originText({ project: 'Factoyard' })).toBe('Factoyard');
  });

  it('the notes folder is a setting', () => {
    const env = { TREEYARD_HOME: tempDir('treeyard-home-') };
    expect(loadSettings(env).notes).toBe('');
    saveSettings({ ...DEFAULTS, notes: '/projects/Treeyard' }, env);
    expect(loadSettings(env).notes).toBe('/projects/Treeyard');
  });
});

describe('treeyard note', () => {
  function shell(cwd: string, home: string, extra: NodeJS.ProcessEnv = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, TREEYARD_HOME: home, TREEYARD_LANG: '', NO_COLOR: '1', ...extra };
    // This suite may itself run inside a session from a node.
    if (!(NODE_VAR in extra)) delete env[NODE_VAR];
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.FORCE_COLOR;
    return (...args: string[]) =>
      run(process.execPath, ['--import', tsx, cli, ...args], { cwd, env, timeout: 30_000 }).then(
        ({ stdout }) => ({ code: 0, stdout, stderr: '' }),
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
  }

  it('writes from another project into «Замечания» of the notes tree, with the project and the node', async () => {
    const target = emptyTree();
    const branch = addNode(target, { title: 'Замечания' });
    const factoyard = emptyTree();
    const work = addNode(factoyard, { title: 'Закрыть один узел' });
    const inside = join(factoyard.project.dir, 'src');
    mkdirSync(inside);
    const home = tempDir('treeyard-home-');

    const unset = await shell(inside, home)('note', 'проверка');
    expect(unset.code).toBe(2);
    expect(unset.stderr).toContain('treeyard config notes');

    const set = await shell(inside, home)('config', 'notes', target.project.dir);
    expect(set.stdout).toContain(`notes = ${target.project.dir}`);

    const done = await shell(inside, home, { [NODE_VAR]: work.id })('note', 'проверка');
    expect(done.code).toBe(0);
    const id = done.stdout.split(' ')[0]!;
    expect(done.stdout).toContain(`Тест › Замечания ← Тест › «Закрыть один узел» (${work.id})`);
    const note = loadTree(target.project.dir).nodes.get(id)!;
    expect(note).toMatchObject({ title: 'проверка', parent: branch.id, status: 'idea' });
    expect(description(note.body)).toBe(`Откуда: Тест › «Закрыть один узел» (${work.id})`);
    // The project it came from is only read.
    expect(loadTree(factoyard.project.dir).nodes.size).toBe(1);
  });

  it('outside a session: the project only, or the node named with --node', async () => {
    const target = emptyTree();
    const factoyard = emptyTree();
    const work = addNode(factoyard, { title: 'Работа' });
    const home = tempDir('treeyard-home-');
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ notes: target.project.dir }));
    const note = (...args: string[]) => shell(factoyard.project.dir, home)('note', ...args);

    const plain = await note('просто', 'так');
    expect(plain.stdout).toMatch(/← Тест\n$/);
    const named = await note('по узлу', '--node', work.id.slice(0, 3));
    expect(named.stdout).toContain(`← Тест › «Работа» (${work.id})`);
    const wrong = await note('мимо', '--node', 'zzzz');
    expect(wrong.code).toBe(2);
    const titles = childrenOf(loadTree(target.project.dir), notesBranch(loadTree(target.project.dir)).id).map(
      (n) => n.title,
    );
    expect(titles).toEqual(['просто так', 'по узлу']);
  });
});
