import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { splitPrompt } from '../src/agents/assist.js';
import { contextText, projectContext, sessionPlan } from '../src/agents/context.js';
import { importPrompt } from '../src/agents/importer.js';
import { plantingPrompt, skillBody } from '../src/agents/planting.js';
import { setLang } from '../src/i18n/i18n.js';
import { addNode } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { isLongTitle, TITLE_LIMIT } from '../src/model/titles.js';
import { ROOT } from '../src/model/types.js';
import { emptyTree, tempDir, treeyardIn } from './helpers.js';

const PARAGRAPH =
  'Какой то баг ждет ответа окно клода фиксируется и никак не убирается а ниже продолжает работать другое такое же окно клода';

beforeEach(() => setLang('ru'));

describe('the limit', () => {
  it('is 60 characters: the gist in a few words, not a paragraph', () => {
    expect(TITLE_LIMIT).toBe(60);
    expect(isLongTitle('я'.repeat(60))).toBe(false);
    expect(isLongTitle(`  ${'я'.repeat(60)}  `)).toBe(false);
    expect(isLongTitle('я'.repeat(61))).toBe(true);
    expect(isLongTitle(PARAGRAPH)).toBe(true);
    expect(isLongTitle('Короткие названия узлов у агентов')).toBe(false);
  });
});

describe('agent context asks for a short title', () => {
  it('a node session: the add line says 2–6 words, details to --note and --done-when', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Бот', doneWhen: 'бот отвечает' });
    const text = contextText(tree, node.id);
    expect(text).toContain(`add "Короткое название" --parent ${node.id} --status idea --note "…"`);
    expect(text).toContain('суть в 2–6 словах, до 60 символов');
    expect(text).toContain('подробности — в `--note`, проверка — в `--done-when`');
  });

  it('a node session in English', () => {
    setLang('en');
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Bot', doneWhen: 'bot answers' });
    const text = contextText(tree, node.id);
    expect(text).toContain(`add "Short title" --parent ${node.id} --status idea --note "…"`);
    expect(text).toContain('the gist in 2–6 words, up to 60 characters');
    expect(text).toContain('details go to `--note`, the check to `--done-when`');
  });

  it('a session from the root: the commands and the review both ask for it', () => {
    const tree = emptyTree();
    addNode(tree, { title: 'Бот' });
    const text = projectContext(tree);
    expect(text).toContain('add "Короткое название" --parent <id> --done-when "…" --note "…"');
    expect(text).toContain('суть в 2–6 словах, до 60 символов');
    const review = sessionPlan(tree, ROOT, 'plan', 'claude').prompt!;
    expect(review).toContain('названия-абзацы');
    expect(review).toContain('сократи до 2–6 слов');
    expect(review).toContain('set <id> title="…" note="…"');
  });

  it('a review of the root in English', () => {
    setLang('en');
    const tree = emptyTree();
    const review = sessionPlan(tree, ROOT, 'plan', 'claude').prompt!;
    expect(review).toContain('paragraph titles');
    expect(review).toContain('cut to 2–6 words');
  });

  it('breaking a node into steps: a short name, the check and the details elsewhere', () => {
    const tree = emptyTree();
    const node = addNode(tree, { title: 'Оплата', doneWhen: 'платёж проходит' });
    const prompt = splitPrompt(tree, node.id);
    expect(prompt).toContain('суть в 2–6 словах (до 60 символов)');
    expect(prompt).toContain('подробности — в done_when и note');
    setLang('en');
    expect(splitPrompt(tree, node.id)).toContain('the gist in 2–6 words (up to 60 characters)');
  });

  it('importing a plan asks for the same', () => {
    expect(importPrompt()).toContain('суть в 2–6 словах, до 60 символов');
    setLang('en');
    expect(importPrompt()).toContain('the gist in 2–6 words, up to 60 characters');
  });

  it('planting: the skill sets the rule and its own examples obey it', () => {
    const body = skillBody();
    expect(body).toContain('A title is a short name: the gist in 2–6 words, up to 60 characters.');
    expect(body).toContain('the check goes to `done_when`, the details to `note`');
    expect(
      plantingPrompt({ name: 'x', entries: 5, git: true, commits: 9, tree: false, docs: [], empty: false }),
    ).toContain('treeyard-init');
    // Every title shown as an example is itself a short name.
    const titles = [...body.matchAll(/"title": "([^"]+)"/g)].map((match) => match[1]!);
    expect(titles.length).toBeGreaterThan(3);
    for (const title of titles) expect(isLongTitle(title), title).toBe(false);
  });
});

describe('treeyard add with a long title', () => {
  it('adds the node and points at --note and set on stderr; stdout stays the id', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('add', PARAGRAPH, '--status', 'idea');
    expect(res.code).toBe(0);
    const id = res.stdout.trim();
    expect(id).toMatch(/^\w{4}$/);
    expect(res.stderr).toContain(`название на ${[...PARAGRAPH].length} симв.`);
    expect(res.stderr).toContain('подробности в --note, проверка в --done-when');
    expect(res.stderr).toContain(`treeyard set ${id} title="…" note="…"`);
    expect(loadTree(tree.project.dir).nodes.get(id)?.title).toBe(PARAGRAPH);
  });

  it('with --note already given it only asks to shorten the title', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('add', PARAGRAPH, '--note', 'подробности тут');
    const id = res.stdout.trim();
    expect(res.stderr).toContain('подробности уже в --note');
    expect(res.stderr).toContain(`treeyard set ${id} title="…"`);
    expect(res.stderr).not.toContain('note="…"');
  });

  it('says it in English too', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tree.project.dir, { TREEYARD_LANG: 'en' });
    const res = await sh('add', PARAGRAPH);
    expect(res.stderr).toContain('the gist in 2–6 words, details in --note, the check in --done-when');
  });

  it('is silent for a short title', async () => {
    const tree = emptyTree();
    const sh = treeyardIn(tree.project.dir);
    const res = await sh('add', 'Короткие названия', '--status', 'idea');
    expect(res.code).toBe(0);
    expect(res.stderr).toBe('');
  });

  it('add --from-json hints for each long title, and only for them', async () => {
    const tree = emptyTree();
    const file = join(tempDir(), 'nodes.json');
    writeFileSync(
      file,
      JSON.stringify([{ title: 'Коротко' }, { title: PARAGRAPH }, { title: PARAGRAPH, note: 'подробности уже тут' }]),
    );
    const res = await treeyardIn(tree.project.dir)('add', '--from-json', file);
    expect(res.code).toBe(0);
    const hints = res.stderr.trim().split('\n');
    expect(hints).toHaveLength(2);
    expect(hints[0]).toContain('подробности в --note, проверка в --done-when');
    expect(hints[1]).toContain('подробности уже в --note');
  });
});
