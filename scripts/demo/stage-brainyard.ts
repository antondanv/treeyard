/**
 * Brainyard for the README's pictures: scripts/readme-screenshots.ts loads this
 * module in place of @antondanv/brainyard, so the TUI sees staged sessions,
 * panes and screens instead of real CLIs and tmux. Everything else is the real
 * Brainyard. Nothing here starts, stops or types into anything.
 */
import type { PaneInfo, PaneScreen, SessionInfo } from '@antondanv/brainyard';

export * from '@antondanv/brainyard';

export interface Stage {
  sessions: SessionInfo[];
  panes: PaneInfo[];
  /** Pane name → its screen, one string per row (ANSI colours allowed). */
  screens: Record<string, string[]>;
}

const empty: Stage = { sessions: [], panes: [], screens: {} };
const stage = (): Stage => (globalThis as { treeyardStage?: Stage }).treeyardStage ?? empty;

export const panesAvailable = () => true;
export const liveSessions = async () => stage().sessions;
export const sessions = async () => stage().sessions;
export const listPanes = async () => stage().panes;
export const paneMemory = async () => new Map(stage().panes.map((pane) => [pane.pane, 240 * 1024 * 1024]));
export const resizePane = async () => true;
export const sendToPane = async () => undefined;
export const closePane = async () => true;
export const stopSession = async () => undefined;

export async function capturePane(pane: string): Promise<PaneScreen> {
  const info = stage().panes.find((each) => each.pane === pane);
  const lines = stage().screens[pane] ?? [];
  return {
    lines,
    width: info?.width ?? 80,
    height: info?.height ?? lines.length,
    cursor: { x: 0, y: 0, visible: false },
    historySize: 0,
    scrollOffset: 0,
    mouseTracking: false,
    mouseSgr: false,
    alternate: false,
  };
}
