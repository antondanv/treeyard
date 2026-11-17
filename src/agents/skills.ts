/**
 * The skills that ship with treeyard — `treeyard` (working with a tree),
 * `treeyard-init` (planting one) and `treeyard-coordinate` (handing nodes out to
 * sessions) — and where each CLI finds them: a personal
 * folder in the CLI's home, or a folder inside the project.
 *
 * A skill is a folder (SKILL.md and its references/), so it is compared and
 * installed as a whole: an installed copy that differs in any file is
 * outdated, and installing replaces the folder.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { BrainId } from '../model/types.js';

/** The `skills/` folder of the package. */
export function skillsRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
}

/** The skills treeyard ships, by folder name: `treeyard`, `treeyard-coordinate`, `treeyard-init`. */
export function shippedSkills(root = skillsRoot()): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

export interface SkillHome {
  brain: BrainId;
  /** Where the CLI looks for skills: `<dir>/<name>/SKILL.md`. */
  dir: string;
  /** The CLI is set up on this machine (its home exists). */
  present: boolean;
}

/** Where each CLI reads personal skills from. */
export function skillHomes(env: NodeJS.ProcessEnv = process.env): SkillHome[] {
  const home = env.HOME?.trim() || homedir();
  const claude = env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');
  const codex = env.CODEX_HOME?.trim() || join(home, '.codex');
  // Antigravity: the global customization root is ~/.gemini/config.
  const agy = join(home, '.gemini', 'config');
  return [
    { brain: 'claude', dir: join(claude, 'skills'), present: existsSync(claude) },
    { brain: 'codex', dir: join(codex, 'skills'), present: existsSync(codex) },
    { brain: 'antigravity', dir: join(agy, 'skills'), present: existsSync(join(home, '.gemini')) },
  ];
}

/** Where each CLI reads a project's own skills from, relative to the project (Codex and Antigravity share one). */
export const PROJECT_SKILLS: Readonly<Record<string, string>> = {
  claude: join('.claude', 'skills'),
  codex: join('.agents', 'skills'),
  antigravity: join('.agents', 'skills'),
};

/** Files of a folder by relative path, dotfiles (.DS_Store) aside; empty when it is not there. */
function filesOf(dir: string, prefix = ''): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(dir, prefix));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const rel = prefix ? join(prefix, name) : name;
    let folder: boolean;
    try {
      // statSync follows links: a skill folder linked to a checkout is read through.
      folder = statSync(join(dir, rel)).isDirectory();
    } catch {
      // A broken link is a file that differs.
      folder = false;
    }
    if (folder) out.push(...filesOf(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

/** The installed copy has exactly the shipped files, byte for byte. */
export function sameSkill(source: string, copy: string): boolean {
  const files = filesOf(source);
  const there = filesOf(copy);
  if (files.length !== there.length || files.some((file, i) => file !== there[i])) return false;
  return files.every((file) => readFileSync(join(source, file)).equals(readFileSync(join(copy, file))));
}

export interface SkillPlace {
  path: string;
  /** `home` — the CLI's personal folder; `project` — the project's own. */
  scope: 'home' | 'project';
  current: boolean;
}

/**
 * `installed` — every copy is the shipped one; `outdated` — some copy differs (the CLI may load it);
 * `missing` — the CLI is there, the skill is not; `no-cli` — neither.
 */
export type SkillState = 'installed' | 'outdated' | 'missing' | 'no-cli';

export interface SkillStatus {
  skill: string;
  brain: BrainId;
  state: SkillState;
  /** The CLI's personal skills folder, where `treeyard skills install` puts it. */
  dir: string;
  places: SkillPlace[];
}

/** Every shipped skill in every CLI, with the copies a CLI would load in `project`. */
export function skillStates(
  project: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  root = skillsRoot(),
): SkillStatus[] {
  const out: SkillStatus[] = [];
  for (const home of skillHomes(env)) {
    for (const skill of shippedSkills(root)) {
      const source = join(root, skill);
      const places: SkillPlace[] = [];
      const candidates: [string, SkillPlace['scope']][] = [[join(home.dir, skill), 'home']];
      if (project) candidates.push([join(project, PROJECT_SKILLS[home.brain]!, skill), 'project']);
      for (const [path, scope] of candidates)
        if (existsSync(join(path, 'SKILL.md'))) places.push({ path, scope, current: sameSkill(source, path) });
      const state: SkillState = places.some((place) => !place.current)
        ? 'outdated'
        : places.length
          ? 'installed'
          : home.present
            ? 'missing'
            : 'no-cli';
      out.push({ skill, brain: home.brain, state, dir: home.dir, places });
    }
  }
  return out;
}

export interface Installed {
  path: string;
  /** `written` — put there now; `current` — already the shipped one, left alone. */
  action: 'written' | 'current';
}

function copySkill(source: string, target: string): void {
  // A whole folder: a reference the new version dropped must not linger.
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true, filter: (path) => !basename(path).startsWith('.') });
}

/**
 * Puts every shipped skill where the installed CLIs find it. Copies the
 * project already keeps for its agents (`.claude/skills`, `.agents/skills`)
 * are refreshed, never created here. Empty when no CLI is set up.
 */
export function installSkills(
  project?: string,
  env: NodeJS.ProcessEnv = process.env,
  root = skillsRoot(),
): Installed[] {
  const done: Installed[] = [];
  const put = (source: string, target: string) => {
    // An up-to-date copy is left as it is, so a folder linked to a checkout stays a link.
    if (existsSync(join(target, 'SKILL.md')) && sameSkill(source, target)) {
      done.push({ path: target, action: 'current' });
      return;
    }
    copySkill(source, target);
    done.push({ path: target, action: 'written' });
  };
  for (const home of skillHomes(env)) {
    if (!home.present) continue;
    for (const skill of shippedSkills(root)) put(join(root, skill), join(home.dir, skill));
  }
  if (project)
    for (const dir of new Set(Object.values(PROJECT_SKILLS)))
      for (const skill of shippedSkills(root)) {
        const target = join(project, dir, skill);
        if (existsSync(join(target, 'SKILL.md'))) put(join(root, skill), target);
      }
  return done;
}
