/**
 * Point edits of `tree.md`: the goal in its front matter, the rules and the decisions in its body. Each edit
 * rewrites only its own piece of the text, so the rest — other keys with their quotes, order
 * and comments, the sessions, «Решения» — stays byte for byte, however it was written.
 * `writeProject` would serialize the whole header again; these edits never do.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';

import { pick } from '../i18n/i18n.js';
import { atomicWrite, TREE_DIR } from './store.js';

/** The heading of the decisions section, in either language. */
export const DECISIONS = /^##\s+(?:Решения|Decisions)\s*$/m;

/** The same fence `parseDocument` reads: `---`, the YAML, `---`. */
const FENCE = /^(﻿?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/;

/** Same options as `stringifyDocument`: the goal looks as if treeyard had written the whole file. */
const YAML_OPTIONS = { lineWidth: 0, defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' } as const;

function treeFile(dir: string): string {
  return join(dir, TREE_DIR, 'tree.md');
}

/** The goal is one line in the header: line breaks and runs of spaces become one space. */
export function cleanGoal(goal: string): string {
  return goal.replace(/\s+/g, ' ').trim();
}

/** `tree.md` with `goal:` set to `goal`; every other line of the file stays as it was. */
export function withGoal(text: string, goal: string): string {
  const line = stringify({ goal }, YAML_OPTIONS).trimEnd();
  const fence = FENCE.exec(text);
  if (!fence) return `---\n${line}\n---\n${text.startsWith('\n') ? '' : '\n'}${text}`;
  const [whole, open = '', yaml = '', close = ''] = fence;
  const eol = yaml.includes('\r\n') ? '\r\n' : '\n';
  const lines = yaml.split(/\r?\n/);
  const before = parse(yaml) as unknown;
  const range = keyRange(lines, 'goal');
  if (range) lines.splice(range[0], range[1] - range[0], line);
  else {
    // A new goal goes under the title, where treeyard itself writes it.
    const title = keyRange(lines, 'title');
    lines.splice(title ? title[1] : 0, 0, line);
  }
  const next = lines.join(eol);
  // The edit is by lines, so prove it: the goal is the new one and nothing else moved.
  const after = parse(next) as unknown;
  const rest = (data: unknown) => {
    const copy = { ...(data && typeof data === 'object' ? data : {}) } as Record<string, unknown>;
    delete copy.goal;
    return copy;
  };
  if ((after as Record<string, unknown> | null)?.goal !== goal || !isDeepStrictEqual(rest(before), rest(after)))
    throw new Error('tree.md: the goal could not be changed without touching the rest of the header');
  return `${open}${next}${close}${text.slice(whole.length)}`;
}

/**
 * The lines of a top-level key: its own line and what continues it — indented lines and the
 * blank ones between them (a block scalar, a list). Trailing blank lines stay outside.
 */
function keyRange(lines: string[], key: string): [number, number] | undefined {
  const start = lines.findIndex((line) => new RegExp(`^${key}[ \\t]*:`).test(line));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && (/^[ \t]/.test(lines[end]!) || !lines[end]!.trim())) end += 1;
  while (end > start + 1 && !lines[end - 1]!.trim()) end -= 1;
  return [start, end];
}

/** Where «Решения» stands in the body: from its heading to the next heading or the end. */
function decisionsRange(body: string): [number, number] | undefined {
  const match = DECISIONS.exec(body);
  if (!match) return undefined;
  const from = match.index + match[0].length;
  const next = body.slice(from).search(/^##\s/m);
  return [match.index, next < 0 ? body.length : from + next];
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * A body with decisions added at the end of «Решения»: only their lines go in, everything
 * around stays as written, line ends too. Without the section, it ends the text.
 */
export function addDecisions(body: string, decisions: readonly string[], eol = eolOf(body)): string {
  const lines = decisions.map((line) => `- ${line}`).join(eol);
  const range = decisionsRange(body);
  if (!range) {
    const kept = body.trimEnd();
    const heading = pick({ ru: '## Решения', en: '## Decisions' });
    return `${kept}${kept ? eol + eol : ''}${heading}${eol}${eol}${lines}${eol}`;
  }
  // Right after the last written line of the section; its trailing blank lines stay after.
  const at = range[0] + body.slice(...range).trimEnd().length;
  // A list goes on as a list (an item may continue on indented lines); after a paragraph or
  // the heading itself, a blank line first.
  const written = body.slice(range[0], at).split(/\r?\n/);
  let last = written.length - 1;
  while (last > 0 && /^[ \t]+\S/.test(written[last]!)) last -= 1;
  const gap = written[last]!.startsWith('- ') ? eol : eol + eol;
  const tail = body.slice(at);
  return `${body.slice(0, at)}${gap}${lines}${tail || eol}`;
}

/** The lines of «Решения» (or «Decisions»), as written. */
export function decisionsOf(body: string): string[] {
  const range = decisionsRange(body);
  if (!range) return [];
  return body
    .slice(...range)
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('- '));
}

/** A decision as a program reads it: the line as written without its «- », and its date. */
export interface Decision {
  text: string;
  /** `YYYY-MM-DD` from the line — the last one, as `decide` puts it at the end; null without one. */
  date: string | null;
}

/** «Решения» as data, so a program never parses the section itself. */
export function decisionList(body: string): Decision[] {
  return decisionsOf(body).map((line) => {
    const text = line.trim().slice(2).trim();
    const dates = text.match(/\b\d{4}-\d\d-\d\d\b/g);
    return { text, date: dates?.at(-1) ?? null };
  });
}

/** The rules: the body of `tree.md` without «Решения» — the method, how the tree is kept, rules for agents. */
export function rulesOf(body: string): string {
  const range = decisionsRange(body);
  if (!range) return body.trim();
  const before = body.slice(0, range[0]).trim();
  const after = body.slice(range[1]).trim();
  return [before, after].filter(Boolean).join('\n\n');
}

/** Whether a text carries its own «Решения» heading: those lines belong to `treeyard decide`. */
export function hasDecisions(text: string): boolean {
  return DECISIONS.test(text);
}

/**
 * `tree.md` with new rules: the header and «Решения» are kept as they are; «Решения» ends the
 * file, as in every template (a section that stood after it was part of the rules).
 */
export function withRules(text: string, rules: string): string {
  const fence = FENCE.exec(text);
  const head = fence ? fence[0] : '';
  const body = text.slice(head.length);
  // The blank line after the header, as the file had it.
  const gap = fence ? /^(?:[ \t]*\r?\n)*/.exec(body)?.[0] || '\n' : '';
  const range = decisionsRange(body);
  const decisions = range ? `\n\n${body.slice(...range).trimEnd()}` : '';
  return `${head}${gap}${rules.trim()}${decisions}\n`;
}

/** `tree.md` with decisions added to «Решения»; the header is not even parsed, so it stays byte for byte. */
export function withDecisions(text: string, decisions: readonly string[]): string {
  const fence = FENCE.exec(text);
  if (!fence) return addDecisions(text, decisions);
  const head = fence[0];
  const body = text.slice(head.length);
  const eol = eolOf(text);
  // A header that ends the file without its line end gets one, and the blank line treeyard puts after it.
  if (!body.trim()) return `${head}${/\n$/.test(head) ? '' : eol}${eol}${addDecisions('', decisions, eol)}`;
  return `${head}${addDecisions(body, decisions, eol)}`;
}

export function readTreeText(dir: string): string {
  return readFileSync(treeFile(dir), 'utf8');
}

/** Writes the goal into `tree.md`; false when it already was this one, and nothing was written. */
export function writeGoal(dir: string, goal: string): boolean {
  const text = readTreeText(dir);
  const next = withGoal(text, goal);
  if (next === text) return false;
  atomicWrite(treeFile(dir), next);
  return true;
}

/** Adds decisions to «Решения» of `tree.md`: the file gains their lines and nothing else changes. */
export function writeDecisions(dir: string, decisions: readonly string[]): void {
  atomicWrite(treeFile(dir), withDecisions(readTreeText(dir), decisions));
}

/** Writes the rules into `tree.md`; false when they already were these, and nothing was written. */
export function writeRules(dir: string, rules: string): boolean {
  const text = readTreeText(dir);
  const next = withRules(text, rules);
  if (next === text) return false;
  atomicWrite(treeFile(dir), next);
  return true;
}
