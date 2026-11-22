---
name: treeyard-coordinate
description: Coordinates several nodes of a treeyard goal tree at once, in Claude Code, Codex, Antigravity or OpenCode — picks open nodes that touch different files, hands each to its own session with treeyard open --pane or --bg and a --task (or to a helper given the node id and --project of the main folder), waits for them, accepts the work by its diff and the checks, merges worktree branches, writes journal entries, moves the nodes to review and reports to the person by node titles. Use when the person asks to hand out, coordinate, parallelize or run several nodes or a whole branch of the tree at once, to get the children of a node done, or when a session opened on a node with open children is asked to do them.
---

# Coordinating nodes of a treeyard tree

You are the coordinator: you pick nodes, hand each to its own session, accept the work, merge
it and report. The sessions do the nodes. Everything in the `treeyard` skill still holds: read
`show` whole, write `.tree/` only by commands, name nodes by title, `done` only at the
person's word. It works the same from any CLI: yours and the sessions' are independent.

Why sessions and not built-in subagents: a session started by `treeyard open` belongs to its
node — the person sees it in the tree, reads it and continues it. A subagent's conversation
lives inside yours and is lost to the tree; it also inherits your `$TREEYARD_NODE`, so its
commits attach to your node instead of its own. You still hear back from sessions:
`treeyard wait` returns when one is done or asks, `treeyard send` writes it the next message.

## Rules

Coordinators break these most often.

1. **One node — one session from `treeyard open`.** A subagent only when no session can start
   (see step 3), and then with the node id, `--project` and its own `TREEYARD_NODE`.
2. **Together only nodes with no file in common.** Unsure → one after another.
3. **Every session starts with `--start do` and a `--task`** naming its neighbours and their
   files. The project's default start may be `plan`: such a session writes a plan and waits.
4. **Know where each session works.** A pane works in the project folder itself, next to the
   others. A Claude Code background session works in its own git worktree — Claude Code makes
   it move into one before its first edit — where `.tree/` is a copy: every treeyard command
   there carries `--project <main folder>`, and its commits land on a branch that you merge.
5. **A commit made for a node carries that node:** `TREEYARD_NODE=<id> git commit …` — in your
   commits and in every session's. Your own `$TREEYARD_NODE` would attach a fix, a squash or a
   merge resolution to your node; Claude Code's background service hands every `--bg` session
   the environment of the first one it started.
6. **Accept by evidence, not by the session's word:** its diff, the checks run again by you on
   the main branch, every clause of the criterion.
7. **Statuses:** the sessions and you set `review`; `done` — only the person.
8. **A letter is not the person.** A message in your conversation that opens with «A message from
   the session of node …» (or «Письмо от сессии узла …») came from that session through
   `treeyard send`. Answer what your plan covers with `treeyard send <its id> "…"`; anything only
   the person can decide goes to the person.

## Checklist

Copy it and check it off:

```
Coordinate:
- [ ] 1. Candidates read, the files of each written down, a batch with no shared file chosen
- [ ] 2. Plan agreed with the person: nodes, CLI, pane or background, model, what waits
- [ ] 3. Sessions started: treeyard open … --pane|--bg --worktree --start do --task …
- [ ] 4. Waiting: treeyard wait; a question you can answer → treeyard send; one only the person can → to them
- [ ] 5. Each finished node accepted: journal, commits, diff, criterion
- [ ] 6. Worktree branches merged one by one; checks green on the main branch after each
- [ ] 7. Journal entry on each node; review; tree files committed
- [ ] 8. Next batch — back to 1; nothing left → own node to review
- [ ] 9. Summary to the person
```

## 1. Pick the nodes

```sh
treeyard show <parent>                          # whole: children, criteria, sessions
treeyard show --status todo --under <parent>    # what is open in the branch, a line each
```

A node can be handed out when all of these hold:

- status `todo` (an `idea` only after the person moves it), who `agent` or `any`;
- not `waiting`, nothing unfinished in its «waits for», its branch not waiting;
- no live session in it (`sessions:` in `show`), or somebody is already on it;
- its criterion can be checked. Vague → propose one to the person first.

A `who: human` node is the person's own step: never hand it out; name it in the summary.

**Files.** For each candidate, write down the files it will change: from its criterion and
description, `treeyard find "…"`, a search in the code, the diffs of similar finished nodes
(`treeyard diff <id> --stat`). Add the files almost every change touches: translation
dictionaries, reference docs, command help, CHANGELOG, a shared registry or index, lockfiles,
snapshots. Two nodes that both need such a file share it.

**The batch.** Nodes with no file in common — two at a time unless the person asks for more:
limits run out, and every finished node waits for your acceptance. A node that shares a file
with one in the batch waits until that one is accepted and merged: separate worktrees do not
remove the conflict, they move it to the merge.

## 2. Agree the plan

