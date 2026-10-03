import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { HelpDialog } from '../src/tui/dialogs.js';

const PAGE_DOWN = '\u001b[6~';
const pause = (ms = 50) => new Promise((done) => setTimeout(done, ms));

afterEach(() => cleanup());

const open = (width: number, height: number) => render(<HelpDialog width={width} height={height} onClose={() => {}} />);
const lines = (frame: string | undefined) => (frame ?? '').split('\n');

describe('help «?»', () => {
  // Body heights the app passes at 130×36 and 100×30.
  for (const [width, height] of [
    [112, 29],
    [98, 23],
  ] as const) {
    it(`fits ${width}×${height} and scrolls to the rest`, async () => {
      const { lastFrame, stdin } = open(width, height);
      expect(lines(lastFrame()).length).toBeLessThanOrEqual(height);
      expect(lastFrame()).toContain('Ходить');
      expect(lastFrame()).toContain('листать');
      expect(lastFrame()).not.toContain('скопировать id узла');
      await pause();
      stdin.write(PAGE_DOWN);
      await pause();
      expect(lines(lastFrame()).length).toBeLessThanOrEqual(height);
      expect(lastFrame()).toContain('скопировать id узла');
      expect(lastFrame()).toContain('колесо');
    });
  }

  it('shows everything without scroll hints when it fits', () => {
    const { lastFrame } = open(112, 60);
    expect(lastFrame()).toContain('Ходить');
    expect(lastFrame()).toContain('скопировать id узла');
    expect(lastFrame()).not.toContain('листать');
  });

  it('one column on a narrow screen still fits', () => {
    const { lastFrame } = open(80, 23);
    expect(lines(lastFrame()).length).toBeLessThanOrEqual(23);
  });
});
