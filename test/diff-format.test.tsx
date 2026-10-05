import { cleanup, render } from 'ink-testing-library';
import stringWidth from 'string-width';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePatch } from '../src/diff.js';
import { setLang } from '../src/i18n/i18n.js';
import { layoutPatch, PatchLineView } from '../src/tui/diff-patch.js';

afterEach(() => {
  cleanup();
  setLang('ru');
});

describe('readable patches', () => {
  it('counts both versions across context, insertions, deletions and separate hunks', () => {
    const patch =
      'diff --git a/a.ts b/a.ts\nindex 111..222 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -10,3 +10,4 @@ function render()\n unchanged\n-before\n+after\n+extra\n unchanged\n@@ -30 +31 @@\n-last\n+next\n';
    const lines = parsePatch(patch).filter((line) => ['context', 'add', 'remove'].includes(line.kind));
    expect(lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ['context', 10, 10],
      ['remove', 11, undefined],
      ['add', undefined, 11],
      ['add', undefined, 12],
      ['context', 12, 13],
      ['remove', 30, undefined],
      ['add', undefined, 31],
    ]);
    const layout = layoutPatch(patch, 93);
    expect(layout.rows.some((row) => row.text.includes('index 111'))).toBe(false);
    expect(layout.rows[0]!.text).toContain('10–12 → 10–13');
    expect(layout.rows[0]!.text).toContain('function render()');
  });

  it('treats --- and +++ inside a hunk as code, not file headers', () => {
    const lines = parsePatch('--- a/file\n+++ b/file\n@@ -1 +1 @@\n--- old code\n+++ new code\n');
    expect(lines.slice(0, 2).map((line) => line.kind)).toEqual(['header', 'header']);
    expect(lines.slice(-2).map((line) => [line.kind, line.text])).toEqual([
      ['remove', '-- old code'],
      ['add', '++ new code'],
    ]);
  });

  it('keeps blank added lines and trailing spaces, including at the end of a patch', () => {
    const patch = '@@ -0,0 +1,3 @@\n+    \n+\n+end   \n';
    const added = parsePatch(patch).filter((line) => line.kind === 'add');
    expect(added.map((line) => [line.newLine, line.text])).toEqual([
      [1, '    '],
      [2, ''],
      [3, 'end   '],
    ]);
    expect(layoutPatch(patch, 60).rows.at(-1)!.text).toBe('end   ');
  });

  it('emphasizes separate changed words without emphasizing unchanged code', () => {
    const lines = parsePatch(
      '@@ -4 +4 @@\n-  const enabled = false; const title = "old";\n+  const enabled = true; const title = "new";\n',
    );
    expect(lines[1]!.parts.filter((part) => part.changed).map((part) => part.text)).toEqual(['false', 'old']);
    expect(lines[2]!.parts.filter((part) => part.changed).map((part) => part.text)).toEqual(['true', 'new']);
    expect(lines[1]!.parts.map((part) => part.text).join('')).toBe(lines[1]!.text);
  });

  it('emphasizes a replacement even when Git inserts a missing-newline notice between the lines', () => {
    const patch = '@@ -1 +1 @@\n-before\n\\ No newline at end of file\n+after\n\\ No newline at end of file\n';
    const lines = parsePatch(patch);
    expect(lines[1]!.parts[0]!.changed).toBe(true);
    expect(lines[3]!.parts[0]!.changed).toBe(true);
    expect(lines.filter((line) => line.kind === 'no-newline')).toHaveLength(2);
  });

  it.each(['ru', 'en'] as const)(
    'wraps Unicode code and word emphasis without dropping indentation or text in %s',
    (lang) => {
      setLang(lang);
      const before = '    const title = "' + 'Старое 表🙂 é '.repeat(12) + '";  ';
      const after = '    const title = "' + 'Новое 表🙂 é '.repeat(12) + '";  ';
      const layout = layoutPatch(`@@ -1234 +1234 @@\n-${before}\n+${after}\n`, 70);
      for (const [kind, expected] of [
        ['remove', before],
        ['add', after],
      ] as const) {
        const rows = layout.rows.filter((row) => row.kind === kind);
        expect(rows.length).toBeGreaterThan(1);
        expect(rows.map((row) => row.text).join('')).toBe(expected);
        expect(rows[0]!.continued).toBe(false);
        expect(rows.slice(1).every((row) => row.continued)).toBe(true);
        for (const row of rows) {
          const app = render(
            <PatchLineView row={row} width={70} oldWidth={layout.oldWidth} newWidth={layout.newWidth} />,
          );
          expect(stringWidth(app.lastFrame()!)).toBeLessThanOrEqual(70);
          expect(app.lastFrame()).toContain(row.text.trimEnd());
          if (row.continued) {
            expect(app.lastFrame()).toContain('↪');
            expect(app.lastFrame()).not.toContain('1234');
          }
          app.unmount();
        }
        expect(rows.some((row) => row.parts.some((part) => part.changed))).toBe(true);
      }
    },
  );

  it('bounds word comparisons on very long lines and still preserves their full content', () => {
    const prefix = 'shared '.repeat(1000);
    const patch = `@@ -1 +1 @@\n-${prefix}before tail\n+${prefix}after tail\n`;
    const lines = parsePatch(patch);
    expect(lines[1]!.parts.filter((part) => part.changed).map((part) => part.text)).toEqual(['before']);
    expect(lines[2]!.parts.filter((part) => part.changed).map((part) => part.text)).toEqual(['after']);
    expect(lines[2]!.parts.map((part) => part.text).join('')).toBe(prefix + 'after tail');
  });
});
