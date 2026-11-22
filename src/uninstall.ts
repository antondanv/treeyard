/**
 * `treeyard uninstall`: takes back what treeyard put outside `.tree/` — its skills in the
 * CLIs' personal folders and in the project, the post-commit hook, the merge driver of the
 * overview in the repository's config, and, when asked, its own
 * settings in `~/.treeyard`. The tree itself, and the pointer block in AGENTS.md / CLAUDE.md
 * that belongs to it, stay: they are the project's, in its git.
 */
import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_SKILLS, shippedSkills, skillHomes, skillsRoot } from './agents/skills.js';
import { hookInstalled, hookPlace, removeHook } from './commit-hook.js';
import { crashFolder } from './crash.js';
import { t } from './i18n/i18n.js';
import { driverCommand, gitConfigFile, removeMergeDriver } from './merge-driver.js';
import type { BrainId } from './model/types.js';
import { projectsPath, seenProjects } from './projects.js';
import { homeFolder, settingsPath } from './settings.js';

export type Leftover =
  /** A skill folder (or a link to one): `brain` — in that CLI's personal folder; none — in the project. */
  | { kind: 'skill'; path: string; skill: string; brain?: BrainId; link: boolean }
  /** treeyard's block in a post-commit hook; `manual` — hooks live in the repository, the person takes it out. */
  | { kind: 'hook'; path: string; manual: boolean; folder: string }
  /** The overview's merge driver in a repository's config (`.tree/.gitattributes` stays with the tree). */
  | { kind: 'merge'; path: string; folder: string }
  /** settings.json or projects.json in treeyard's home folder. */
  | { kind: 'settings'; path: string }
  /** The crash logs folder in treeyard's home folder. */
  | { kind: 'crashes'; path: string };

export interface UninstallOptions {
  /** The folder the command runs in: its project's skill copies and its repository's hook. */
  folder: string;
  /** Also treeyard's own settings and its list of seen projects. */
  settings?: boolean;
  env?: NodeJS.ProcessEnv;
  root?: string;
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** A skill folder treeyard would have put there: its SKILL.md, or a link by that name (a checkout's, maybe broken). */
function skillThere(path: string): boolean {
  return isLink(path) || existsSync(join(path, 'SKILL.md'));
}

/**
 * What `treeyard uninstall` would take away, removing nothing. Hooks are looked for in the
 * folder's repository and in every project treeyard has seen: a hook lives in `.git`, it is
 * treeyard's, not the project's. Skill copies a project keeps (`.claude/skills`,
 * `.agents/skills`) are its files in git, so only the current project's are taken.
 */
export function leftovers(options: UninstallOptions): Leftover[] {
  const env = options.env ?? process.env;
  const root = options.root ?? skillsRoot();
  const skills = shippedSkills(root);
  const out: Leftover[] = [];
  const seen = new Set<string>();
  const skill = (path: string, name: string, brain?: BrainId) => {
    if (seen.has(path) || !skillThere(path)) return;
    seen.add(path);
    out.push({ kind: 'skill', path, skill: name, ...(brain ? { brain } : {}), link: isLink(path) });
  };
  // Every CLI's folder, set up or not: a CLI removed since then may have left its home behind.
  for (const home of skillHomes(env)) for (const name of skills) skill(join(home.dir, name), name, home.brain);
  for (const dir of new Set(Object.values(PROJECT_SKILLS)))
    for (const name of skills) skill(join(options.folder, dir, name), name);

  const folders = [options.folder, ...seenProjects(env).map((project) => project.path)];
  for (const folder of folders) {
    const place = hookPlace(folder);
    if (!place || seen.has(place.file) || !hookInstalled(folder)) continue;
    seen.add(place.file);
    out.push({ kind: 'hook', path: place.file, manual: place.tracked, folder });
  }
  for (const folder of folders) {
    const file = driverCommand(folder) === undefined ? undefined : gitConfigFile(folder);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    out.push({ kind: 'merge', path: file, folder });
  }

  if (options.settings) {
    for (const path of [settingsPath(env), projectsPath(env)])
      if (existsSync(path)) out.push({ kind: 'settings', path });
    const crashes = crashFolder(env);
    if (existsSync(crashes)) out.push({ kind: 'crashes', path: crashes });
  }
  return out;
}

export interface Removed {
  item: Leftover;
  /** `removed`; `manual` — left for the person (a hook in the repository); `failed` — could not be removed. */
  result: 'removed' | 'manual' | 'failed';
  error?: string;
}

/** Takes away what `leftovers` found. Goes on past an item it cannot remove and says which. */
export function uninstall(options: UninstallOptions): Removed[] {
  const env = options.env ?? process.env;
  // Read before the settings go: the list of seen projects says where hooks are.
  const items = leftovers(options);
  const done: Removed[] = [];
  for (const item of items) {
    if (item.kind === 'hook' && item.manual) {
      done.push({ item, result: 'manual' });
      continue;
    }
    try {
      if (item.kind === 'hook') {
        // Only treeyard's block, and the file when nothing of the person's is left.
        removeHook(item.folder);
      } else if (item.kind === 'merge') {
        if (!removeMergeDriver(item.folder)) throw new Error(t('git config не убрал драйвер'));
      } else {
        // A link goes, not what it points at.
        rmSync(item.path, { recursive: !isLink(item.path), force: true });
      }
      done.push({ item, result: 'removed' });
    } catch (error) {
      done.push({ item, result: 'failed', error: (error as Error).message });
    }
  }
  if (options.settings) {
    // The home folder itself, when nothing else is in it.
    const home = homeFolder(env);
    try {
      if (readdirSync(home).length === 0) rmdirSync(home);
    } catch {
      // Not there, or something else lives in it: it stays.
    }
  }
  return done;
}
