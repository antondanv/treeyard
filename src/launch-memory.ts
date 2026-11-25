/**
 * The last launch of each CLI: how it started (where, how, model, effort,
 * worktree). The node menu puts the CLI you ran last on top with exactly these
 * settings, and `treeyard open` without flags starts the same way.
 *
 * By default the memory is the project's own, in `.tree/.local/` (per machine,
 * out of git); the setting `launchMemory` can make it one for all projects, in
 * `~/.treeyard/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LaunchOptions } from './agents/launch.js';
import { BRAIN_IDS, type BrainId, START_MODES, type StartMode } from './model/types.js';
import { homeFolder, type MemoryScope, settings } from './settings.js';
import type { WorktreeWish } from './worktree.js';

export type LaunchWhere = 'pane' | 'terminal' | 'background';
export interface SavedLaunch {
  brain: BrainId;
  start: StartMode;
  where: LaunchWhere;
  model?: string;
  effort?: string;
  worktree?: WorktreeWish;
  /** ISO time of the launch: the newest is the last one. */
  at: string;
}

export type LaunchMemory = Partial<Record<BrainId, SavedLaunch>>;

const FILE = 'last-launch.json';

export function memoryPath(
  dir: string,
  scope: MemoryScope = settings().launchMemory,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return scope === 'global' ? join(homeFolder(env), FILE) : join(dir, '.tree', '.local', FILE);
}

/** How a launch was made, as the memory keeps it. */
export function whereOf(options: Pick<LaunchOptions, 'background' | 'pane'>): LaunchWhere {
  return options.background ? 'background' : options.pane ? 'pane' : 'terminal';
}

/** Only Claude Code starts in the background and with `/goal`; others fall back to the plain start. */
function fitLaunch(brain: BrainId, start: StartMode, where: LaunchWhere): { start: StartMode; where: LaunchWhere } {
  let mode = start;
  let place = where;
  if (brain !== 'claude' && mode === 'goal') mode = 'do';
  if (brain !== 'claude' && place === 'background') place = 'terminal';
  if (place === 'background' && mode === 'chat') mode = 'do';
  return { start: mode, where: place };
}

function parse(raw: unknown): LaunchMemory {
  const memory: LaunchMemory = {};
  if (!raw || typeof raw !== 'object') return memory;
  for (const brain of BRAIN_IDS) {
    const item = (raw as Record<string, unknown>)[brain] as Partial<SavedLaunch> | undefined;
    if (!item || typeof item !== 'object') continue;
    if (!(START_MODES as readonly unknown[]).includes(item.start)) continue;
    if (item.where !== 'pane' && item.where !== 'terminal' && item.where !== 'background') continue;
    const saved: SavedLaunch = {
      brain,
      ...fitLaunch(brain, item.start as StartMode, item.where),
      at: typeof item.at === 'string' ? item.at : '',
    };
    if (typeof item.model === 'string' && item.model) saved.model = item.model;
    if (typeof item.effort === 'string' && item.effort) saved.effort = item.effort;
    if (typeof item.worktree === 'boolean' || item.worktree === 'auto') saved.worktree = item.worktree;
    memory[brain] = saved;
  }
  return memory;
}

export function loadLaunchMemory(
  dir: string,
  scope: MemoryScope = settings().launchMemory,
  env: NodeJS.ProcessEnv = process.env,
): LaunchMemory {
  try {
    return parse(JSON.parse(readFileSync(memoryPath(dir, scope, env), 'utf8')));
  } catch {
    return {};
  }
}

/**
 * Remembers a launch as the last one of its CLI. A coordinator's assignment (`--task`) is not
 * remembered: it must not decide how the next launch starts. A courtesy, not a duty: a failure
 * to write is silent.
 */
export function rememberLaunch(
  dir: string,
  options: LaunchOptions,
  scope: MemoryScope = settings().launchMemory,
  at: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (options.task) return;
  try {
    const memory = loadLaunchMemory(dir, scope, env);
    const saved: SavedLaunch = {
      brain: options.brain,
      start: options.start,
      where: whereOf(options),
      at: at.toISOString(),
    };
    if (options.model) saved.model = options.model;
    if (options.effort) saved.effort = options.effort;
    if (options.worktree !== undefined) saved.worktree = options.worktree;
    memory[options.brain] = saved;
    const path = memoryPath(dir, scope, env);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(memory, null, 2)}\n`);
  } catch {
    // Remembering the launch must never stop one.
  }
}

/** The launch that was made last, whichever CLI it was. */
export function lastLaunch(memory: LaunchMemory): SavedLaunch | undefined {
  return Object.values(memory).sort((a, b) => b.at.localeCompare(a.at))[0];
}

/**
 * The CLIs top to bottom: the one launched last, then the others by how recently they ran,
 * then those never launched — the project's own first, the rest in the usual order.
 */
export function brainOrder(memory: LaunchMemory, preferred?: BrainId): BrainId[] {
  const launched = BRAIN_IDS.filter((brain) => memory[brain]).sort(
    (a, b) => memory[b]!.at.localeCompare(memory[a]!.at) || BRAIN_IDS.indexOf(a) - BRAIN_IDS.indexOf(b),
  );
  const rest = BRAIN_IDS.filter((brain) => !memory[brain]).sort(
    (a, b) => Number(b === preferred) - Number(a === preferred),
  );
  return [...launched, ...rest];
}

/** A saved launch as options. A pane without tmux becomes this terminal. */
export function launchOptions(saved: SavedLaunch, panes: boolean): LaunchOptions {
  const options: LaunchOptions = {
    brain: saved.brain,
    start: saved.start,
    background: saved.where === 'background',
    pane: saved.where === 'pane' && panes,
  };
  if (saved.model) options.model = saved.model;
  if (saved.effort) options.effort = saved.effort;
  if (saved.worktree !== undefined) options.worktree = saved.worktree;
  return options;
}

/** What `treeyard open` was told, already parsed. */
export interface OpenFlags {
  brain?: BrainId;
  start?: StartMode;
  background?: boolean;
  pane?: boolean;
  model?: string;
  effort?: string;
  /** `--worktree` (true), `--no-worktree` (false), not said (undefined). */
  worktree?: boolean;
}

/**
 * How `treeyard open` starts a session: every flag said out loud first; what is left — as the
 * last launch did (or, with `--brain`, as that CLI's last launch did); with no memory — by the
 * project's defaults, in this terminal.
 */
export function openOptions(
  flags: OpenFlags,
  memory: LaunchMemory,
  fallback: { brain: BrainId; start: StartMode },
  panes: boolean,
): LaunchOptions {
  const brain = flags.brain ?? lastLaunch(memory)?.brain ?? fallback.brain;
  const saved = memory[brain];
  const where = flags.pane || flags.background ? undefined : saved?.where;
  const background = Boolean(flags.background) || where === 'background';
  const pane = Boolean(flags.pane) || (where === 'pane' && panes);
  // A new model has its own efforts: the remembered one belongs to the remembered model.
  const model = flags.model ?? saved?.model;
  const effort = flags.effort ?? (!flags.model || flags.model === saved?.model ? saved?.effort : undefined);
  const worktree = flags.worktree ?? saved?.worktree;
  let start = flags.start ?? saved?.start ?? fallback.start;
  // A talk cannot run in the background: the remembered start gives way.
  if (!flags.start && background && start === 'chat') start = 'do';
  return {
    brain,
    start,
    ...(background ? { background: true } : {}),
    ...(pane ? { pane: true } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(worktree !== undefined ? { worktree } : {}),
  };
}