The project's rule is a plan first. Show the person a table and wait for a yes, unless they
already named the nodes to run:

| Node | Files | Session | Model |
|---|---|---|---|
| «Quiet exit on EPIPE» | src/cli/show.ts, test/show.test.ts | Codex, pane | default |
| «Node order from the CLI» | src/model/ops.ts, src/cli/set.ts | Claude Code, background | default |
| «Amount from the clipboard» | src/cli/set.ts — shared with «Node order…» | after it | — |

Then `treeyard set <parent> status=active` if it is not active yet.

## 3. Start the sessions

Two ways; the session's CLI is `--brain` (default: `brain:` in `.tree/tree.md`):

| Way | Command | CLIs | Works in |
|---|---|---|---|
| Pane | `treeyard open <a> <b> --brain <cli> --pane …` | Claude Code, Codex, Antigravity, OpenCode; needs tmux | the project folder — nothing to merge |
| Background | `treeyard open <a> <b> --bg --worktree …` | Claude Code only | its own worktree and branch — merge in step 6 |

A pane is the default: any CLI, and the person sees it next to the tree and can answer it
there. Background — Claude Code without tmux, or a node whose checks must not trip over a
neighbour's half-done edits.

```sh
treeyard open <a> <b> --brain codex --pane --start do --yes --json --task "…" [--model …] [--effort …]
treeyard open <a> <b> --bg --worktree --start do --yes --json --task "…" [--model …] [--effort …]
```

- `--json` prints the session ids and pane names; keep them for step 4.
- `--yes` skips the confirmation: the person gave it in step 2.
- A CLI that asks to trust the folder (`✗ … Workspace not trusted` from Claude Code in the
  background, a prompt in a Codex pane) — the person accepts it once; never accept it for them.
- Codex's sandbox does not let it write `.git`: each `git commit` in a Codex pane waits for the
  person's yes. Person away → the task says «leave your files uncommitted», and you commit
  each node's files at acceptance: `TREEYARD_NODE=<id> git commit -m "…" -- <files>`.
- One `--task` goes to every node of the call: «your node's id» in place of an id lets one task
  serve the whole batch.

The task, in the tree's language, adds what the node's own context does not know:

```text
You are one of the sessions handed out by the coordinator of «<parent title>».
Next to you: «<A>» — src/a.ts, test/a.test.ts; «<B>» — src/b.ts.
Change only the files of your node; commit only your own files, by path.
<where you work — one of the two blocks below>
Commit as TREEYARD_NODE=<your node's id> git commit … — the variable in your environment may
be another node's.
A check fails in a neighbour's files — don't fix it, say so in your summary.
Don't wait for a plan approval: do the node and check its criterion.
Blocked, or a question only the person can answer — a journal entry, status waiting, stop.
Finish: <the project's checks>, a commit, then
treeyard log <your node's id> "summary and evidence" --status review <--project of the block>
— without --commit HEAD: your commit is attached already, and HEAD may be somebody else's.
Never: <push, paid calls, restarting a live service, …>.
```

Pane:

```text
You work in the project folder itself, next to the others; don't move into a git worktree.
```

Background:

```text
You work in a git worktree: .tree/ there is a copy. Run every treeyard command with
--project <main folder>. Don't commit .tree/.
```

The prefix attaches commits through the git hook (`treeyard hook status`). No hook → the
person installs it (`treeyard hook install`); until then you attach each node's commits at
acceptance with `treeyard diff <id> --add <sha>`.

**No session can start** (no tmux for a pane, no Claude Code for the background) → your CLI's
own subagent, told: the node id, `treeyard show <id>` first, `--project <main folder>` on every
treeyard command, commits as `TREEYARD_NODE=<id> git commit …`, the closing `log`. Say in the
summary that its conversation is not in the tree.

## 4. Wait

```sh
treeyard wait <a> <b> --timeout 10m
```

