import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { BrainUsage, Catalog } from '@antondanv/brainyard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { limitsCommand, modelsCommand } from '../src/cli/commands.js';
import { type CatalogResult, fetchCatalogs, fetchLimits, limitsText, modelsText } from '../src/cli/models-text.js';
import { paint } from '../src/cli/print.js';
import { setLang } from '../src/i18n/i18n.js';
import { BRAIN_IDS } from '../src/model/types.js';
import { tempDir } from './helpers.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli/main.ts', import.meta.url));
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

function shell(lang: 'ru' | 'en' = 'ru') {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TREEYARD_HOME: tempDir('treeyard-home-'),
    TREEYARD_LANG: lang,
    NO_COLOR: '1',
  };
  return (...args: string[]) =>
    run(process.execPath, ['--import', tsx, cli, ...args], { env, timeout: 30_000 }).then(
      ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );
}

const mockPaint = paint({ isTTY: false } as unknown as NodeJS.WriteStream);

const sampleClaudeCatalog: Catalog = {
  brain: 'claude',
  models: [
    {
      id: 'fable',
      label: 'Fable',
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      effortRequired: false,
      variants: [],
    },
    {
      id: 'sonnet',
      label: 'Sonnet',
      efforts: ['low', 'medium', 'high'],
      effortRequired: false,
      variants: [],
    },
  ],
  defaultEfforts: ['low', 'medium', 'high'],
  source: 'builtin',
  fetchedAt: '2026-11-25T12:00:00Z',
};

const sampleAgyCatalog: Catalog = {
  brain: 'antigravity',
  models: [
    {
      id: 'gemini-4-neon',
      label: 'Gemini 4 Neon',
      efforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'high',
      effortRequired: true,
      variants: [],
    },
    {
      id: 'custom-model',
      label: 'custom-model',
      efforts: [],
      effortRequired: false,
      variants: [],
    },
  ],
  defaultEfforts: ['low', 'medium', 'high'],
  source: 'cli',
  fetchedAt: '2026-11-25T12:00:00Z',
};

const sampleUsageBrains: BrainUsage[] = [
  {
    brain: 'claude',
    limits: [
      { window: 'five_hour', utilization: 0, windowMinutes: 300 },
      { window: 'seven_day', utilization: 1, windowMinutes: 10080, resetsAt: 1795622400 },
    ],
    limitsSource: 'cache',
    limitsObservedAt: '2026-11-25T12:00:00.000Z',
    limitsUnavailable: null,
  },
  {
    brain: 'codex',
    limits: [
      { window: 'primary', utilization: 0.11, resetsAt: 1795604525, windowMinutes: 300 },
      { window: 'secondary', utilization: 0.8, resetsAt: 1795685201, windowMinutes: 10080 },
    ],
    limitsSource: 'rollout',
    limitsObservedAt: '2026-11-25T10:00:00.000Z',
    limitsUnavailable: null,
  },
  {
    brain: 'antigravity',
    limits: null,
    limitsSource: null,
    limitsObservedAt: null,
    limitsUnavailable: 'not_requested',
    detail: 'Antigravity /usage quota requests are disabled by offline: true.',
  },
  {
    brain: 'opencode',
    limits: null,
    limitsSource: null,
    limitsObservedAt: null,
    limitsUnavailable: 'failed',
    detail: 'Config file missing',
  },
];

beforeEach(() => {
  setLang('ru');
});

afterEach(() => {
  setLang('ru');
});

