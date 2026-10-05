import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addNode, attachSession } from '../src/model/ops.js';
import { loadTree, writeProject } from '../src/model/store.js';
import { DEFAULTS, resetSettings } from '../src/settings.js';
import { nextGroup, sessionLines } from '../src/tui/App.js';
import { optionWindow } from '../src/tui/components/controls.js';
import { snapshot } from '../src/tui/snapshot.js';
import { emptyTree, tempDir } from './helpers.js';

const DOWN = '\u001b[B';
const RIGHT = '\u001b[C';
const LEFT = '\u001b[D';
const downs = (n: number) => Array.from({ length: n }, () => DOWN);
/** Rows of the settings screen before «Модель сессий»: language … status order … live, panes, notes, brain, start. */
const MODEL_ROW = 13;

beforeEach(() => {
  process.env.TREEYARD_HOME = tempDir('treeyard-home-');
  resetSettings({ ...DEFAULTS });
});

afterEach(() => resetSettings({ ...DEFAULTS }));

function sample() {
  const tree = emptyTree();
  const product = addNode(tree, { title: 'Product', doneWhen: 'the scenario works' });
  addNode(tree, { title: 'Cart', parent: product.id, status: 'active' });
  return tree;
}

describe('option window', () => {
  const labels = ['по умолчанию CLI', 'GPT-6.1-Sol', 'GPT-6-Astra', 'GPT-6-Sol', 'GPT-6-Luna', 'GPT-5.5'];

  it('shows everything when it fits', () => {
    expect(optionWindow(labels, 3, 200)).toEqual({ from: 0, to: labels.length });
  });

  it('keeps the chosen option in sight and room for the arrows', () => {
    for (let index = 0; index < labels.length; index++) {
      const { from, to } = optionWindow(labels, index, 40);
      expect(from).toBeLessThanOrEqual(index);
      expect(to).toBeGreaterThan(index);
      const shown = labels.slice(from, to).join('  ').length + (from > 0 ? 2 : 0) + (to < labels.length ? 4 : 0);
      expect(shown).toBeLessThanOrEqual(40);
    }
  });

  it('never drops the chosen option, even when it alone is wider', () => {
    expect(optionWindow(labels, 0, 5)).toEqual({ from: 0, to: 1 });
  });
});

