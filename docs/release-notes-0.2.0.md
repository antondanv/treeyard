# Treeyard 0.2.0

*Draft of the release notes. Changes since 0.1.1 (7 October 2026).*

0.1.1 was a tree and a launcher: you planted goals and opened agent sessions from them. 0.2.0
lets one session hand nodes out to others, follow them and talk to them. Each node can get
its own git worktree. The agents learn the tree on their own, and every agent command has
a shorter form that it can't get wrong.

[Upgrading](#upgrading) is one `npm install`. Below are the steps that are worth knowing about.

## Several sessions at once

- **`treeyard wait`** waits until a node leaves “in progress” or until its session finishes
  its turn, stops to wait for you, or ends. It prints the status, the last journal entry and
  the session's last message in full (a question or a summary) from the CLI's transcript.
  `--all` waits for every node. When the time runs out, the exit code is 124.
- **`treeyard send`** sends a message to a node's own session, not a new one. It goes into
  the project's mailbox first. treeyard then types it into an idle pane, wakes a sleeping
  one or resumes a background one; for a busy session it waits for the end of the turn. With
  `--wait` you also get the answer. `--answer` passes your reply into a question dialog.
  `--approve` and `--reject` handle a permission dialog, and only with `--as you`.
- **Messages during a turn.** `treeyard hook claude|codex|antigravity|opencode install`
  delivers waiting messages together with the next prompt and between two tool calls. A busy
  session doesn't have to finish its turn first.
- **A brake on ping-pong.** After 6 messages in a row between two nodes with no real work in
  between, the next one is held back (`mail_limit`, `--force`).
- **`treeyard queue`** starts nodes in turns: the open children of a node, in order, at most
  `--parallel` at a time. A node with `needs` starts once those nodes are in review or done.
  When a subscription window reaches `--limit` %, the queue waits for the reset.
- **Overlap warnings.** `wait` and `queue` report when two nodes at work change the same
  file, from a trial merge in memory, and write to both sessions once.
- **`open` for several nodes at once**: `treeyard open a b c --pane` (or `--bg`), with
  `--task` for an assignment on top of the node's context and `--json` for scripts.
- **`treeyard sleep`** puts a node's pane to sleep and keeps the session for later.
  **`treeyard peek`** shows the last lines of a pane's screen without attaching to it.
- **`treeyard models`** lists each CLI's models and effort levels. **`treeyard limits`**
  shows the subscription windows (read live by default, `--offline` for local snapshots).
- The new **`treeyard-coordinate`** skill teaches an agent to do all of the above: pick nodes
  that touch different files, hand them out, wait, accept the work by its diff and checks,
  merge.

## A git worktree per node

- `treeyard open <id> --worktree` (and the TUI launch form) runs a session of any CLI in the
  node's own worktree on the branch `treeyard/<id>`. The branch's commits belong to the node.
  Commands run from the worktree write to the main tree.
- `treeyard worktree` lists the worktrees, `add` and `setup` prepare one (the project's
  `setup` command and `.worktreeinclude`), and `rm <id>…` / `rm --done` removes the clean,
  merged ones.
- `.tree/README.md` gets its own merge driver, so branches that touch different nodes merge
  without conflicts in the overview.

## The tree knows more, agents type less

- The agents learn the tree by themselves. The `treeyard`, `treeyard-init` and
  `treeyard-coordinate` skills install into Claude Code, Codex and Antigravity, and each new
  version of treeyard updates them, so a plain `claude` or `codex` started in the project
  knows them too. `treeyard config skills off` turns this off.
- **`treeyard status`** shows the whole setup in one place: versions, the tree, skills, the
  block in AGENTS.md, hooks, live sessions, Codex's sandbox. Each problem comes with the
  command that fixes it.
- New commands for what agents used to do with pipes and hand edits: `find`, `show --brief`
  / `--journal N` / `--only` / `--status` / `--under`, `show` for several nodes,
  `log --status --commit` (closing in one command), `log --fix`, `set` for several nodes,
  `set needs+=` / `needs-=`, `add --from-json`, `rm`, `decide`, `goal`, `rules`,
  `treeyard commit` (tree files only), `image --note` per file.
- Statuses can be typed as words in either language or as aliases (`review`, `in review`,
  `check`). Off a terminal each line of the tree carries its status as a word.
- **The commit hook** (`treeyard hook install`) attaches a session's commits to its node by
  itself, and moves them along when the agent switches to another node.
- For programs: `show --json --all`, `treeyard watch` (one line per change of the tree),
  `treeyard docs`, `treeyard projects`, `open --json`, `sessions --json`.
- The root review now points at finished parents, open nodes under closed branches, review
  with uncommitted code, long titles, missed deadlines and waiting nodes whose return date
  has passed.

## In the TUI

- **The last launch comes first.** The node menu remembers how you launched each CLI
  (model, effort, start, place, worktree), and `treeyard open` with no flags does the same.
  `launch_memory` chooses whether this is per project or global.
- **Update notice.** A toast, `treeyard status` and `treeyard --version` say when a newer
  treeyard is in npm, with the command to install it. npm is asked at most once a day, in
  the background. `treeyard config updates off` turns it off.
- `Esc` cancels a hung “break into steps” or “write a done when” job, and a timeout stops it.
- An “in progress” node with no session and no records for `stale_after` hours (2 by
  default) is marked “no session N h”.
- The header warns when AGENTS.md / CLAUDE.md lack the block about the tree, or carry an
  outdated one. `!` fixes it.
- Before the first launch you are asked how Codex should start (`codex_access`: its sandbox
  plus treeyard and git, or your `config.toml`) and whether Antigravity gets full access
  (`antigravity_access`).
- Typing and scrolling in the agent pane respond faster, and the tree keeps drawing (slower)
  when the terminal is out of focus.

## Fixes

- A crash, `SIGTERM` or `SIGHUP` gives the terminal back clean and logs the error with the
  version. `treeyard show … | head` exits quietly instead of failing with EPIPE.
- `add`, `set` and `HEAD` work as expected from inside any git worktree.
- Long letters reach the pane in pieces that tmux 3.7 accepts. Antigravity panes and session
  bindings are found again (`treeyard sessions <id> <old> --replace <new>` repairs one by hand).
- `import` and `decide` keep a hand-written header in `tree.md`. `show --open` keeps open
  nodes under closed parents in sight.
- The package's `exports` entry pointed at a missing `dist/index.js`; the file is there now.
- Brainyard is now `^0.3.3`.

## Removing

`treeyard uninstall` removes everything treeyard put outside `.tree/`: skills, the commit
hook, mail hooks and the OpenCode plugin, and the merge driver. `--settings` removes
`~/.treeyard` too, and `--dry-run` only shows what would go.

## Upgrading

```sh
npm install -g @antondanv/treeyard@latest   # or the same with pnpm, yarn or bun
treeyard --version                          # 0.2.0
```

Node.js 22+ and tmux (for panes) as before. Your trees need no migration. What changes on
the first run:

1. **Skills install themselves.** The first `treeyard` in a folder with a tree puts the skills
   into `~/.claude/skills`, `~/.codex/skills` and `~/.gemini/config/skills`. If you'd rather do
   it by hand: `treeyard config skills off`, then `treeyard skills install` when you want it.
2. **The block in AGENTS.md is shorter now.** The TUI header says it is outdated: press `!`,
   or run `treeyard pointer`, and commit the change.
3. **`.tree/.gitattributes` appears** with the first write to the tree (the merge driver for
   the overview). Commit it with the tree, for example with `treeyard commit`.
4. **Optional:** `treeyard hook install` (commits attach to nodes by themselves) and
   `treeyard hook claude install` (or `codex`, `antigravity`, `opencode`) for messages during
   a turn. A running session may need a restart to load the hook.
5. **Check:** `treeyard status` shows what is set up and what to fix.

The full reference: [docs/reference.md](reference.md).