describe('modelsText formatting', () => {
  it('formats models with id, label (if different), and efforts with default marked', () => {
    const results: CatalogResult[] = [{ brain: 'antigravity', catalog: sampleAgyCatalog }];
    const text = modelsText(results, mockPaint);

    expect(text).toContain('Antigravity');
    expect(text).toContain('gemini-4-neon');
    expect(text).toContain('Gemini 4 Neon');
    expect(text).toContain('low · medium · high* · xhigh');
    // For custom-model where label === id, it should not repeat label as a separate string
    expect(text).toContain('custom-model');
    expect(text).toContain('—'); // empty effort
    expect(text).toContain('* — по умолчанию');
  });

  it('formats models in English', () => {
    setLang('en');
    const results: CatalogResult[] = [{ brain: 'antigravity', catalog: sampleAgyCatalog }];
    const text = modelsText(results, mockPaint);

    expect(text).toContain('Antigravity');
    expect(text).toContain('* — default');
  });

  it('handles CLI error gracefully', () => {
    const results: CatalogResult[] = [{ brain: 'opencode', error: 'binary not found in PATH' }];
    const text = modelsText(results, mockPaint);
    expect(text).toContain('OpenCode');
    expect(text).toContain('ошибка: binary not found in PATH');

    setLang('en');
    const textEn = modelsText(results, mockPaint);
    expect(textEn).toContain('error: binary not found in PATH');
  });

  it('handles empty catalog with explanation', () => {
    const emptyOpencode: Catalog = {
      brain: 'opencode',
      models: [],
      defaultEfforts: [],
      source: 'builtin',
      fetchedAt: '2026-11-25T12:00:00Z',
    };
    const results: CatalogResult[] = [{ brain: 'opencode', catalog: emptyOpencode }];
    const text = modelsText(results, mockPaint);
    expect(text).toContain('OpenCode не дал список моделей');

    setLang('en');
    const textEn = modelsText(results, mockPaint);
    expect(textEn).toContain('OpenCode gave no list of models');
  });
});

describe('limitsText formatting', () => {
  it('formats limit windows, percentage, reset time, source and age', () => {
    const text = limitsText(sampleUsageBrains, mockPaint, Date.parse('2026-11-25T10:30:00Z'));

    expect(text).toContain('Claude Code');
    expect(text).toContain('кеш');
    expect(text).toContain('five_hour');
    expect(text).toContain('0%');
    expect(text).toContain('seven_day');
    expect(text).toContain('100%');
    expect(text).toContain('сброс в');

    expect(text).toContain('Codex');
    expect(text).toContain('rollout');
    expect(text).toContain('primary');
    expect(text).toContain('11%');
    expect(text).toContain('secondary');
    expect(text).toContain('80%');

    // Offline / unavailable
    expect(text).toContain('Antigravity');
    expect(text).toContain('нет локальных данных (в офлайн-режиме сетевые запросы отключены)');

    expect(text).toContain('OpenCode');
    expect(text).toContain('ошибка: Config file missing');
  });

  it('shows a window past its reset time as reset, 0%', () => {
    const now = Date.parse('2026-11-25T16:54:00Z');
    const text = limitsText(sampleUsageBrains, mockPaint, now);
    expect(text).toMatch(/seven_day\s+0% · сброшено в \d\d:\d\d/);
    expect(text).not.toContain('100%');
    expect(text).toMatch(/primary\s+0% · сброшено в \d\d:\d\d/);
    expect(text).toMatch(/secondary\s+80% · сброс в \d\d\.\d\d \d\d:\d\d/);
    setLang('en');
    expect(limitsText(sampleUsageBrains, mockPaint, now)).toMatch(/reset at \d\d:\d\d/);
  });

  it('formats limit windows in English', () => {
    setLang('en');
    const text = limitsText(sampleUsageBrains, mockPaint, Date.parse('2026-11-25T10:30:00Z'));

    expect(text).toContain('Claude Code');
    expect(text).toContain('cache');
    expect(text).toContain('resets at');
    expect(text).toContain('no local data (network requests disabled in offline mode)');
    expect(text).toContain('error: Config file missing');
  });

  it('formats other unavailable limit states correctly', () => {
    const variants: BrainUsage[] = [
      {
        brain: 'claude',
        limits: null,
        limitsSource: null,
        limitsObservedAt: null,
        limitsUnavailable: 'other_account',
      },
      {
        brain: 'codex',
        limits: null,
        limitsSource: null,
        limitsObservedAt: null,
        limitsUnavailable: 'unsupported',
      },
      {
        brain: 'antigravity',
        limits: null,
        limitsSource: null,
        limitsObservedAt: null,
        limitsUnavailable: 'missing',
      },
    ];

    const ru = limitsText(variants, mockPaint);
    expect(ru).toContain('нет локальных данных (кеш другого аккаунта)');
    expect(ru).toContain('лимиты не поддерживаются');
    expect(ru).toContain('нет локальных данных');

    setLang('en');
    const en = limitsText(variants, mockPaint);
    expect(en).toContain('no local data (cache belongs to another account)');
    expect(en).toContain('limits not supported');
    expect(en).toContain('no local data');
  });
});

