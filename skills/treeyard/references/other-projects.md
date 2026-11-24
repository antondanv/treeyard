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

In a git worktree, `.tree/` is the branch's copy; the person sees the main tree.
In a worktree treeyard made — or in a session opened from a node, which carries
`$TREEYARD_PROJECT` — treeyard commands write to the main tree by themselves. In another
git worktree, `treeyard status` names the main tree and the `--project <main folder>` to
pass to `show`, `find`, `add`, `log`, `set` and `diff` (`git worktree list` prints the main
folder first, too).

## Handing a node to another session

- One session per node: `treeyard open <id> --bg --task "…" [--model …] [--effort …]`. The
  session shows in the node and can be resumed from the tree.
- Not a built-in subagent: it inherits your `$TREEYARD_NODE`, its commits attach to your
  node, and the tree doesn't see it.
- Any helper still gets the node id and `--project <main folder>`.
- Coordinating several nodes at once is the job of the `treeyard-coordinate` skill, if it
  is installed.
