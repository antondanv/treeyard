import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 20_000,
    // Integration suites open extra Node processes and tmux clients beyond their own workers.
    ...(process.env.CI ? { maxWorkers: 3 } : {}),
    // Never the person's own ~/.treeyard: tests see the defaults. Model lists come
    // from Brainyard's built-in ones, not from the Codex, Antigravity and OpenCode installed here.
    // Russian, the source language, for the CLIs the tests spawn too (see test/setup.ts).
    env: {
      TREEYARD_HOME: mkdtempSync(join(tmpdir(), 'treeyard-home-')),
      TREEYARD_LANG: 'ru',
      // A test run started from an agent session must not inherit that session's CLI identity.
      TREEYARD_AS: '',
      // The CLIs the tests spawn must not put skills into the person's ~/.claude, ~/.codex, ~/.gemini.
      TREEYARD_SKILLS: 'off',
      // No deliverer of letters left running after a test; the test of the deliverer turns it on.
      TREEYARD_DELIVER: 'off',
      BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
      BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
      BRAINYARD_OPENCODE_BIN: 'treeyard-test-no-opencode',
      // Assertions match plain text; the color level of the terminal running the
      // tests must not add escape codes to the frames or to CLI output.
      FORCE_COLOR: '0',
    },
  },
});
