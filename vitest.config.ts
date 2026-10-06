import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 20_000,
    // Never the person's own ~/.treeyard: tests see the defaults. Model lists come
    // from Brainyard's built-in ones, not from the Codex, Antigravity and OpenCode installed here.
    // Russian, the source language, for the CLIs the tests spawn too (see test/setup.ts).
    env: {
      TREEYARD_HOME: mkdtempSync(join(tmpdir(), 'treeyard-home-')),
      TREEYARD_LANG: 'ru',
      BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
      BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
      BRAINYARD_OPENCODE_BIN: 'treeyard-test-no-opencode',
      // Assertions match plain text; the color level of the terminal running the
      // tests must not add escape codes to the frames or to CLI output.
      FORCE_COLOR: '0',
    },
  },
});
