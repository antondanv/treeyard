/**
 * Git's merge driver for `.tree/README.md`. Nodes live one per file and merge on their own; the
 * overview is drawn from all of them and committed, so any two branches that touched the tree
 * conflicted in it. `.tree/.gitattributes` names the driver for the overview (it is committed
 * with the tree), and the repository's config says what the driver runs; treeyard puts both in
 * place itself, on the first write of the tree in a repository.
 *
 * Without treeyard on PATH, or without the config (a fresh clone, GitHub), git merges the file
 * line by line as before: never worse than without the driver.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DRIVER = 'treeyard';
const ATTRIBUTES = '.gitattributes';
const ATTRIBUTES_TEXT = `# treeyard: on a merge the overview is drawn again from both sides, not merged line by line\nREADME.md merge=${DRIVER}\n`;
/** Run by git through the shell; falls back to git's own line merge when treeyard is gone. */
export const DRIVER_COMMAND =
  'if command -v treeyard >/dev/null 2>&1; then treeyard merge-overview %O %A %B; else git merge-file %A %O %B; fi';
const DRIVER_NAME = 'treeyard: draw the tree overview again from both sides';

/** Variables git sets for its hooks; they would point git at another repository than the tree's. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };
  for (const key of Object.keys(env))
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR)$/.test(key)) delete env[key];
  return env;
}

/** `git config --local <args>`: the output, or the exit code when git says no (1 — no such key, 128 — no repository). */
function config(dir: string, args: string[]): { out?: string; code: number } {
  const result = spawnSync('git', ['config', '--local', ...args], {
    cwd: dir,
    env: cleanEnv(),
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error) return { code: -1 };
  return result.status === 0 ? { out: result.stdout.trim(), code: 0 } : { code: result.status ?? -1 };
}

/** The driver's command in the repository of `dir`; undefined when it is not set or there is no repository. */
export function driverCommand(dir: string): string | undefined {
  return config(dir, ['--get', `merge.${DRIVER}.driver`]).out;
}

const ready = new Set<string>();

/**
 * Puts `.tree/.gitattributes` and the driver's config in place when the tree is in a git
 * repository. Once per folder per process; quiet: a tree outside git, or git missing, just
 * merges as before.
 */
export function ensureMergeDriver(dir: string, treeDir: string): void {
  const key = resolve(dir);
  if (ready.has(key)) return;
  ready.add(key);
  try {
    const current = config(dir, ['--get', `merge.${DRIVER}.driver`]);
    if (current.code !== 0 && current.code !== 1) return;
    if (current.out !== DRIVER_COMMAND) {
      config(dir, [`merge.${DRIVER}.name`, DRIVER_NAME]);
      config(dir, [`merge.${DRIVER}.driver`, DRIVER_COMMAND]);
    }
    const file = join(dir, treeDir, ATTRIBUTES);
    // A file the person changed stays theirs.
    if (!existsSync(file)) writeFileSync(file, ATTRIBUTES_TEXT);
  } catch {
    // The tree is written already; without the driver git merges the overview line by line.
  }
}

/** Takes the driver's config out of the repository of `dir`; `.tree/.gitattributes` stays with the tree. */
export function removeMergeDriver(dir: string): boolean {
  return config(dir, ['--remove-section', `merge.${DRIVER}`]).code === 0;
}

/** The repository's config file, where the driver is set. */
export function gitConfigFile(dir: string): string | undefined {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: dir,
      env: cleanEnv(),
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return join(common, 'config');
  } catch {
    return undefined;
  }
}
