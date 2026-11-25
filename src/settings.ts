/**
 * Settings that follow the person from project to project, in
 * `~/.treeyard/settings.json` (or `$TREEYARD_HOME/settings.json`). What
 * belongs to one project — default brain, model, how sessions start — lives
 * in its `.tree/tree.md` instead, next to the tree.
 *
 * `TREEYARD_LANG=ru` overrides the language for one run, `TREEYARD_SKILLS=off`
 * the setting `skills` (see `skillsAuto`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { LANGS, type Lang, setLang } from './i18n/i18n.js';
import {
  isStatusOrder,
  STATUS_ORDER_NAMES,
  STATUS_ORDERS,
  type StatusOrderName,
  setStatusOrder,
} from './model/tree.js';
import type { Status } from './model/types.js';
import { applyTheme, THEMES, type Theme } from './tui/theme.js';

export interface Settings {
  lang: Lang;
  /** Ask before a session or an agent's job starts. */
  confirm: boolean;
  theme: Theme;
  /** Spinners and the breathing leaf. */
  animation: boolean;
  /** The selected node's title runs when it does not fit. */
  marquee: boolean;
  /** Siblings by status: a ready-made order or `custom`. */
  statusOrder: StatusOrderName;
  /** Your own order of statuses, top to bottom: used when `statusOrder` is `custom`. */
  customOrder: Status[];
  /** Ask the CLIs every few seconds which sessions are running. */
  live: boolean;
  /** Where sessions open: in a pane next to the tree (tmux) or in this terminal. */
  open: OpenIn;
  /** A pane quiet this many minutes is put to sleep; 0 — never. */
  sleepAfter: number;
  /** At most this many live panes per project; the quietest sleeps first. 0 — no limit. */
  maxPanes: number;
  /** An «in progress» node with no live session and quiet this many hours is marked; 0 — never. */
  staleAfter: number;
  /** The folder whose tree takes `treeyard note` from every project; empty — not set. */
  notes: string;
  /** Antigravity with full access or in its own mode; empty — not chosen yet, asked before the first launch. */
  antigravityAccess: Access | '';
  /** Codex in a sandbox that lets it use treeyard and git, or as its config.toml says; empty — not chosen yet, asked before the first launch. */
  codexAccess: CodexAccess | '';
  /** treeyard puts its skills into the CLIs by itself and keeps them at its version. */
  skills: boolean;
  /** Whose memory of the last launches the menu and `treeyard open` use: each project's own or one for all. */
  launchMemory: MemoryScope;
}

/** Whose memory it is: each project's own or one for all of them. */
export type MemoryScope = 'project' | 'global';
export const MEMORY_SCOPES: readonly MemoryScope[] = ['project', 'global'];

export type OpenIn = 'pane' | 'terminal';
/** `full` — no confirmations at all; `normal` — the CLI's own mode, which asks. */
export type Access = 'full' | 'normal';
/** `sandbox` — workspace-write with the network and the project's .git open; `config` — whatever `~/.codex/config.toml` says. */
export type CodexAccess = 'sandbox' | 'config';
export const SLEEP_AFTER = [0, 15, 30, 60] as const;
export const MAX_PANES = [0, 3, 5, 8] as const;
export const STALE_AFTER = [0, 1, 2, 4, 8, 24] as const;

export const DEFAULTS: Settings = {
  lang: 'en',
  confirm: true,
  theme: 'dark',
  animation: true,
  marquee: true,
  statusOrder: 'active-first',
  customOrder: [...STATUS_ORDERS['active-first']],
  live: true,
  open: 'pane',
  sleepAfter: 30,
  maxPanes: 5,
  staleAfter: 2,
  notes: '',
  antigravityAccess: '',
  codexAccess: '',
  skills: true,
  launchMemory: 'project',
};

/** `~/.treeyard`, or `$TREEYARD_HOME`: what follows the person from project to project. */
export function homeFolder(env: NodeJS.ProcessEnv = process.env): string {
  return env.TREEYARD_HOME?.trim() || join(homedir(), '.treeyard');
}

