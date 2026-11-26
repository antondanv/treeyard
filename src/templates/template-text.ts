/**
 * The part of `tree.md` a template wrote rather than the person: the method's description,
 * «How we keep the tree», the line about the skill, the preface of «Decisions», and the old agents'
 * rules. A node session gets its tree's rules without them — the skill teaches the same, and
 * the method's text (the «Now» tab, a weekly look at «Waiting») is for the person — so its
 * context keeps only what the person added. Matched line by line, word for word.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { LEGACY_LINES, SKILL_LINE } from './legacy-rules.js';
import { builtinDir } from './templates.js';

const norm = (line: string) => line.trim().replace(/\s+/g, ' ');

let cached: Set<string> | undefined;

/** Every line the built-in templates put into `tree.md`, in both languages. */
function templateLines(): Set<string> {
  if (cached) return cached;
  const lines = new Set<string>(LEGACY_LINES.map(norm));
  for (const dir of [builtinDir('ru'), builtinDir('en')]) {
    for (const line of readFileSync(join(dir, '_common.md'), 'utf8').split('\n')) lines.add(norm(line));
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.yaml'))) {
      const data = parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
      // The method's own rules for agents (`rules`) are not the skill's: they stay.
      for (const field of ['method'])
        for (const line of String(data[field] ?? '').split('\n')) {
          // A line with a `{{placeholder}}` was filled with the person's answer: it is theirs now.
          if (!line.includes('{{')) lines.add(norm(line));
        }
    }
  }
  lines.delete('');
  cached = lines;
  return lines;
}

/**
 * The rules without the template's text; a heading whose section is left empty goes too, and
 * a «Method: …» heading with nothing of the person's under it.
 */
export function ownRules(rules: string): string {
  const known = templateLines();
  const kept = rules
    .split('\n')
    .filter((line) => !line.trim() || /^#/.test(line) || !(known.has(norm(line)) || SKILL_LINE.test(line)));
  // Drop a heading with nothing under it: blank lines up to the end or a heading of its level or higher.
  const level = (line: string) => /^(#{1,6}) /.exec(line)?.[1]?.length ?? 0;
  const out: string[] = [];
  for (let i = 0; i < kept.length; i++) {
    const line = kept[i]!;
    const own = level(line);
    if (own) {
      let j = i + 1;
      while (j < kept.length && !kept[j]!.trim()) j++;
      const next = j < kept.length ? level(kept[j]!) : 1;
      if (next && next <= own) continue;
    }
    out.push(line);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
