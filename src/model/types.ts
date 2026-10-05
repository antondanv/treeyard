/**
 * The tree of a project. It lives in the project itself, in `.tree/`:
 *
 * - `tree.md` — the root: the project's goal, how the tree is run, rules for
 *   agents, decisions;
 * - `nodes/<id>.md` — one file per node: front matter for what a program
 *   reads, markdown for what a person writes, a journal at the end.
 *
 * One file per node, so two agents in two branches touch two different files,
 * and a merge does not conflict. Keys and values in the front matter are
 * English — a stable contract for agents and scripts; everything a person
 * reads is Russian.
 */

/** Where a node is. */
export type Status = 'idea' | 'todo' | 'active' | 'waiting' | 'review' | 'done' | 'dropped';

export const STATUSES: readonly Status[] = ['idea', 'todo', 'active', 'waiting', 'review', 'done', 'dropped'];

/** Who can do it: an agent, only you (a contract, a lawyer, a real user), or either. */
export type Who = 'agent' | 'human' | 'any';

export const WHO: readonly Who[] = ['agent', 'human', 'any'];

// OpenCode comes from Brainyard 0.2 in sessions and live lists; Treeyard does not start it yet.
export type BrainId = 'claude' | 'codex' | 'antigravity' | 'opencode';

/** A CLI session opened for a node. The id is what that CLI resumes. */
export interface SessionRef {
  brain: BrainId;
  id: string;
  /** What the session was called when it started. */
  name?: string;
  /** ISO time. */
  started?: string;
  /** ISO time of the last time it was opened from the tree. */
  opened?: string;
  mode?: 'terminal' | 'background' | 'pane';
  /** `pane`: the tmux session it runs (or last ran) in. */
  pane?: string;
}

export interface TreeNode {
  id: string;
  title: string;
  /** `root` for a top-level node. */
  parent: string;
  /** Position among siblings of the same status; gaps of 10 leave room. */
  order: number;
  status: Status;
  who?: Who;
  /** What has to be true to call it done — something you can see or run. */
  doneWhen?: string;
  /** A command that proves it (`npm test`, `curl -f …/health`). */
  check?: string;
  /** Status `waiting`: what it waits for. */
  waiting?: string;
  /** Status `waiting`: when to come back to it. */
  until?: string;
  /** Nodes in other projects' trees this one waits for: `../Brainyard#hv95`, the path from the project's folder. */
  needs?: string[];
  /** The other side of `needs`: nodes elsewhere that wait for this one (`for` in the file). */
  neededBy?: string[];
  sessions: SessionRef[];
  /** Explicit Git commit IDs whose patches belong to this node. */
  commits?: string[];
  /** YYYY-MM-DD. */
  created?: string;
  /** ISO time. */
  updated?: string;
  /** YYYY-MM-DD it became done or dropped. */
  closed?: string;
  /** Markdown after the front matter: description, notes, `## Журнал`. */
  body: string;
  /** Front matter keys this version does not know: kept as they are. */
  extra: Record<string, unknown>;
}

export interface Project {
  /** The folder with `.tree/` in it. */
  dir: string;
  title: string;
  /** The root's finish line: how you know the project did its job. */
  goal?: string;
  /** Template the tree was started from. */
  template?: string;
  /** Defaults for sessions started from the tree. */
  brain?: BrainId;
  model?: string;
  effort?: string;
  /** How a new session starts: `plan`, `do`, `goal` or `chat`. */
  start?: StartMode;
  /** Model for an agent's small jobs (steps, criterion): a cheaper one saves the subscription. */
  assistModel?: string;
  /** YYYY-MM-DD. */
  created?: string;
  /** Markdown: how the tree is run, rules for agents, decisions. */
  body: string;
  extra: Record<string, unknown>;
}

/** The first message of a session started from a node. */
export type StartMode = 'plan' | 'do' | 'goal' | 'chat';

export const START_MODES: readonly StartMode[] = ['plan', 'do', 'goal', 'chat'];

export interface Tree {
  project: Project;
  nodes: Map<string, TreeNode>;
  /** Problems found while reading: kept going, but worth showing. */
  problems: string[];
}

export const ROOT = 'root';