export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeFolder(env), 'settings.json');
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const settings = { ...DEFAULTS };
  try {
    const data = JSON.parse(readFileSync(settingsPath(env), 'utf8')) as Partial<Settings> & {
      sleep_after?: unknown;
      max_panes?: unknown;
      stale_after?: unknown;
      status_order?: unknown;
      custom_order?: unknown;
      antigravity_access?: unknown;
      codex_access?: unknown;
      launch_memory?: unknown;
    };
    if (data.lang && (LANGS as readonly string[]).includes(data.lang)) settings.lang = data.lang;
    if (typeof data.confirm === 'boolean') settings.confirm = data.confirm;
    if (data.theme && (THEMES as readonly string[]).includes(data.theme)) settings.theme = data.theme;
    if (typeof data.animation === 'boolean') settings.animation = data.animation;
    if (typeof data.marquee === 'boolean') settings.marquee = data.marquee;
    if (typeof data.live === 'boolean') settings.live = data.live;
    if (data.open === 'pane' || data.open === 'terminal') settings.open = data.open;
    const sleepAfter = data.sleep_after ?? data.sleepAfter;
    const maxPanes = data.max_panes ?? data.maxPanes;
    if ((SLEEP_AFTER as readonly unknown[]).includes(sleepAfter)) settings.sleepAfter = sleepAfter as number;
    if ((MAX_PANES as readonly unknown[]).includes(maxPanes)) settings.maxPanes = maxPanes as number;
    const staleAfter = data.stale_after ?? data.staleAfter;
    if (typeof staleAfter === 'number' && Number.isInteger(staleAfter) && staleAfter >= 0)
      settings.staleAfter = staleAfter;
    const statusOrder = data.status_order ?? data.statusOrder;
    const customOrder = data.custom_order ?? data.customOrder;
    if ((STATUS_ORDER_NAMES as readonly unknown[]).includes(statusOrder))
      settings.statusOrder = statusOrder as StatusOrderName;
    if (isStatusOrder(customOrder)) settings.customOrder = customOrder;
    if (typeof data.notes === 'string') settings.notes = data.notes.trim();
    const access = data.antigravity_access ?? data.antigravityAccess;
    if (access === 'full' || access === 'normal') settings.antigravityAccess = access;
    const codex = data.codex_access ?? data.codexAccess;
    if (codex === 'sandbox' || codex === 'config') settings.codexAccess = codex;
    if (typeof data.skills === 'boolean') settings.skills = data.skills;
    const memory = data.launch_memory ?? data.launchMemory;
    if ((MEMORY_SCOPES as readonly unknown[]).includes(memory)) settings.launchMemory = memory as MemoryScope;
  } catch {
    // No file yet: the defaults.
  }
  const forced = env.TREEYARD_LANG?.trim().toLowerCase();
  if (forced && (LANGS as readonly string[]).includes(forced)) settings.lang = forced as Lang;
  return settings;
}

export function saveSettings(settings: Settings, env: NodeJS.ProcessEnv = process.env): void {
  const path = settingsPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const {
    sleepAfter,
    maxPanes,
    staleAfter,
    statusOrder,
    customOrder,
    antigravityAccess,
    codexAccess,
    launchMemory,
    ...rest
  } = settings;
  const data = {
    ...rest,
    status_order: statusOrder,
    custom_order: customOrder,
    sleep_after: sleepAfter,
    max_panes: maxPanes,
    stale_after: staleAfter,
    launch_memory: launchMemory,
    // Not chosen stays out of the file: the next launch asks.
    ...(antigravityAccess ? { antigravity_access: antigravityAccess } : {}),
    ...(codexAccess ? { codex_access: codexAccess } : {}),
  };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Whether treeyard installs its skills by itself in this run: the setting, unless `TREEYARD_SKILLS` says otherwise. */
export function skillsAuto(env: NodeJS.ProcessEnv = process.env): boolean {
  // Read here, not in loadSettings: a one-run override must not end up in settings.json.
  const forced = env.TREEYARD_SKILLS?.trim().toLowerCase();
  if (forced === 'off' || forced === '0' || forced === 'false') return false;
  if (forced === 'on' || forced === '1' || forced === 'true') return true;
  return settings().skills;
}

/** Makes the settings take effect in this process. */
export function applySettings(settings: Settings): void {
  setLang(settings.lang);
  applyTheme(settings.theme);
  setStatusOrder(orderOf(settings));
}

/** The statuses top to bottom that these settings ask for. */
export function orderOf(settings: Pick<Settings, 'statusOrder' | 'customOrder'>): readonly Status[] {
  return settings.statusOrder === 'custom' ? settings.customOrder : STATUS_ORDERS[settings.statusOrder];
}

let loaded: Settings | undefined;

/** The settings of this run, loaded and applied once. */
export function settings(): Settings {
  if (!loaded) {
    loaded = loadSettings();
    applySettings(loaded);
  }
  return loaded;
}

/** Changes a setting, saves it and applies it at once. */
export function updateSettings(patch: Partial<Settings>): Settings {
  loaded = { ...settings(), ...patch };
  saveSettings(loaded);
  applySettings(loaded);
  return loaded;
}

/** For tests: forget what was loaded. */
export function resetSettings(next?: Settings): void {
  loaded = next;
  if (next) applySettings(next);
}
