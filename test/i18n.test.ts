import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import keys from '../scripts/i18n-keys.mjs';
import { EN } from '../src/i18n/en.js';
import { lang, plural, setLang, t } from '../src/i18n/i18n.js';
import { appendJournal, journalEntries } from '../src/model/journal.js';
import { addNode, STATUS_LABEL } from '../src/model/ops.js';
import { loadTree } from '../src/model/store.js';
import { DEFAULTS, loadSettings, resetSettings, settings, updateSettings } from '../src/settings.js';
import { createTree, getTemplate, listTemplates } from '../src/templates/templates.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree, tempDir } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));

beforeEach(() => {
  // Each test writes its settings into its own folder.
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS });
});

afterEach(() => {
  resetSettings({ ...DEFAULTS });
  setLang('ru');
});

describe('translations', () => {
  it('every t() in the code has an English line with the same placeholders', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const missing = (keys as string[]).filter((key) => !(key in EN));
    expect(missing).toEqual([]);
    for (const key of keys as string[]) expect(placeholders(EN[key]!), key).toEqual(placeholders(key));
  });

  it('t falls back to Russian, fills placeholders, and plurals agree with numbers', () => {
    expect(t('Новая сессия')).toBe('Новая сессия');
    setLang('en');
    expect(t('Новая сессия')).toBe('New session');
    expect(t('id {id} скопирован', { id: 'k3f9' })).toBe('id k3f9 copied');
    expect(t('строки, которой нет в словаре')).toBe('строки, которой нет в словаре');
    expect(plural(1, ['узел', 'узла', 'узлов'], ['node', 'nodes'])).toBe('node');
    setLang('ru');
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, ['узел', 'узла', 'узлов'], ['node', 'nodes']))).toEqual([
      'узел',
      'узла',
      'узлов',
      'узлов',
      'узел',
      'узла',
    ]);
  });

  it('labels follow the language at once', () => {
    expect(STATUS_LABEL.waiting).toBe('ждёт');
    setLang('en');
    expect(STATUS_LABEL.waiting).toBe('waiting');
    expect(Object.keys(STATUS_LABEL)).toContain('done');
  });

  it('the journal is written in the current language and read in both', () => {
    setLang('en');
    const body = appendJournal('', '2026-10-02 10:00 · you · first');
    expect(body).toContain('## Journal');
    setLang('ru');
    const old = appendJournal('## Журнал\n\n- старое\n', 'новое');
    expect(journalEntries(old)).toEqual(['старое', 'новое']);
    expect(journalEntries(appendJournal(body, 'second'))).toEqual(['2026-10-02 10:00 · you · first', 'second']);
  });
});

describe('templates in English', () => {
  it('the same five, with English names and an English project file', () => {
    setLang('en');
    expect(listTemplates().map((template) => `${template.id}:${template.name}`)).toEqual([
      'stages:Stages',
      'directions:Directions',
      'mikado:Mikado',
      'discovery:Finding improvements',
      'client:Client work',
    ]);
    const dir = tempDir();
    const tree = createTree(dir, getTemplate('stages')!, { title: 'Pilot', answers: { goal: 'the first review' } });
    expect(tree.project.body).toContain('## Method: Stages');
    expect(tree.project.body).toMatch(/## Rules for agents[\s\S]*Conventional Commits[^\n]*\n- A stage is closed/);
    expect([...tree.nodes.values()].map((node) => node.title)).toContain('Stage 0 — Skeleton');
    expect([...tree.nodes.values()].find((node) => node.title === 'Stage 3 — Launch')?.doneWhen).toBe(
      'the first review',
    );
  });
});

describe('settings', () => {
  it('are saved in TREEYARD_HOME and read back; TREEYARD_LANG wins for one run', () => {
    updateSettings({ lang: 'en', confirm: false });
    const path = join(process.env.TREEYARD_HOME!, 'settings.json');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ lang: 'en', confirm: false });
    expect(lang()).toBe('en');
    expect(loadSettings({ ...process.env, TREEYARD_LANG: 'ru' }).lang).toBe('ru');
  });

  it('treeyard config shows and changes them from the shell', () => {
    const home = tempDir('treeyard-home-');
    const run = (...args: string[]) =>
      spawnSync(join(root, 'node_modules', '.bin', 'tsx'), [join(root, 'src', 'cli', 'main.ts'), ...args], {
        cwd: tempDir(),
        env: { ...process.env, TREEYARD_HOME: home, TREEYARD_LANG: '', NO_COLOR: '1' },
        encoding: 'utf8',
      });
    expect(run('config', 'lang', 'en').stdout).toContain('lang = en');
    const listed = run('config').stdout;
    expect(listed).toContain('All projects');
    expect(listed).toMatch(/confirm\s+true/);
    expect(run('config', 'confirm', 'off').stdout).toContain('confirm = false');
    expect(run('config', 'lang', 'de').status).toBe(2);
  }, 30_000);
});

describe('the TUI in English and with confirmations', () => {
  function sample() {
    const tree = emptyTree();
    const product = addNode(tree, { title: 'Product', doneWhen: 'the scenario works' });
    addNode(tree, { title: 'Cart', parent: product.id, status: 'active' });
    return tree;
  }

  it('speaks English when the setting says so', async () => {
    const tree = sample();
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 26, settings: { lang: 'en' } });
    expect(frame).toMatch(/1 Tree\s+2 Now 1\s+3 Waiting\s+4 Ideas\s+5 Sessions\s+6 Journal/);
    expect(frame).toContain('goal  всё работает');
    expect(frame).toContain('in review');
    expect(frame).toContain('⏎ actions');
  });

  it('asks before a session starts: who, where, how and the first message', async () => {
    const tree = sample();
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 30, keys: ['c'] });
    expect(frame).toContain('Запустить сессию?');
    expect(frame).toContain('Claude Code · в этом терминале');
    expect(frame).toContain('план — агент изучает');
    expect(frame).toContain('Первое сообщение');
    expect(frame).toContain('! больше не спрашивать');
  });

  it('asks before an agent job too, and says it is read-only', async () => {
    const tree = sample();
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 30, keys: ['S'] });
    expect(frame).toContain('Разбить узел на шаги?');
    expect(frame).toContain('только чтение');
  });

  it('does not ask when confirmations are off', async () => {
    const tree = sample();
    const frame = await snapshot(tree.project.dir, {
      columns: 110,
      rows: 30,
      keys: ['c'],
      settings: { confirm: false },
    });
    expect(frame).not.toContain('Запустить сессию?');
  });

  it('«!» in the confirmation turns confirmations off for good', async () => {
    const tree = sample();
    await snapshot(tree.project.dir, { columns: 110, rows: 30, keys: ['c', '!'] });
    expect(loadSettings().confirm).toBe(false);
  });

  it('the settings screen switches the language on the spot and remembers it', async () => {
    const tree = sample();
    const before = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: [','] });
    expect(before).toContain('Настройки');
    expect(before).toContain('Подтверждать запуск');
    expect(before).toContain('Модель для задач агента');
    const after = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: [',', '\u001b[C'] });
    expect(after).toContain('Settings');
    expect(after).toContain('Confirm launches');
    expect(loadSettings().lang).toBe('en');
  });

  it('project settings land in tree.md', async () => {
    const tree = sample();
    // Down to «Default brain», one to the right: Codex.
    const downs = Array.from({ length: 11 }, () => '\u001b[B');
    await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: [',', ...downs, '\u001b[C'] });
    expect(loadTree(tree.project.dir).project.brain).toBe('codex');
    expect(settings().lang).toBe('ru');
  });
});
