/**
 * A short block in CLAUDE.md and AGENTS.md that tells any session opened in
 * the project — not only the ones started from the tree — where the tree is
 * and how to write back to it. Between markers, so it is replaced, not
 * duplicated, and easy to remove.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LANGS, type Lang, lang } from '../i18n/i18n.js';

const START = '<!-- treeyard -->';
const END = '<!-- /treeyard -->';

// Short on purpose: it is read in every session, and the rules themselves live in the `treeyard` skill.
const TEXT: Record<Lang, string> = {
  ru: `## Дерево задач

Проект ведётся деревом целей в \`.tree/\` (treeyard). Перед любой задачей — скилл \`treeyard\` (нет его — \`treeyard skills install\`).
- Найди узел задачи (\`treeyard show\`) и держись его; \`.tree/\` руками не правь.
- Итог — в журнал: \`treeyard log <id> "что сделано; что осталось"\`; критерий выполнен — \`treeyard set <id> status=review\`. «Готово» — только по прямой просьбе человека.
- Всплывшая идея — новый узел с коротким названием (2–6 слов): \`treeyard add "…" --parent <id> --status idea\`.
- Человеку узлы называй по названию, не по id; id — только в командах.
- Дерево длинное — \`treeyard show <id> --brief\` или \`treeyard find "…"\`, а не \`head\` и \`grep\`.`,
  en: `## Task tree

The project is run as a goal tree in \`.tree/\` (treeyard). Before any task, use the \`treeyard\` skill (not installed — \`treeyard skills install\`).
- Find the task's node (\`treeyard show\`) and stay on it; never edit \`.tree/\` by hand.
- Outcome — in the journal: \`treeyard log <id> "what is done; what is left"\`; criterion met — \`treeyard set <id> status=review\`. "Done" only when the person asks for it directly.
- A side idea is a new node with a short title (2–6 words): \`treeyard add "…" --parent <id> --status idea\`.
- To the person, name nodes by title, not by id; ids go in commands only.
- The tree is long — \`treeyard show <id> --brief\` or \`treeyard find "…"\`, not \`head\` and \`grep\`.`,
};

/** The block, in the current language unless asked for another. */
export function pointer(language: Lang = lang()): string {
  return `${START}\n${TEXT[language]}\n${END}`;
}

/** The agent instruction files the block goes into. */
export const POINTER_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'] as const;

/**
 * Which agent instruction files the project already has. A file that only
 * imports another (`CLAUDE.md` with `@AGENTS.md`) gets the block through it:
 * a second copy would only cost context.
 */
export function pointerTargets(dir: string): string[] {
  return POINTER_FILES.filter((file) => {
    const path = join(dir, file);
    return existsSync(path) && !onlyImports(readFileSync(path, 'utf8'));
  });
}

/** `@AGENTS.md` lines: the files this one pulls in. */
function importsOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => /^@(\S+\.md)$/.exec(line.trim())?.[1])
    .filter((file): file is string => Boolean(file));
}

function onlyImports(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.length === importsOf(text).length;
}

/** The block as it stands in a file, markers included; undefined when there is none. */
function blockIn(text: string): string | undefined {
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  return start >= 0 && end > start ? text.slice(start, end + END.length) : undefined;
}

/**
 * `ok` — the block as this version writes it (in either language); `outdated` — an older block;
 * `via` — no block of its own, but it pulls in a file that has one (or, made of imports only,
 * gets it through them); `no-block` — none; `absent` — no such file.
 */
export type PointerState = 'ok' | 'outdated' | 'via' | 'no-block' | 'absent';

export interface PointerStatus {
  file: string;
  state: PointerState;
  /** For `via`: the files it pulls in. */
  via?: string[];
}

/** Where the block about the tree stands in the agent files of `dir`. */
export function pointerStates(dir: string): PointerStatus[] {
  const read = (file: string) => {
    try {
      return readFileSync(join(dir, file), 'utf8');
    } catch {
      return undefined;
    }
  };
  return POINTER_FILES.map((file): PointerStatus => {
    const text = read(file);
    if (text === undefined) return { file, state: 'absent' };
    const block = blockIn(text);
    if (block !== undefined)
      return { file, state: LANGS.some((language) => block === pointer(language)) ? 'ok' : 'outdated' };
    const imports = importsOf(text);
    // A file of imports only is skipped by `treeyard pointer`: the files it imports carry the block.
    if (onlyImports(text)) return { file, state: 'via', via: imports };
    const carriers = imports.filter((other) => {
      const there = read(other);
      return there !== undefined && blockIn(there) !== undefined;
    });
    return carriers.length ? { file, state: 'via', via: carriers } : { file, state: 'no-block' };
  });
}

/**
 * What the TUI nags about: `missing` — an agent file has no block, or there is no agent file at
 * all, so sessions opened outside the tree never hear of it; `outdated` — the block is an older
 * one. `via` and `ok` are fine. `files` are the ones `plantPointer` would write. Undefined when
 * there is nothing to say.
 */
export function pointerGap(dir: string): { kind: 'missing' | 'outdated'; files: string[] } | undefined {
  const states = pointerStates(dir);
  const of = (state: PointerState) => states.filter((p) => p.state === state).map((p) => p.file);
  if (states.every((p) => p.state === 'absent')) return { kind: 'missing', files: ['AGENTS.md'] };
  if (of('no-block').length) return { kind: 'missing', files: of('no-block') };
  if (of('outdated').length) return { kind: 'outdated', files: of('outdated') };
  return undefined;
}

/**
 * Puts the block into the project's agent files; with none at all, starts AGENTS.md — the file
 * every CLI reads. Returns the files it wrote.
 */
export function plantPointer(dir: string): string[] {
  let targets = pointerTargets(dir);
  if (targets.length === 0 && pointerStates(dir).every((p) => p.state === 'absent')) targets = ['AGENTS.md'];
  for (const file of targets) addPointer(join(dir, file));
  return targets;
}

export function addPointer(path: string): void {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  let next: string;
  if (start >= 0 && end > start) next = text.slice(0, start) + pointer() + text.slice(end + END.length);
  else next = `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${pointer()}\n`;
  writeFileSync(path, next);
}

export function removePointer(path: string): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return false;
  writeFileSync(
    path,
    `${text.slice(0, start).trimEnd()}\n${text.slice(end + END.length).replace(/^\n+/, '\n')}`.trimEnd() + '\n',
  );
  return true;
}
