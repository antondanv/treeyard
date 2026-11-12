import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inLinkedWorktree, projectsPath, rememberProject, seenProjects } from '../src/projects.js';
import { createTree, getTemplate } from '../src/templates/templates.js';
import { tempDir, treeyardIn } from './helpers.js';

const git = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });

function tree(title: string, goal?: string): string {
  const dir = tempDir();
  createTree(dir, getTemplate('directions')!, { title, answers: goal ? { goal } : {}, skeleton: false });
  return realpathSync(dir);
}

const home = (): NodeJS.ProcessEnv => ({ TREEYARD_HOME: tempDir('treeyard-home-') });
const minutes = (n: number) => new Date(Date.parse('2026-11-12T12:00:00Z') + n * 60_000);

describe('projects treeyard has seen', () => {
  it('remembers folders with trees, the most recently seen first, with title and goal', () => {
    const env = home();
    const shop = tree('Магазин', 'десять заказов от чужих людей');
    const blog = tree('Блог');
    rememberProject(shop, env, minutes(0));
    rememberProject(blog, env, minutes(20));
    const seen = seenProjects(env);
    expect(seen.map((p) => p.path)).toEqual([blog, shop]);
    expect(seen[1]).toMatchObject({ title: 'Магазин', goal: 'десять заказов от чужих людей' });
    expect(Date.parse(seen[0]!.seen)).toBe(minutes(20).getTime());
    // Seen again: back to the top.
    rememberProject(shop, env, minutes(40));
    expect(seenProjects(env).map((p) => p.path)).toEqual([shop, blog]);
  });

  it('leaves the file alone when the tree was seen a moment ago', () => {
    const env = home();
    const dir = tree('Проект');
    rememberProject(dir, env, minutes(0));
    const before = readFileSync(projectsPath(env), 'utf8');
    rememberProject(dir, env, minutes(5));
    expect(readFileSync(projectsPath(env), 'utf8')).toBe(before);
    rememberProject(dir, env, minutes(11));
    expect(Date.parse(seenProjects(env)[0]!.seen)).toBe(minutes(11).getTime());
  });

  it('lists only folders that still hold a tree, but keeps the rest in the file', () => {
    const env = home();
    const gone = tree('Временная копия');
    const kept = tree('Настоящий');
    rememberProject(gone, env, minutes(0));
    rememberProject(kept, env, minutes(1));
    rmSync(gone, { recursive: true, force: true });
    expect(seenProjects(env).map((p) => p.title)).toEqual(['Настоящий']);
    // A disk that isn't mounted comes back with its place in the list.
    expect(readFileSync(projectsPath(env), 'utf8')).toContain(gone);
  });

  it('skips the copy of the tree in a linked git worktree', () => {
    const env = home();
    const main = tree('Основной');
    git(main, 'init', '-q');
    git(main, 'add', '.');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'tree');
    const copy = join(tempDir(), 'branch');
    git(main, 'worktree', 'add', '-q', copy);
    expect(inLinkedWorktree(main)).toBe(false);
    expect(inLinkedWorktree(copy)).toBe(true);
    rememberProject(copy, env, minutes(0));
    rememberProject(main, env, minutes(1));
    expect(seenProjects(env).map((p) => p.path)).toEqual([main]);
  });

  it('never fails the command when the home folder cannot be written', () => {
    const blocked = join(tempDir(), 'file');
    writeFileSync(blocked, '');
    const env = { TREEYARD_HOME: join(blocked, 'home') };
    expect(() => rememberProject(tree('Проект'), env)).not.toThrow();
    expect(seenProjects(env)).toEqual([]);
  });

  it('treeyard projects lists the trees other commands and the TUI were run on', async () => {
    const env = home();
    const shop = tree('Магазин', 'десять заказов');
    const blog = tree('Блог');
    const elsewhere = tempDir();
    expect((await treeyardIn(elsewhere, env)('projects')).stdout).toContain('treeyard ещё не видел ни одного дерева');
    await treeyardIn(shop, env)('show');
    await treeyardIn(blog, env)('find', 'что-нибудь');
    // A command that fails before it reaches a tree remembers nothing.
    await treeyardIn(elsewhere, env)('show');
    const json = await treeyardIn(elsewhere, env)('projects', '--json');
    expect(json.code).toBe(0);
    const list = JSON.parse(json.stdout) as { path: string; title: string; goal: string | null; seen: string }[];
    expect(list.map((p) => p.title).sort()).toEqual(['Блог', 'Магазин']);
    expect(list.find((p) => p.title === 'Магазин')).toMatchObject({ path: shop, goal: 'десять заказов' });
    expect(list.find((p) => p.title === 'Блог')?.goal).toBeNull();
    expect(Object.keys(list[0]!)).toEqual(['path', 'title', 'goal', 'seen']);
    const text = await treeyardIn(elsewhere, env)('projects');
    expect(text.stdout).toMatch(/Магазин\s+\S+\s+только что/);
    expect((await treeyardIn(elsewhere, env)('projects', 'лишнее')).code).toBe(2);
  });
});
