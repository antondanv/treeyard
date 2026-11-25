# Other projects, worktrees, other sessions

## Another project's tree

The commands take `--project <folder>`, relative to this project:

- `treeyard show --project ../X` — its open tree; `treeyard show <id> --project ../X --brief`
- `treeyard log <id> "…" --project ../X` — a journal entry there
- `treeyard set <id> status=… --project ../X` — a status there
- `treeyard diff <id> --project ../X --add HEAD` — attach a commit of X's repository
- `treeyard set <your id> needs=../X#<id>` — link your node to a node that already exists
  in X

A shared node (made with `add --project ../X --for <id>`) closes by itself when the person
sets your node `done`. If you did its work yourself, close it right away with
`treeyard set <id> status=done --project ../X`.

## Git worktrees

In any git worktree of the project — one treeyard made, Claude Code's own, `git worktree add` —
treeyard commands read and write the main tree the person sees, found through git's common dir;
the branch's `.tree/` is a copy nobody reads. Only `--project .` (or the worktree's path) targets
that copy, and a worktree whose main folder has no tree keeps its own. `treeyard status` names
the tree in use.

## Handing a node to another session

- One session per node: `treeyard open <id> --pane --task "…" [--brain <cli>] [--model …] [--effort …]` (Claude Code also supports `--bg` for background runs). The
  session shows in the node and can be resumed from the tree.
- Not a built-in subagent: it inherits your `$TREEYARD_NODE`, its commits attach to your
  node, and the tree doesn't see it.
- Any helper still gets the node id and `--project <main folder>`.
- Coordinating several nodes at once is the job of the `treeyard-coordinate` skill, if it
  is installed.