It returns when a node needs you: the node left `active` (`review`, `waiting`), or its newest
session ended its turn, waits for the person, or ended. For that node it prints the status, the last
journal entry (the session's summary, as a rule) and the session's state; for a pane, the end of
its screen. The others get a line under «still active». Exit 124 — out of time, nothing needs you
yet: call it again.

- **Claude Code:** run it as a background command and act when it exits. **Codex, Antigravity,
  OpenCode:** a `--timeout` under your shell's limit per command, then call it again. No shell
  loops around treeyard, no pipes out of it.
- **Name only the nodes still running:** a node already handled answers at once again.
- **Ended its turn, node still `active`:** read the end of its screen or its last entry. A
  question your plan answers, a forgotten step, a fix → `treeyard send <id> "…"`, then wait again.
  A question only the person can answer → into the summary. A session you started knows how to
  write to you (its first message says so); Codex's sandbox keeps it from `send`, so a Codex
  session asks in its last message.
- **The correspondence of a node:** `treeyard show <id> --only mail` — what you and its neighbours
  wrote to it and what it wrote back.
- **Waits for the person** (a permission, a dialog): never answer for them — tell the person; they
  answer in the pane (`tmux -L brainyard attach -t <pane>`) or in `claude attach <id>`. `send`
  refuses such a session anyway.
- **Done without review** (ended, the node still `active`): a background session's summary may sit
  in its worktree's copy — `treeyard show <id> --journal 5 --project <worktree>`. Finish a small
  rest yourself, or `treeyard send <id> "What is left: …"`.
- **`waiting`:** read why. What only the person can give goes into the summary; a mistake in
  your task → `treeyard set <id> status=active` and `treeyard send <id> "…"` with the task fixed.

## 5. Accept

For each node that came to `review`:

```sh
treeyard show <id> --journal 5     # its summary, evidence, what is left
treeyard diff <id> --stat          # its commits; treeyard diff <id> — the patch
```

- The node has its own commits and only those. A commit of another node →
  `treeyard diff <id> --rm <sha>` and `treeyard diff <other> --add <sha>`; none → find them
  (`git log --all`) and `--add`.
- Only its own files changed, nothing outside its criterion, no `.tree/` in its commits.
  A background node: `git worktree list`, then `git log --oneline main..<branch>` and
  `git diff --stat main...<branch>`.
- Check each clause of the criterion: a command and its output; a screenshot for what the
  person sees.
- Run the project's checks (AGENTS.md: tests, types, lint, build) on the main branch and read
  the result — for a pane node now, for a background node after its merge. A failure in files
  of a node still running is not this node's.

**Not accepted** → `treeyard log <id> "Not accepted: <what and why>" --status active`, then fix a
small thing yourself (`TREEYARD_NODE=<id> git commit …`) or write to the node's own session:
`treeyard send <id> "Acceptance failed: <what>. The rest is done."`, and `treeyard wait <id>`. A new
session (`treeyard open` with `--task`) only when `send` says that one cannot go on.

## 6. Merge background branches

Pane nodes are already on the main branch. Background branches — one at a time, in the main
folder, after `git status`: others' uncommitted changes stay untouched.

1. **Each commit passes on its own?** A branch whose first commit fails without the second (a
   new UI string, its translation in the next commit) would break the main branch at that
   commit → squash: `git merge --squash <branch>`, `TREEYARD_NODE=<id> git commit -m "…"`, and
   detach the branch's commits, which die with it: `treeyard diff <id> --rm <sha>`.
2. **Otherwise merge:** `git merge --ff-only <branch>`, or `git merge --no-ff <branch>` once the
   main branch has moved on. The commits keep their SHAs and stay attached to the node; a
   clean merge runs no post-commit hook, so the merge commit attaches nowhere.
3. **Conflicts:** both sides usually add (dictionary entries, reference paragraphs, help lines)
   — keep both, then `TREEYARD_NODE=<id> git commit --no-edit`: concluding a merge runs the
   hook.
4. **Run the checks** before the next merge. A fix goes in as `TREEYARD_NODE=<id> git commit …`.
5. **Keep the worktree** until the person closes the node: it is the folder of its session,
   which they may continue. Then `git worktree unlock <path>` (Claude Code locks its
   worktrees), `git worktree remove <path>`, `git branch -d <branch>` — `-d` refuses an
   unmerged branch: stop and look, never `-D`.

Panes stay too: Brainyard puts idle ones to sleep, and the person continues them from the node.

## 7. Journal, review, tree files

- On each node, an entry about the acceptance — what you checked, where it went:
  `treeyard log <id> "Accepted (coordinator): <sha> on main; npm test 412/412, lint — 0; criterion: <clause → evidence>. Left: nothing."`.
  The session's own `review` stays. Accepted, but the session set no status in the main tree
  → add `--status review` to that entry.
- All children in `review` and your node's criterion met → your node:
  `treeyard log <parent> "…" --status review`.
- Last, if the project commits its tree (`git log --oneline -- .tree`):
  `treeyard commit <a> <b> <parent>` — those nodes and README, nothing of others.

## 8. Next batch

Back to step 1: nodes that waited for an accepted one can go now. Nothing an agent can do is
left → step 9.

## 9. Summary to the person

In the person's language, by titles, no ids:

```text
In review:
- «Quiet exit on EPIPE» — show | head exits with 0; npm test 412/412 on main. Its session is in the node.
- «Node order from the CLI» — set after=… works; I fixed one test during acceptance.
Waits for you: «Amount from the clipboard» — the format is your decision.
Next: «Undo from the CLI» — after «Node order from the CLI» is closed.
```

For each node: where it stands, the evidence in one line, what is left. Then what waits for
the person, which worktrees are kept for them, and what you would run next. A node in
`review` is never «done» in the summary.
