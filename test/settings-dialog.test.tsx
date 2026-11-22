import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { type SettingRow, SettingsDialog } from '../src/tui/dialogs.js';

afterEach(cleanup);

const rows: SettingRow[] = [
  { key: 'theme', label: 'Тема', options: [{ value: 'dark', label: 'тёмная' }], value: 'dark' },
  {
    key: 'staleAfter',
    label: 'Помечать «в работе» без сессии',
    options: [
      { value: '0', label: 'выкл' },
      { value: '1', label: '1 ч' },
    ],
    value: '0',
  },
  { key: 'notes', label: 'Куда падают замечания', value: '' },
];

function frame(width: number) {
  const app = render(<SettingsDialog rows={rows} width={width} height={30} onClose={() => {}} onChange={() => {}} />);
  return app.lastFrame() ?? '';
}

describe('settings dialog', () => {
  it('keeps a gap between the longest label and its value', () => {
    for (const width of [118, 98]) {
      const out = frame(width);
      expect(out).toContain('Помечать «в работе» без сессии  выкл');
      expect(out).toMatch(/Тема {2,}тёмная/);
    }
  });

  it('clips a label that does not fit a narrow screen instead of gluing it to the value', () => {
    const out = frame(50);
    expect(out).not.toContain('сессиивыкл');
    expect(out).toMatch(/Помечать «в[^│]*… {2}выкл/);
  });
});
