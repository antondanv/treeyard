/**
 * Planting a tree together with an agent. The agent gets the `treeyard-init`
 * skill: it studies the folder (or asks for everything the person has in
 * mind when it is empty), leads them through short questions, agrees on a
 * goal you can see in real life and plants the tree with one
 * `treeyard import --from-json -`, plus a few short project documents.
 *
 * The interactive CLI runs beside the tree when tmux is available, or in
 * this terminal until the person leaves it.
 *
 * The same skill can be installed into Claude Code, Codex and Antigravity
 * (`treeyard skills install`), so a plain `claude` in any folder knows how
 * to plant a tree too.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type OpenResult, open, panesAvailable, startPane } from '@antondanv/brainyard';

import { pick } from '../i18n/i18n.js';
import { nodeEnv } from '../model/notes.js';
import type { BrainId } from '../model/types.js';
import { settings } from '../settings.js';
import { fullAccess } from './context.js';
import type { Pane, PaneSize } from './panes.js';

export const SKILL = 'treeyard-init';

/**
 * The skill as shipped. One version, in English: skills are read by models,
 * and the agent talks to the person in their own language anyway (the first
 * message is in the language of the interface).
 */
export function skillPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', SKILL, 'SKILL.md');
}

export function skillText(): string {
  return readFileSync(skillPath(), 'utf8');
}

/** The instructions without the front matter that only skill loaders read. */
export function skillBody(): string {
  return skillText()
    .replace(/^---\n[\s\S]*?\n---\n+/, '')
    .trim();
}

export interface FolderFacts {
  name: string;
  /** Files and folders at the top, hidden ones aside. */
  entries: number;
  git: boolean;
  commits: number;
  tree: boolean;
  /** Plan-like documents an agent should read first. */
  docs: string[];
  /** Nothing to study: the interview starts from what the person has in mind. */
  empty: boolean;
}

const PLAN_LIKE = /^(readme|roadmap|plan|todo|tasks|vision|idea|scope|agents|claude|gemini|architecture|decisions)/i;
const CODE_LIKE = /^(package\.json|pyproject\.toml|go\.mod|cargo\.toml|requirements\.txt|.*\.xcodeproj|src|app|lib)$/i;

/** What the folder is, for the first message: the agent knows where to start without asking. */
export function folderFacts(dir: string): FolderFacts {
  const entries = readdirSync(dir).filter((name) => !name.startsWith('.'));
  const git = existsSync(join(dir, '.git'));
  const commits = git
    ? Number(spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()) || 0
    : 0;
  const docs = entries.filter((name) => PLAN_LIKE.test(name) && name.toLowerCase().endsWith('.md'));
  if (existsSync(join(dir, 'docs'))) docs.push('docs/');
  const code = entries.some((name) => CODE_LIKE.test(name));
  return {
    name: basename(dir),
    entries: entries.length,
    git,
    commits,
    tree: existsSync(join(dir, '.tree', 'tree.md')),
    docs,
    empty: !code && docs.length === 0 && commits < 2 && entries.length <= 3,
  };
}

/** The first message: where we are, and the first move. The skill itself goes in as instructions. */
export function plantingPrompt(facts: FolderFacts): string {
  const state = pick({
    ru: [
      `Папка «${facts.name}»: ${facts.entries} файлов и папок`,
      facts.git ? `git, коммитов: ${facts.commits}` : 'без git',
      facts.tree ? 'дерево .tree/ уже есть' : 'дерева ещё нет',
      facts.docs.length ? `документы: ${facts.docs.join(', ')}` : 'документов нет',
    ].join(' · '),
    en: [
      `Folder "${facts.name}": ${facts.entries} files and folders`,
      facts.git ? `git, ${facts.commits} commits` : 'no git',
      facts.tree ? 'a .tree/ already exists' : 'no tree yet',
      facts.docs.length ? `documents: ${facts.docs.join(', ')}` : 'no documents',
    ].join(' · '),
  });
  const move = facts.tree
    ? pick({
        ru: 'Дерево уже есть: посмотри его и проект и предложи, как дорастить. Ничего не удаляй.',
        en: 'There is a tree already: look at it and the project and propose how to grow it. Delete nothing.',
      })
    : facts.empty
      ? pick({
          ru: 'Папка почти пустая — начни с того, что попроси меня выложить всё, что я думаю о проекте.',
          en: 'The folder is nearly empty — start by asking me to tell you everything I think about the project.',
        })
      : pick({
          ru: 'Начни с разбора: изучи, что здесь есть, и дай короткий отчёт, потом задавай вопросы.',
          en: 'Start with a review: study what is here, give me a short report, then ask your questions.',
        });
  return pick({
    ru: `Давай посадим дерево этого проекта по скиллу ${SKILL}. ${state}. ${move}`,
    en: `Let's plant this project's tree with the ${SKILL} skill. ${state}. ${move}`,
  });
}

export function plantingInPane(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && settings().open === 'pane' && panesAvailable());
}

export type PlantingResult = { mode: 'pane'; pane: Pane } | { mode: 'terminal'; result: OpenResult };

/** Starts the interview without creating `.tree/` before the person agrees. */
export async function plantWithAgent(dir: string, brain: BrainId, size?: PaneSize): Promise<PlantingResult> {
  const facts = folderFacts(dir);
  const pane = plantingInPane();
  const name = pick({ ru: `${facts.name} · посадка дерева`, en: `${facts.name} · planting the tree` });
  const options = {
    brain,
    cwd: dir,
    system: `${skillBody()}\n\n## Session entry\n\nThis session was opened from treeyard ${
      pane
        ? 'in a pane beside the tree. The tree appears automatically as you plant it. At wrap-up, tell the person to press Ctrl+Q to return to the tree.'
        : 'in the terminal. At wrap-up, tell the person to exit this session — the tree will open automatically.'
    } Do not ask them to launch treeyard again.`,
    prompt: plantingPrompt(facts),
    ...(brain === 'claude' ? { name } : {}),
    ...fullAccess(brain),
    env: nodeEnv(''),
  };
  if (!pane) return { mode: 'terminal', result: await open(options) };
  const started = await startPane({ ...options, label: name, ...size });
  return {
    mode: 'pane',
    pane: {
      ...started,
      cwd: dir,
      label: name,
      attached: false,
      width: size?.width ?? 100,
      height: size?.height ?? 30,
    },
  };
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

/** Puts the skill where the installed CLIs find it; returns the files written. */
export function installSkill(env: NodeJS.ProcessEnv = process.env): string[] {
  const text = skillText();
  const written: string[] = [];
  for (const home of skillHomes(env)) {
    if (!home.present) continue;
    const target = join(home.dir, SKILL, 'SKILL.md');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(target);
  }
  return written;
}
