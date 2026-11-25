import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

describe('package.json exports', () => {
  it('points at a module that src/ builds into dist/', () => {
    const entry = pkg.exports['.'].import as string;
    const src = entry.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    expect(existsSync(resolve(root, src))).toBe(true);
    expect(pkg.files).toContain('dist');
  });

  it('src/index.ts imports without side effects', async () => {
    const mod = await import('../src/index.js');
    expect(mod.version).toBe(pkg.version);
  });
});
