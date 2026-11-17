import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LANGS } from '../src/i18n/i18n.js';
import { plantPointer, pointer, pointerGap, pointerStates } from '../src/templates/pointer.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree } from './helpers.js';

/** The block as the first version wrote it: a tree planted then has to be told it is old. */
const FIRST_BLOCK = `<!-- treeyard -->
## Дерево задач

Проект ведётся деревом целей в \`.tree/\` (treeyard): обзор — \`.tree/README.md\`, узлы — \`.tree/nodes/<id>.md\`.
Работаешь над задачей — найди её узел (\`treeyard show\`) и держись его. Итог — в журнал узла
(\`treeyard log <id> "что сделано; что осталось"\`), всплывшие идеи — новыми узлами
(\`treeyard add "…" --parent <id> --status idea\`). Критерий выполнен — \`treeyard set <id> status=review\`; готово ставит человек.
<!-- /treeyard -->`;

describe('the block about the tree', () => {
  it('stays short and points to the skill', () => {
    for (const language of LANGS) {
      const block = pointer(language);
      // Read in every session: a few lines, not a manual.
      expect(block.split('\n').length, language).toBeLessThanOrEqual(10);
      expect(block, language).toContain('`treeyard`');
      expect(block, language).toContain('treeyard skills install');
    }
  });

  it('says what agents break most: short titles, names for the person, --brief, "done" on request', () => {
    const ru = pointer('ru');
    expect(ru).toContain('коротким названием (2–6 слов)');
    expect(ru).toContain('Человеку узлы называй по названию, не по id');
    expect(ru).toContain('treeyard show <id> --brief');
    expect(ru).toContain('«Готово» — только по прямой просьбе человека');
    const en = pointer('en');
    expect(en).toContain('short title (2–6 words)');
    expect(en).toContain('name nodes by title, not by id');
    expect(en).toContain('treeyard show <id> --brief');
    expect(en).toContain('"Done" only when the person asks for it directly');
  });

  it('the first version of the block counts as outdated, the new one as current', () => {
    const tree = emptyTree();
    const dir = tree.project.dir;
    writeFileSync(join(dir, 'AGENTS.md'), `# Правила\n\n${FIRST_BLOCK}\n`);
    expect(pointerStates(dir).find((p) => p.file === 'AGENTS.md')?.state).toBe('outdated');
    expect(pointerGap(dir)).toEqual({ kind: 'outdated', files: ['AGENTS.md'] });
    plantPointer(dir);
    expect(pointerStates(dir).find((p) => p.file === 'AGENTS.md')?.state).toBe('ok');
    expect(pointerGap(dir)).toBeUndefined();
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8').startsWith('# Правила')).toBe(true);
  });
});

describe('when the tree has no block', () => {
  it('there is a gap with no agent file, with a file without the block, and none when it is carried', () => {
    const dir = emptyTree().project.dir;
    expect(pointerGap(dir)).toEqual({ kind: 'missing', files: ['AGENTS.md'] });
    writeFileSync(join(dir, 'AGENTS.md'), '# Правила\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
    // CLAUDE.md only imports AGENTS.md: the block goes into the one file.
    expect(pointerGap(dir)).toEqual({ kind: 'missing', files: ['AGENTS.md'] });
    expect(plantPointer(dir)).toEqual(['AGENTS.md']);
    expect(pointerGap(dir)).toBeUndefined();
  });

  it('planting with no agent file at all starts AGENTS.md', () => {
    const dir = emptyTree().project.dir;
    expect(plantPointer(dir)).toEqual(['AGENTS.md']);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(`${pointer()}\n`);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('the TUI says so, offers the block on «!» and goes quiet once it is written', async () => {
    const dir = emptyTree().project.dir;
    const before = await snapshot(dir, { columns: 110, rows: 30 });
    expect(before).toContain('агенты не знают о дереве (!)');

    const asked = await snapshot(dir, { columns: 110, rows: 30, keys: ['!'] });
    expect(asked).toContain('Сказать агентам про дерево?');
    expect(asked).toContain('AGENTS.md');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);

    const refused = await snapshot(dir, { columns: 110, rows: 30, keys: ['!', '\u001b'] });
    expect(refused).not.toContain('Сказать агентам про дерево?');
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);

    const written = await snapshot(dir, { columns: 110, rows: 30, keys: ['!', '\r'] });
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('<!-- treeyard -->');
    expect(written).toContain('блок о дереве — в AGENTS.md');
    expect(written).not.toContain('агенты не знают о дереве');
    expect(await snapshot(dir, { columns: 110, rows: 30 })).not.toContain('агенты не знают о дереве');
  });

  it('an old block gets its own wording; the hint is cut before it pushes the screen out', async () => {
    const dir = emptyTree().project.dir;
    writeFileSync(join(dir, 'AGENTS.md'), `${FIRST_BLOCK}\n`);
    for (const columns of [100, 80]) {
      const frame = await snapshot(dir, { columns, rows: 30 });
      for (const line of frame.split('\n')) expect(line.length, `${columns}: ${line}`).toBeLessThanOrEqual(columns);
    }
    expect(await snapshot(dir, { columns: 110, rows: 30 })).toContain('блок для агентов устарел (!)');
    const asked = await snapshot(dir, { columns: 110, rows: 30, keys: ['!'] });
    expect(asked).toContain('Обновить блок о дереве?');
  });

  it('in English the hint and the question are in English', async () => {
    const dir = emptyTree().project.dir;
    const frame = await snapshot(dir, { columns: 110, rows: 30, settings: { lang: 'en' } });
    expect(frame).toContain('agents do not know about the tree (!)');
    const asked = await snapshot(dir, { columns: 110, rows: 30, keys: ['!'], settings: { lang: 'en' } });
    expect(asked).toContain('Tell agents about the tree?');
    // The project's own title and goal stay as written; treeyard's words do not.
    for (const russian of ['Сказать агентам', 'дописать', 'позже', 'агенты не знают'])
      expect(asked).not.toContain(russian);
  });
});
