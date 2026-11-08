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
