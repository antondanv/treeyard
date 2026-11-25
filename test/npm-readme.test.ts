import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { repoBases, toAbsoluteLinks } from '../scripts/npm-readme.mjs';

const bases = repoBases({ version: '0.2.0', repository: { url: 'git+https://github.com/antondanv/treeyard.git' } });

describe('npm README links', () => {
  it('builds bases from repository.url and the version tag', () => {
    expect(bases.blob).toBe('https://github.com/antondanv/treeyard/blob/v0.2.0/');
    expect(bases.raw).toBe('https://raw.githubusercontent.com/antondanv/treeyard/v0.2.0/');
  });

  it('rewrites images, files and directories, keeps the rest', () => {
    const src = [
      '<img src="docs/logo.png" width="420" alt="x">',
      '[Русский](README.ru.md) [ref](docs/reference.md#keys) [skills](skills/)',
      '![shot](docs/screenshot.png "t")',
      '[a](#anchor) [b](https://example.com/x) [c](LICENSE) [d](mailto:a@b.c)',
      '[![license](https://img.shields.io/x)](LICENSE)',
      '```md',
      '[kept](docs/practice.md)',
      '```',
    ].join('\n');
    const out = toAbsoluteLinks(src, bases).split('\n');
    expect(out[0]).toContain('src="https://raw.githubusercontent.com/antondanv/treeyard/v0.2.0/docs/logo.png"');
    expect(out[1]).toContain('(https://github.com/antondanv/treeyard/blob/v0.2.0/README.ru.md)');
    expect(out[1]).toContain('(https://github.com/antondanv/treeyard/blob/v0.2.0/docs/reference.md#keys)');
    expect(out[1]).toContain('(https://github.com/antondanv/treeyard/tree/v0.2.0/skills/)');
    expect(out[2]).toBe('![shot](https://raw.githubusercontent.com/antondanv/treeyard/v0.2.0/docs/screenshot.png "t")');
    expect(out[3]).toContain('(#anchor)');
    expect(out[3]).toContain('(https://example.com/x)');
    expect(out[3]).toContain('(https://github.com/antondanv/treeyard/blob/v0.2.0/LICENSE)');
    expect(out[3]).toContain('(mailto:a@b.c)');
    expect(out[4]).toBe(
      '[![license](https://img.shields.io/x)](https://github.com/antondanv/treeyard/blob/v0.2.0/LICENSE)',
    );
    expect(out[6]).toBe('[kept](docs/practice.md)');
  });
});