describe('fetchCatalogs and fetchLimits', () => {
  it('fetchCatalogs calls modelsFn for each brain and catches failures per brain', async () => {
    const mockModelsFn = vi.fn(async (brain) => {
      if (brain === 'codex') throw new Error('codex crash');
      return { ...sampleClaudeCatalog, brain };
    });

    const res = await fetchCatalogs(['claude', 'codex'], mockModelsFn);
    expect(res).toHaveLength(2);
    expect(res[0]?.brain).toBe('claude');
    expect(res[0]?.catalog?.brain).toBe('claude');
    expect(res[1]?.brain).toBe('codex');
    expect(res[1]?.error).toBe('codex crash');
  });

  it('fetchLimits passes offline: true and limit: 0 to usageFn', async () => {
    const mockUsageFn = vi.fn(async (_opts) => ({
      brains: sampleUsageBrains,
      sessions: [],
      checkedAt: '2026-11-25T12:00:00Z',
    }));

    const report = await fetchLimits(['claude', 'antigravity'], mockUsageFn);
    expect(mockUsageFn).toHaveBeenCalledWith({
      brains: ['claude', 'antigravity'],
      limit: 0,
      offline: true,
    });
    expect(report.brains).toHaveLength(4);
  });
});

describe('modelsCommand unit tests', () => {
  let capturedStdout: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    capturedStdout = [];
    process.stdout.write = (chunk: string | Uint8Array) => {
      capturedStdout.push(String(chunk));
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = origWrite;
  });

  it('prints models for all 4 brains by default', async () => {
    const mockModelsFn = vi.fn(async (b) => ({ ...sampleClaudeCatalog, brain: b }));
    const code = await modelsCommand([], { modelsFn: mockModelsFn });
    expect(code).toBe(0);
    expect(mockModelsFn).toHaveBeenCalledTimes(4);
    const out = capturedStdout.join('');
    expect(out).toContain('Claude Code');
    expect(out).toContain('Codex');
    expect(out).toContain('Antigravity');
    expect(out).toContain('OpenCode');
  });

  it('filters by single positional brain', async () => {
    const mockModelsFn = vi.fn(async (b) => ({ ...sampleAgyCatalog, brain: b }));
    const code = await modelsCommand(['antigravity'], { modelsFn: mockModelsFn });
    expect(code).toBe(0);
    expect(mockModelsFn).toHaveBeenCalledTimes(1);
    expect(mockModelsFn).toHaveBeenCalledWith('antigravity');
    const out = capturedStdout.join('');
    expect(out).toContain('Antigravity');
    expect(out).not.toContain('Claude Code');
  });

  it('filters by --brain alias (e.g. cc for claude)', async () => {
    const mockModelsFn = vi.fn(async (b) => ({ ...sampleClaudeCatalog, brain: b }));
    const code = await modelsCommand(['--brain', 'cc'], { modelsFn: mockModelsFn });
    expect(code).toBe(0);
    expect(mockModelsFn).toHaveBeenCalledWith('claude');
  });

  it('flags expired windows in json', async () => {
    const mockUsageFn = vi.fn(async () => ({ brains: sampleUsageBrains, sessions: [], checkedAt: '' }));
    const now = Date.parse('2026-11-25T16:54:00Z');
    await limitsCommand(['claude', '--json'], { usageFn: mockUsageFn, now });
    const parsed = JSON.parse(capturedStdout.join(''));
    const w = parsed.limits.find((x: { window: string }) => x.window === 'seven_day');
    expect(w).toMatchObject({ expired: true, utilization: 0, previousUtilization: 1 });
    expect(parsed.limits[0].expired).toBeUndefined();
  });

  it('outputs json array for all brains', async () => {
    const mockModelsFn = vi.fn(async (b) => ({ ...sampleClaudeCatalog, brain: b }));
    const code = await modelsCommand(['--json'], { modelsFn: mockModelsFn });
    expect(code).toBe(0);
    const parsed = JSON.parse(capturedStdout.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(4);
    expect(parsed[0].brain).toBe('claude');
  });

  it('outputs single json object when a brain is specified', async () => {
    const mockModelsFn = vi.fn(async (b) => ({ ...sampleClaudeCatalog, brain: b }));
    const code = await modelsCommand(['claude', '--json'], { modelsFn: mockModelsFn });
    expect(code).toBe(0);
    const parsed = JSON.parse(capturedStdout.join(''));
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.brain).toBe('claude');
    expect(parsed.models).toBeDefined();
  });

  it('throws UsageError on unknown brain', async () => {
    await expect(modelsCommand(['unknown-brain'])).rejects.toThrow('мозг бывает: claude, codex, antigravity, opencode');
  });

  it('throws UsageError on extra positionals', async () => {
    await expect(modelsCommand(['claude', 'extra'])).rejects.toThrow('treeyard models [brain] [--json]');
  });
});