describe('models come from the CLI, not from typing', () => {
  it('the settings offer the models of the project CLI and save the choice', async () => {
    const tree = sample();
    const frame = await snapshot(tree.project.dir, {
      columns: 110,
      rows: 34,
      keys: [',', ...downs(MODEL_ROW), RIGHT, RIGHT],
    });
    expect(frame).toMatch(/Модель сессий\s+.*Opus/);
    expect(frame).toContain('Sonnet');
    expect(frame).toContain('псевдонимы Claude Code');
    expect(loadTree(tree.project.dir).project.model).toBe('opus');
  });

  it('an effort the new model does not know is dropped', async () => {
    const tree = sample();
    tree.project.effort = 'max';
    writeProject(tree.project);
    // Default → Fable → Opus → Sonnet → Haiku, which has no effort setting.
    await snapshot(tree.project.dir, {
      columns: 110,
      rows: 34,
      keys: [',', ...downs(MODEL_ROW), RIGHT, RIGHT, RIGHT, RIGHT],
    });
    const project = loadTree(tree.project.dir).project;
    expect(project.model).toBe('haiku');
    expect(project.effort).toBeUndefined();
  });

  it('another brain forgets the models of the old one', async () => {
    const tree = sample();
    tree.project.model = 'opus';
    tree.project.assistModel = 'haiku';
    writeProject(tree.project);
    const frame = await snapshot(tree.project.dir, {
      columns: 110,
      rows: 34,
      keys: [',', ...downs(11), RIGHT, DOWN, DOWN],
    });
    const project = loadTree(tree.project.dir).project;
    expect(project.brain).toBe('codex');
    expect(project.model).toBeUndefined();
    expect(project.assistModel).toBeUndefined();
    // Codex is not installed for the tests: its built-in list.
    expect(frame).toContain('GPT-5.5');
    expect(frame).toContain('встроенный список');
  });

  it('OpenCode as the project brain: its models, and the effort stays in its session', async () => {
    const tree = sample();
    tree.project.model = 'opus';
    tree.project.effort = 'high';
    writeProject(tree.project);
    // Claude Code ← OpenCode: the brain row goes round to the last CLI.
    const frame = await snapshot(tree.project.dir, {
      columns: 110,
      rows: 34,
      keys: [',', ...downs(11), LEFT, DOWN, DOWN, DOWN],
    });
    const project = loadTree(tree.project.dir).project;
    expect(project.brain).toBe('opencode');
    expect(project.model).toBeUndefined();
    expect(project.effort).toBeUndefined();
    expect(frame).toMatch(/Усилие\s+в самой сессии/);
    expect(frame).toContain('OpenCode меняет усилие — вариант модели — прямо в сессии: ctrl+t');
    // Pressing ←→ on it changes nothing.
    await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: [',', ...downs(14), RIGHT, LEFT] });
    expect(loadTree(tree.project.dir).project.effort).toBeUndefined();
  });

  it('a quick session uses the project model, and the confirmation says so', async () => {
    const tree = sample();
    tree.project.model = 'sonnet';
    tree.project.effort = 'high';
    writeProject(tree.project);
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 30, keys: ['c'] });
    expect(frame).toContain('Запустить сессию?');
    expect(frame).toContain('sonnet · усилие high');
  });

  it('the launch form picks a model from the list of the chosen brain', async () => {
    const tree = sample();
    const claude = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['o', DOWN, DOWN, DOWN] });
    expect(claude).toMatch(/Модель\s+по умолчанию CLI\s+Fable\s+Opus/);
    const codex = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['o', RIGHT, DOWN, DOWN, DOWN] });
    expect(codex).toMatch(/Модель\s+по умолчанию CLI\s+GPT-5\.5/);
  });

  it('the launch form starts OpenCode: no background, no /goal, the effort is chosen in its session', async () => {
    const tree = sample();
    const form = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['o', LEFT, DOWN, DOWN, DOWN] });
    expect(form).toMatch(/Мозг\s+.*OpenCode/);
    expect(form).toMatch(/Усилие\s+в самой сессии OpenCode — ctrl\+t/);
    expect(form).toMatch(/Worktree\s+только Claude Code/);
    // OpenCode is not installed for the tests: no list, and the hint says what runs.
    expect(form).toContain('OpenCode не дал список моделей');
    expect(form).not.toContain('в фоне');
    expect(form).not.toContain('до критерия');
    const confirm = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['o', LEFT, '\r'] });
    expect(confirm).toContain('Запустить сессию?');
    expect(confirm).toContain('OpenCode · в этом терминале');
    expect(confirm).toContain('Работаем над узлом');
  });

  it('the menu of a node starts OpenCode with O', async () => {
    const tree = sample();
    const menu = await snapshot(tree.project.dir, { columns: 110, rows: 40, keys: ['\r'] });
    expect(menu).toMatch(/▶ OpenCode · план\s+O/);
    const confirm = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['\r', 'O'] });
    expect(confirm).toContain('OpenCode · в этом терминале');
  });
});

describe('settings are easy to find', () => {
  it('the header and the footer name the key', async () => {
    const tree = sample();
    const frame = await snapshot(tree.project.dir, { columns: 120, rows: 30 });
    expect(frame).toContain(' ,  настройки   ?  клавиши');
    expect(frame).toContain(', настройки');
  });

  it('the live status covers every CLI', async () => {
    const tree = sample();
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: [',', ...downs(6)] });
    expect(frame).toContain('Живые статусы сессий');
    expect(frame).toContain('Claude Code, Codex, Antigravity и OpenCode');
  });
});

