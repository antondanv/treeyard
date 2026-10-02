/**
 * Clicks: one listener for the whole screen finds the innermost box under
 * the pointer. A click on a key hint presses that key, so the mouse can
 * never do something the keyboard does not.
 */
import { Box, type BoxProps, type DOMElement, measureElement, useStdin } from 'ink';
import { createContext, type ReactNode, type RefObject, useContext, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from './input.js';

/** Where in the box the click landed; `double` is the second click of a double click. */
export interface Click {
  x: number;
  y: number;
  double: boolean;
}

interface Target {
  box: RefObject<DOMElement | null>;
  onClick: { current: (click: Click) => void };
  active: { current: boolean };
}

const DOUBLE_MS = 400;
const Targets = createContext<Set<Target> | undefined>(undefined);

export function MouseProvider(props: { children: ReactNode }) {
  const { stdin } = useStdin();
  const [targets] = useState(() => new Set<Target>());
  useEffect(() => {
    let last: { x: number; y: number; at: number; target: Target } | undefined;
    const mouse = (event: MouseEvent) => {
      // Only a press of the left button: releases, wheel and motion belong to others.
      if (event.release || event.button & 96 || (event.button & 3) !== 0) return;
      const now = Date.now();
      if (last && now - last.at <= DOUBLE_MS && last.x === event.x && last.y === event.y) {
        // The first click may have moved the list: the second goes where the first went,
        // unless the first one closed it (a picked menu, a pressed button).
        const { target } = last;
        last = undefined;
        if (targets.has(target) && target.active.current)
          target.onClick.current({ ...within(target, event), double: true });
        return;
      }
      const target = hit(targets, event.x, event.y);
      last = target ? { x: event.x, y: event.y, at: now, target } : undefined;
      target?.onClick.current({ ...within(target, event), double: false });
    };
    stdin.on('mouse', mouse);
    return () => {
      stdin.off('mouse', mouse);
    };
  }, [stdin, targets]);
  return <Targets.Provider value={targets}>{props.children}</Targets.Provider>;
}

function within(target: Target, event: MouseEvent): { x: number; y: number } {
  const bounds = target.box.current ? measureElement(target.box.current) : { x: 0, y: 0 };
  return { x: event.x - bounds.x, y: event.y - bounds.y };
}

/** The smallest active box under the pointer: a button inside a row wins over the row. */
function hit(targets: Set<Target>, x: number, y: number): Target | undefined {
  let best: { target: Target; area: number } | undefined;
  for (const target of targets) {
    if (!target.active.current || !target.box.current) continue;
    const b = measureElement(target.box.current);
    if (x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height) continue;
    const area = b.width * b.height;
    if (!best || area <= best.area) best = { target, area };
  }
  return best?.target;
}

/** Calls `onClick` for clicks on the box. Outside a `MouseProvider` it does nothing. */
export function useClick(box: RefObject<DOMElement | null>, onClick: (click: Click) => void, active = true): void {
  const targets = useContext(Targets);
  const handler = useRef(onClick);
  handler.current = onClick;
  const enabled = useRef(active);
  enabled.current = active;
  useEffect(() => {
    if (!targets) return;
    const target: Target = { box, onClick: handler, active: enabled };
    targets.add(target);
    return () => {
      targets.delete(target);
    };
  }, [targets, box]);
}

/** A box that answers clicks. */
export function Clickable(
  props: BoxProps & { onClick: (click: Click) => void; active?: boolean; children?: ReactNode },
) {
  const { onClick, active, children, ...box } = props;
  const ref = useRef<DOMElement>(null);
  useClick(ref, onClick, active ?? true);
  return (
    <Box ref={ref} {...box}>
      {children}
    </Box>
  );
}

/** Types a key as if from the keyboard. Silent when the input cannot take it (tests, snapshots). */
export function usePress(): (data: string) => void {
  const { stdin } = useStdin();
  return (data: string) => (stdin as { press?: (data: string) => void }).press?.(data);
}
