import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The Agent Skills format (agentskills.io/specification) and Anthropic's authoring rules:
// models pick a skill by its name and description, so a broken header means a skill that never loads.
const skills = fileURLToPath(new URL('../skills', import.meta.url));
const names = readdirSync(skills, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function read(name: string): { meta: Record<string, unknown>; body: string } {
  const text = readFileSync(join(skills, name, 'SKILL.md'), 'utf8');
  const [, head, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) ?? [];
  if (head === undefined || body === undefined) throw new Error(`${name}/SKILL.md has no front matter`);
  return { meta: parse(head) as Record<string, unknown>, body };
}

/** Relative links to files of the skill: `[text](references/x.md)`. */
function links(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)#\s]+)\)/g)]
    .map((m) => m[1] ?? '')
    .filter((href) => href && !/^[a-z]+:/i.test(href));
}

describe('skills', () => {
  it('are there', () => {
    expect(names).toContain('treeyard');
    expect(names).toContain('treeyard-init');
  });

  for (const name of names) {
    describe(name, () => {
      it('has a valid name: the folder name, lowercase and hyphens, no reserved words', () => {
        const { meta } = read(name);
        expect(meta.name).toBe(name);
        expect(name.length).toBeLessThanOrEqual(64);
        expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(name).not.toMatch(/anthropic|claude/);
      });

      it('has a description up to 1024 characters, without XML tags', () => {
        const { meta } = read(name);
        expect(typeof meta.description).toBe('string');
        const description = meta.description as string;
        expect(description.length).toBeGreaterThan(0);
        expect(description.length).toBeLessThanOrEqual(1024);
        expect(description).not.toMatch(/<[a-z/][^>]*>/i);
        // Third person and a trigger: the description sits in the system prompt next to every other skill.
        expect(description).not.toMatch(/^(I|You|We)\b/);
        expect(description).toMatch(/\bUse (when|before|whenever)\b/);
      });

      it('keeps the body under 500 lines', () => {
        expect(read(name).body.split('\n').length).toBeLessThan(500);
      });

      it('links only to its own files, one level deep', () => {
        const { body } = read(name);
        for (const href of links(body)) {
          const target = normalize(join(skills, name, href));
          expect(target.startsWith(join(skills, name)), href).toBe(true);
          expect(existsSync(target), href).toBe(true);
          if (target.endsWith('.md')) {
            // A referenced file must not send the model on to yet another file.
            const own = links(readFileSync(target, 'utf8')).filter((next) =>
              normalize(join(dirname(target), next)).startsWith(join(skills, name)),
            );
            expect(own, `${href} links further`).toEqual([]);
          }
        }
      });
    });
  }
});