describe('a burst of keys lands where it was meant to', () => {
  // A paste, key repeat or a slow link delivers several keys in one read.
  const DOWN = '\u001b[B';
  const RIGHT = '\u001b[C';

  it('the launch form: arrows after arrows, then Enter — and it asks before starting', async () => {
    const tree = sample();
    const burst = `${DOWN}${DOWN}${RIGHT}${RIGHT}${RIGHT}\r`;
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['o', burst] });
    expect(frame).toContain('Запустить сессию?');
    expect(frame).toContain('Claude Code · в этом терминале');
    expect(frame).toContain('просто открыть');
  });

  it('a menu: down and Enter pick the next item; a second Enter does not start anything', async () => {
    const tree = sample();
    const next = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['\r', `${DOWN}\r`] });
    expect(next).toContain('Запустить сессию?');
    expect(next).toContain('в фоне, сам по себе');
    // Menu, its first item, and a third Enter right after: the confirmation is still there.
    const twice = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['\r', '\r', '\r'] });
    expect(twice).toContain('Запустить сессию?');
  });

  it('the settings: two arrows move two steps', async () => {
    const tree = sample();
    await snapshot(tree.project.dir, {
      columns: 110,
      rows: 34,
      keys: [',', `${'\u001b[B'.repeat(MODEL_ROW)}${RIGHT}${RIGHT}`],
    });
    expect(loadTree(tree.project.dir).project.model).toBe('opus');
  });
});

describe('the sessions view groups sessions by CLI', () => {
  it('lines: a heading per CLI, its sessions under it, and «none» where there are none', () => {
    const list = [
      { brain: 'claude' as const, id: 'c1', interactive: true },
      { brain: 'claude' as const, id: 'c2', interactive: true },
      { brain: 'codex' as const, id: 'x1', interactive: true },
    ];
    expect(sessionLines(list).map((line) => (line.kind === 'row' ? line.index : `${line.kind}:${line.brain}`))).toEqual(
      [
        'header:claude',
        0,
        1,
        'gap:codex',
        'header:codex',
        2,
        'gap:antigravity',
        'header:antigravity',
        'empty:antigravity',
        'gap:opencode',
        'header:opencode',
        'empty:opencode',
      ],
    );
    expect(nextGroup(list, 0, 1)).toBe(2);
    expect(nextGroup(list, 2, 1)).toBe(2);
    expect(nextGroup(list, 2, -1)).toBe(0);
  });

  it('on screen: Claude Code, Codex, Antigravity, OpenCode in turn; ← → jump between them', async () => {
    const tree = sample();
    const [product] = [...tree.nodes.values()];
    attachSession(tree, product!.id, {
      brain: 'codex',
      id: 'x-1',
      name: 'Codex work',
      mode: 'pane',
      started: '2026-10-02T09:00:00Z',
    });
    attachSession(tree, product!.id, {
      brain: 'claude',
      id: 'c-1',
      name: 'Claude work',
      mode: 'pane',
      started: '2026-10-02T10:00:00Z',
    });
    attachSession(tree, product!.id, {
      brain: 'opencode',
      id: 'ses_open',
      name: 'OpenCode work',
      mode: 'pane',
      started: '2026-10-02T11:00:00Z',
    });
    const frame = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['5'] });
    const at = (text: string) => frame.indexOf(text);
    expect(at('Claude Code')).toBeGreaterThan(-1);
    expect(at('Claude work · ')).toBeGreaterThan(at('Claude Code'));
    expect(at('Codex  1')).toBeGreaterThan(at('Claude work · '));
    expect(at('Codex work · ')).toBeGreaterThan(at('Codex  1'));
    expect(at('Antigravity  0')).toBeGreaterThan(at('Codex work · '));
    expect(at('OpenCode  1')).toBeGreaterThan(at('Antigravity  0'));
    expect(at('OpenCode work · ')).toBeGreaterThan(at('OpenCode  1'));
    expect(frame).toContain('нет сессий в этой папке');
    const jumped = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['5', '\u001b[C'] });
    expect(jumped).toMatch(/❯.*Codex work/);
    const last = await snapshot(tree.project.dir, { columns: 110, rows: 34, keys: ['5', '\u001b[C', '\u001b[C'] });
    expect(last).toMatch(/❯.*OpenCode work/);
    expect(last).toContain('opencode --session ses_open');
  });
});