describe('limitsCommand unit tests', () => {
  let capturedStdout: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);

  beforeEach(() => {
    capturedStdout = [];
    process.stdout.write = (chunk: string | Uint8Array) => {
      capturedStdout.push(String(chunk));
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = origWrite;
  });

  it('prints limits for all brains by default', async () => {
    const mockUsageFn = vi.fn(async () => ({
      brains: sampleUsageBrains,
      sessions: [],
      checkedAt: '2026-11-25T12:00:00Z',
    }));

    const code = await limitsCommand([], { usageFn: mockUsageFn });
    expect(code).toBe(0);
    expect(mockUsageFn).toHaveBeenCalledWith({
      brains: BRAIN_IDS,
      limit: 0,
      offline: true,
    });
    const out = capturedStdout.join('');
    expect(out).toContain('Claude Code');
    expect(out).toContain('Codex');
    expect(out).toContain('Antigravity');
    expect(out).toContain('OpenCode');
  });

  it('filters by single positional brain', async () => {
    const mockUsageFn = vi.fn(async () => ({
      brains: [sampleUsageBrains[0]!],
      sessions: [],
      checkedAt: '2026-11-25T12:00:00Z',
    }));

    const code = await limitsCommand(['claude'], { usageFn: mockUsageFn });
    expect(code).toBe(0);
    expect(mockUsageFn).toHaveBeenCalledWith({
      brains: ['claude'],
      limit: 0,
      offline: true,
    });
    const out = capturedStdout.join('');
    expect(out).toContain('Claude Code');
    expect(out).not.toContain('Codex');
  });

  it('outputs json array for all brains', async () => {
    const mockUsageFn = vi.fn(async () => ({
      brains: sampleUsageBrains,
      sessions: [],
      checkedAt: '2026-11-25T12:00:00Z',
    }));

    const code = await limitsCommand(['--json'], { usageFn: mockUsageFn });
    expect(code).toBe(0);
    const parsed = JSON.parse(capturedStdout.join(''));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(4);
  });

  it('outputs single json object when a brain is specified', async () => {
    const mockUsageFn = vi.fn(async () => ({
      brains: sampleUsageBrains,
      sessions: [],
      checkedAt: '2026-11-25T12:00:00Z',
    }));

    const code = await limitsCommand(['codex', '--json'], { usageFn: mockUsageFn });
    expect(code).toBe(0);
    const parsed = JSON.parse(capturedStdout.join(''));
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.brain).toBe('codex');
    expect(parsed.limits).toBeDefined();
  });

  it('throws UsageError on unknown brain', async () => {
    await expect(limitsCommand(['unknown-cli'])).rejects.toThrow('мозг бывает: claude, codex, antigravity, opencode');
  });

  it('throws UsageError on extra positionals', async () => {
    await expect(limitsCommand(['codex', 'extra'])).rejects.toThrow('treeyard limits [brain] [--json]');
  });
});

describe('CLI subshell execution', () => {
  it('treeyard models --help prints Russian help', async () => {
    const sh = shell('ru');
    const res = await sh('models', '--help');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('treeyard models [brain] [--json]');
    expect(res.stdout).toContain('модели и уровни effort для CLI');
  });

  it('treeyard limits --help prints English help', async () => {
    const sh = shell('en');
    const res = await sh('limits', '--help');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('treeyard limits [brain] [--json]');
    expect(res.stdout).toContain('local limit windows of the CLIs');
  });

  it('treeyard models with invalid brain exits with code 2 and usage error', async () => {
    const sh = shell('ru');
    const res = await sh('models', 'nonexistent');
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('мозг бывает: claude, codex, antigravity, opencode');
  });

  it('treeyard limits with invalid brain exits with code 2 and usage error', async () => {
    const sh = shell('ru');
    const res = await sh('limits', 'nonexistent');
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('мозг бывает: claude, codex, antigravity, opencode');
  });

  it('treeyard limits --json runs offline and outputs valid JSON without network calls', async () => {
    const sh = shell('en');
    const res = await sh('limits', '--json');
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(4);
    const brains = parsed.map((b: { brain: string }) => b.brain);
    expect(brains).toEqual(['claude', 'codex', 'antigravity', 'opencode']);
  });
});
