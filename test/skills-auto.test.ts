import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { autoInstallSkills, shippedSkills, skillHomes, skillsRoot } from '../src/agents/skills.js';
import type { ProjectStatus } from '../src/status.js';
import { tempDir, treeyardIn } from './helpers.js';

/** A home where Claude Code, Codex and Antigravity are set up, and the environment that points at it. */
function machine(): { home: string; env: NodeJS.ProcessEnv; dirs: string[] } {
  const home = tempDir('treeyard-skills-home-');
  for (const dir of ['.claude', '.codex', join('.gemini', 'antigravity-cli')])
    mkdirSync(join(home, dir), { recursive: true });
  const env = {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CODEX_HOME: join(home, '.codex'),
    // vitest.config.ts turns installing off for every spawned CLI; these runs are about it.
    TREEYARD_SKILLS: '',
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

const shipped = (skill: string, file = 'SKILL.md') => readFileSync(join(skillsRoot(), skill, file), 'utf8');

describe('skills install themselves', () => {
  it('init puts them into every CLI, any command in a tree refreshes them, status and skills only show', async () => {
    const { env, dirs } = machine();
    const dir = tempDir();
    const sh = treeyardIn(dir, env);

    const init = await sh('init', '--template', 'directions', '--goal', 'всё работает');
    expect(init.code).toBe(0);
    expect(init.stderr).toContain('скиллы treeyard');
    expect(init.stderr).toContain('в Claude Code, Codex, Antigravity');
    for (const skills of dirs) {
      expect(readdirSync(skills).sort()).toEqual(shippedSkills());
      expect(readFileSync(join(skills, 'treeyard', 'references', 'tree-order.md'), 'utf8')).toBe(
        shipped('treeyard', join('references', 'tree-order.md')),
      );
    }

    // Another version shipped another skill: the next command brings it in line, and says so once.
    writeFileSync(join(dirs[1]!, 'treeyard', 'SKILL.md'), 'an older version');
    const show = await sh('show');
    expect(show.code).toBe(0);
    expect(show.stderr).toContain('скиллы treeyard');
    expect(show.stderr).toContain('в Codex ·');
    expect(readFileSync(join(dirs[1]!, 'treeyard', 'SKILL.md'), 'utf8')).toBe(shipped('treeyard'));
    expect((await sh('show')).stderr).not.toContain('скиллы treeyard');
    // Swapped in whole: nothing half-made is left next to it.
    expect(readdirSync(dirs[1]!).filter((name) => name.startsWith('.'))).toEqual([]);

    // status reads and never writes: a missing skill stays missing there.
    const removed = join(dirs[0]!, 'treeyard-coordinate');
    writeFileSync(join(removed, 'SKILL.md'), 'changed by hand');
    const status = await sh('status', '--json');
    const found = JSON.parse(status.stdout) as ProjectStatus;
    expect(found.skillsAuto).toBe(true);
    expect(found.skills.find((s) => s.brain === 'claude' && s.skill === 'treeyard-coordinate')?.state).toBe('outdated');
    expect(readFileSync(join(removed, 'SKILL.md'), 'utf8')).toBe('changed by hand');
    expect((await sh('status')).stdout).toContain('ставятся и обновляются сами при запуске treeyard');
    expect((await sh('skills')).stdout).toContain('ставятся и обновляются сами при запуске treeyard');
  });

  it('the setting skills off leaves them alone; on brings them back', async () => {
    const { env, dirs } = machine();
    const dir = tempDir();
    const sh = treeyardIn(dir, env);
    expect((await sh('config', 'skills', 'off')).stdout).toContain('skills = false');
    expect((await sh('init', '--template', 'directions', '--goal', 'всё работает')).code).toBe(0);
    expect((await sh('show')).stderr).not.toContain('скиллы treeyard');
    for (const skills of dirs) expect(existsSync(skills)).toBe(false);
    const status = await sh('status');
    expect(status.stdout).toContain('сами не ставятся · включить — treeyard config skills on');
    expect(status.stdout).toContain('treeyard skills install');

    expect((await sh('config', 'skills', 'on')).stdout).toContain('skills = true');
    expect((await sh('show')).stderr).toContain('скиллы treeyard');
    for (const skills of dirs) expect(readdirSync(skills).sort()).toEqual(shippedSkills());
  });

  it('outside a tree nothing is installed, except when one is being planted', async () => {
    const { env, dirs } = machine();
    const sh = treeyardIn(tempDir(), env);
    expect((await sh('projects')).stderr).not.toContain('скиллы treeyard');
    for (const skills of dirs) expect(existsSync(skills)).toBe(false);
  });

  it('a linked skill folder is left to whoever linked it; a folder it cannot write does not stop the rest', () => {
    const { home, env, dirs } = machine();
    const checkout = tempDir('treeyard-checkout-');
    writeFileSync(join(checkout, 'SKILL.md'), 'a skill being written in a checkout');
    mkdirSync(dirs[0]!, { recursive: true });
    symlinkSync(checkout, join(dirs[0]!, 'treeyard'));
    // Codex's skills folder is a file: nothing can be written there.
    writeFileSync(join(home, '.codex', 'skills'), '');

    const written = autoInstallSkills(undefined, env);
    expect(readFileSync(join(dirs[0]!, 'treeyard', 'SKILL.md'), 'utf8')).toBe('a skill being written in a checkout');
    expect(written).toEqual([
      join(dirs[0]!, 'treeyard-coordinate'),
      join(dirs[0]!, 'treeyard-init'),
      ...shippedSkills().map((skill) => join(dirs[2]!, skill)),
    ]);
  });

  it('Gemini CLI alone in ~/.gemini is not Antigravity', () => {
    const home = tempDir('treeyard-skills-home-');
    mkdirSync(join(home, '.gemini'));
    writeFileSync(join(home, '.gemini', 'settings.json'), '{}');
    expect(skillHomes({ HOME: home }).find((h) => h.brain === 'antigravity')?.present).toBe(false);
    mkdirSync(join(home, '.gemini', 'antigravity'));
    expect(skillHomes({ HOME: home }).find((h) => h.brain === 'antigravity')?.present).toBe(true);
  });
});
