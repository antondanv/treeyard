import { describe, expect, it } from 'vitest';

import { highlight, ordered, rowSpan, selectedText } from '../src/tui/selection.js';

const screen = ['\u001b[31mhello\u001b[0m from the CLI   ', '', '你好 wide', 'last row'];

describe('selecting on a session screen', () => {
  it('reads like a terminal: the first row from the start, middle rows whole, the last up to the end', () => {
    const across = { from: { x: 6, y: 0 }, to: { x: 1, y: 2 } };
    expect(selectedText(screen, across)).toBe('from the CLI\n\n你');
    // Dragged up and to the left: the same text.
    expect(selectedText(screen, { from: across.to, to: across.from })).toBe('from the CLI\n\n你');
    expect(selectedText(screen, { from: { x: 0, y: 0 }, to: { x: 4, y: 0 } })).toBe('hello');
  });

  it('takes a wide character half inside, and nothing past the text', () => {
    expect(selectedText(screen, { from: { x: 1, y: 2 }, to: { x: 2, y: 2 } })).toBe('你好');
    expect(selectedText(screen, { from: { x: 40, y: 0 }, to: { x: 50, y: 0 } })).toBe('');
  });

  it('knows each row’s selected columns', () => {
    const selection = ordered({ from: { x: 5, y: 3 }, to: { x: 2, y: 1 } });
    expect(selection.from).toEqual({ x: 2, y: 1 });
    expect(rowSpan(selection, 0)).toBeUndefined();
    expect(rowSpan(selection, 1)).toEqual([2, Number.POSITIVE_INFINITY]);
    expect(rowSpan(selection, 2)).toEqual([0, Number.POSITIVE_INFINITY]);
    expect(rowSpan(selection, 3)).toEqual([0, 6]);
  });

  it('inverts the selected cells, keeps colours, and shows the selection past the text', () => {
    expect(highlight('\u001b[31mhello\u001b[0m world', [3, 8], 20)).toBe(
      '\u001b[31mhel\u001b[7mlo\u001b[0m\u001b[7m wo\u001b[27mrld',
    );
    expect(highlight('ab', [0, Number.POSITIVE_INFINITY], 5)).toBe('\u001b[7mab   \u001b[27m');
    expect(highlight('ab', [4, 6], 8)).toBe('ab  \u001b[7m  \u001b[27m');
    expect(highlight('你好', [1, 2], 10)).toBe('\u001b[7m你\u001b[27m好');
  });
});
