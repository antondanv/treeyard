import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    testTimeout: 20_000,
    // Never the person's own ~/.treeyard: tests see the defaults. Model lists come
    // from Brainyard's built-in ones, not from the Codex and Antigravity installed here.
    env: {
      TREEYARD_HOME: mkdtempSync(join(tmpdir(), 'treeyard-home-')),
      TREEYARD_LANG: '',
      BRAINYARD_CODEX_BIN: 'treeyard-test-no-codex',
      BRAINYARD_AGY_BIN: 'treeyard-test-no-agy',
      // Assertions match plain text; the color level of the terminal running the
      // tests must not add escape codes to the frames or to CLI output.
      FORCE_COLOR: '0',
    },
  },
});
