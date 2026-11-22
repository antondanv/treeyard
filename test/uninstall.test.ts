import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { shippedSkills, skillsRoot } from '../src/agents/skills.js';
import { tempDir, treeyardIn } from './helpers.js';

/** A machine with Claude Code, Codex and Antigravity, a treeyard home, and git without the person's config. */
function machine() {
  const home = tempDir('treeyard-uninstall-home-');
  for (const dir of ['.claude', '.codex', join('.gemini', 'antigravity-cli')])
    mkdirSync(join(home, dir), { recursive: true });
  const env = {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'),
    TREEYARD_HOME: join(home, '.treeyard'),
    // vitest.config.ts turns installing off; here the skills are put in first, to be taken away.
    TREEYARD_SKILLS: '',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    BRAINYARD_TMUX_BIN: 'treeyard-test-no-tmux',
    BRAINYARD_CLAUDE_BIN: 'treeyard-test-no-claude',
  };
  const dirs = [
    join(home, '.claude', 'skills'),
    join(home, '.codex', 'skills'),
    join(home, '.gemini', 'config', 'skills'),
  ];
  return { home, env, dirs };
}

/** A git repository with a tree planted in it. */
async function project(env: NodeJS.ProcessEnv) {
  const dir = tempDir();
  execFileSync('git', ['init', '-q'], { cwd: dir, env: { ...process.env, ...env } });
  const sh = treeyardIn(dir, env);
  expect((await sh('init', '--template', 'directions', '--goal', 'всё работает')).code).toBe(0);
  return { dir, sh };
}

describe('treeyard uninstall', () => {
  it('takes skills, hooks and (asked) settings away, and leaves the tree alone', async () => {
    const { env, dirs } = machine();
    const here = await project(env);
    const other = await project(env);
    for (const skills of dirs) expect(readdirSync(skills).sort()).toEqual(shippedSkills());

    // The person's own post-commit here; treeyard's block goes next to it.
    const hook = join(here.dir, '.git', 'hooks', 'post-commit');
    mkdirSync(join(here.dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(hook, '#!/bin/sh\necho mine\n');
    chmodSync(hook, 0o755);
    expect((await here.sh('hook', 'install')).code).toBe(0);
    expect((await other.sh('hook', 'install')).code).toBe(0);
    // `show` there remembered the project: its hook is found from here.
    expect((await other.sh('show')).code).toBe(0);
    const otherHook = join(other.dir, '.git', 'hooks', 'post-commit');
    // A copy the project keeps for Claude Code, and a Codex skill linked to a checkout.
    cpSync(join(skillsRoot(), 'treeyard'), join(here.dir, '.claude', 'skills', 'treeyard'), { recursive: true });
    const checkout = tempDir('treeyard-checkout-');
    cpSync(join(skillsRoot(), 'treeyard-init'), join(checkout, 'treeyard-init'), { recursive: true });
    rmSync(join(dirs[1]!, 'treeyard-init'), { recursive: true });
    symlinkSync(join(checkout, 'treeyard-init'), join(dirs[1]!, 'treeyard-init'));
    // Someone else's skill in the same folder stays.
    mkdirSync(join(dirs[0]!, 'mine'), { recursive: true });
    writeFileSync(join(dirs[0]!, 'mine', 'SKILL.md'), 'not treeyard');
    expect((await here.sh('config', 'lang', 'ru')).code).toBe(0);
    const settings = join(env.TREEYARD_HOME, 'settings.json');
    expect(existsSync(settings)).toBe(true);
    const tree = readFileSync(join(here.dir, '.tree', 'tree.md'), 'utf8');

    // --dry-run lists everything and removes nothing.
    const dry = await here.sh('uninstall', '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('treeyard uninstall уберёт:');
    expect(dry.stdout).toContain('скилл treeyard · Claude Code');
    expect(dry.stdout).toContain('скилл treeyard-init · Codex · ссылка');
    expect(dry.stdout).toContain('скилл treeyard · папка проекта');
    expect(dry.stdout.split('хук post-commit').length - 1).toBe(2);
    expect(dry.stdout).not.toContain('настройки treeyard');
    expect(dry.stdout).toContain('.tree/ и блок о дереве');
    for (const skills of dirs) expect(readdirSync(skills).filter((name) => name !== 'mine').length).toBe(3);
    expect(readFileSync(hook, 'utf8')).toContain('treeyard hook post-commit');

    const run = await here.sh('uninstall');
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('✓ скилл treeyard · Antigravity');
    expect(run.stdout).toContain('npm uninstall -g @antondanv/treeyard');
    // Nothing of treeyard's is left in the CLIs (uninstall itself installs nothing back).
    expect(readdirSync(dirs[0]!)).toEqual(['mine']);
    expect(readdirSync(dirs[1]!)).toEqual([]);
    expect(readdirSync(dirs[2]!)).toEqual([]);
    expect(existsSync(join(here.dir, '.claude', 'skills', 'treeyard'))).toBe(false);
    // The link went, the checkout it pointed at did not.
    expect(existsSync(join(checkout, 'treeyard-init', 'SKILL.md'))).toBe(true);
    // Only treeyard's block left the person's hook; the hook it wrote alone is gone whole.
    expect(readFileSync(hook, 'utf8')).toBe('#!/bin/sh\necho mine\n');
    expect(existsSync(otherHook)).toBe(false);
    // The tree and the settings stay.
    expect(readFileSync(join(here.dir, '.tree', 'tree.md'), 'utf8')).toBe(tree);
    expect(readdirSync(join(here.dir, '.tree', 'nodes')).length).toBeGreaterThan(0);
    expect(existsSync(settings)).toBe(true);

    // Nothing left: says so. --settings takes treeyard's home folder too.
    const again = await here.sh('uninstall', '--settings');
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('✓ настройки treeyard');
    expect(existsSync(env.TREEYARD_HOME)).toBe(false);
    expect((await here.sh('uninstall')).stdout).toContain('убирать нечего');
    expect(lstatSync(join(here.dir, '.tree')).isDirectory()).toBe(true);
  });

  it('is in the help and refuses unknown options', async () => {
    const sh = treeyardIn(tempDir(), { TREEYARD_SKILLS: 'off' });
    const help = await sh('uninstall', '--help');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('treeyard uninstall [--settings] [--dry-run]');
    expect((await sh('uninstall', '--everything')).code).not.toBe(0);
  });
});
