import { useStdin } from 'ink';
import { useCallback, useSyncExternalStore } from 'react';

/** Focus reports belong to Treeyard, never to a prompt or an embedded CLI. */
export function useTerminalFocus(): boolean {
  const { stdin } = useStdin();
  const snapshot = useCallback(() => (stdin as { terminalFocused?: boolean }).terminalFocused ?? true, [stdin]);
  const subscribe = useCallback(
    (changed: () => void) => {
      stdin.on('terminal-focus', changed);
      return () => {
        stdin.off('terminal-focus', changed);
      };
    },
    [stdin],
  );
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

/** Out of focus the screen follows the agents this often: no animation, only what changed. */
export const BACKGROUND_MS = 2000;

/** Polls often return what they returned before; equal answers must not draw a frame. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
