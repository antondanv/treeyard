import { useEffect, useState } from 'react';
import stringWidth from 'string-width';

import { nextMarqueeTick } from './marquee.js';

/** The tree only renders when a title actually moves, not throughout its pauses. */
export function useMarqueeClock(
  running: { text: string; width: number } | undefined,
  selection: string,
  focused: boolean,
): number {
  const text = running?.text;
  const width = running?.width;
  const key = `${selection}:${text}:${width}:${focused}`;
  const [clock, setClock] = useState({ key, time: 0 });
  useEffect(() => {
    // Remember even an inactive selection, so returning before its first tick starts at zero.
    setClock((before) => (before.key === key ? before : { key, time: 0 }));
    if (!focused || text === undefined || width === undefined) return;
    const overflow = stringWidth(text) - width;
    if (overflow <= 0) return;
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (after = 0) => {
      const elapsed = performance.now() - start;
      const next = nextMarqueeTick(overflow, Math.max(after, elapsed));
      timer = setTimeout(
        () => {
          setClock({ key, time: next });
          schedule(next);
        },
        Math.max(1, next - elapsed),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [focused, text, width, key]);
  return clock.key === key ? clock.time : 0;
}
