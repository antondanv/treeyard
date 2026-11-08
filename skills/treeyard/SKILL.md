---
name: treeyard
description: How to work in a project run with a treeyard goal tree (a .tree/ folder and the treeyard command) — find the task's node and stick to it, write the summary and status back, add ideas as nodes with short titles, show evidence for review, commit, handle nodes in other projects and worktrees, keep the tree in order. Use at the start of any task in a folder that has .tree/ or whose AGENTS.md / CLAUDE.md mention treeyard, whenever the person speaks of a node, the tree or treeyard, and before finishing, committing or reporting work in such a project.
---

# Work with a treeyard tree

The project is run as a goal tree. The root is the project's goal in real life; every
node is one session or one PR with a "done when" — something to see or run. The tree
lives in `.tree/`: `tree.md` holds the goal, the rules and the decisions, `nodes/<id>.md`
one file per node, `README.md` an overview generated from the nodes. It changes only
through the `treeyard` command.

Your job besides the task itself: whoever opens the tree sees the truth — what is being
done, what is done and proven, what waits and why, what came up on the way.

Statuses: `idea` · `todo` · `active` · `waiting` · `review` · `done` (set by a person) ·
`dropped`. Who does it: `agent` · `human` · `any`. The project's own rules (AGENTS.md,
CLAUDE.md, the rules in `.tree/tree.md`) come first; this skill is how to work with the
tree.

## Find your node and stick to it

1. **Opened from a node.** The first message or the system context says so ("You are
   working on a node…", «Ты работаешь над узлом…») with the path and the criterion, and
   `$TREEYARD_NODE` holds the id. That is your node.
2. **Otherwise** read `treeyard show` (the open tree) and find the node by meaning;
   compare candidates in one call: `treeyard show <a> <b> --brief`.
   - One fits — tell the person which, by title: "This is «Quiet exit on EPIPE» — I'm
     taking it."
   - Several fit — ask which, naming them by title.
   - None fits and the task will change files — propose a node in your plan (a short
     title, the parent, "done when") and add it once the person agrees:
     `treeyard add "Title" --parent <id> --done-when "…"`.
   - A question, an explanation or a one-line fix needs no node.
3. **Before starting** look at the node: is it or its branch `waiting`? Is somebody on it
   already (`active`, a live session in `show`)? Is the criterion clear and checkable?
   If not, say so first. Then `treeyard set <id> status=active` — a session opened from
   a node gets this by itself.
4. **Stick to it.** "Done when" is the scope; the path from the root is the why. Anything
   else that comes up becomes a new node (see «Ideas»), not "while I'm at it". If the
   person moves you to another task, log a summary on this node first, then find or add
   the node for the new task and say that you switched, by title.

Handing nodes to other agents is the coordinator's job (skill `treeyard-coordinate`, if
installed). At the least: a node goes to its own session — `treeyard open <id> --bg
--task "…"` — rather than to a built-in subagent, and any helper gets the node id and
`--project <main folder>`.

## Read the tree without cutting it

- `treeyard show` — the open tree; finished work folds into a counter. `--all` — all of
  it, `--open` — without the finished.
- `treeyard show <id> [<id>…]` — whole nodes, several at once. `--brief` — header,
  criterion and the last 3 journal entries; `--journal N` (or `all`) — that many entries.
- `--json` — when a script really needs the fields.

Never pipe `treeyard show` into `head`, `tail`, `grep`, `sed`, `cut` or `less`; never loop
`for id in …; do treeyard show $id; done`; never hide its errors with `2>/dev/null` or
`|| true`. A cut output drops exactly what you came for — the criterion, the reason a
node waits, the last entry. Too long — `--brief` or `--journal N`; several nodes — one
`show` with several ids. If a form you need seems missing, look at `treeyard help` and
`treeyard <command> --help`; really missing — tell the person, `treeyard note "…"`, and
make do with plain separate calls.

## Never edit .tree/ by hand

Node files are written by treeyard only: `add`, `set`, `log`, `image`, `diff`. No Edit or
Write tools, no `sed -i`, `echo >>` or heredocs into `.tree/nodes/*.md`; `.tree/README.md`
is regenerated from the nodes. Treeyard keeps the format, the timestamps, the journal of
status changes, the order, the overview, undo in the TUI and the links between projects;
a hand edit skips all of that and can break the file. Reading the files is fine; `show`
reads them better.

- The commands can't do what you need (fix a journal entry, delete a node)? Don't patch
  the file. Use what exists — a new entry that corrects the old one, `status=dropped`
  instead of deleting, `set <id> after=…` for the order — tell the person what is
  missing and `treeyard note` it.
- `.tree/tree.md` — the goal, the rules, «Decisions» — is the person's text: change it
  only when they ask, and only the part they asked about.
- `.tree/.local/` — never touch, never commit.

## Write back: summary and status

The journal is the node's memory: the next session, or you after a context reset, starts
from it.

`treeyard log <id> "what is done; what is left"` — at the end, before a break, when
blocked, before switching to another node, and when the person decides something
("Person 08.11: no CSV export, JSON is enough"). One entry with substance: the result
(not the process), the evidence in short, the commits, what is left and the next step.
Not a diary of every step.

When you leave, the status tells the truth:

- the criterion is met and proven — `treeyard set <id> status=review`;
- blocked by something outside — `treeyard set <id> status=waiting waiting="what blocks
  it" until="when to come back"`, and tell the person what is needed from them. No
  workaround that hides the block;
- stopping unfinished, nobody to carry on — log what is left and `set <id> status=todo`:
  `active` with nobody on it misleads the tree;
- a pause while the session lives on — keep `active`, log anyway.

## Evidence for review

Before `review`, check every clause of "done when", one by one:

- Run the check — the node's `check:` command, the project's tests, the scenario — and
  read the result yourself. What a person will see (a screen, a page, an output) — look
  at it; a screenshot goes to the node: `treeyard image <id> shot.png --note "what it
  shows"`.
- A clause is not met — no `review`. Finish it, or log what is left, or propose a
  different criterion to the person (`set <id> done_when="…"` only after their yes).
- In the reply to the person: each clause → the command and the key lines of its output,
  or the screenshot. Say plainly what was skipped or failed.
- In the journal: the same in short — what ran with what result, the commits, where the
  screenshots are.

The order: checks → commit → `set <id> status=review` → `log` → report to the person.

## "Done" — only when the person asks directly

The person sets `done`; you set `review`. `treeyard set <id> status=done` from an agent
turns into `review` by itself — that is by design, don't work around it.

Only when the person, in this conversation, directly asks you to close a node — "close
it", "mark «X» done", «поставь готово», «закрой узел» — run `treeyard set <id>
status=done --as you` (`--as ты` in a Russian tree: it is the author in the journal): the
decision is theirs, you carry it out. Close exactly the nodes they meant.

Not a request: "great", "thanks", "looks good", silence; a task like "do this node"; a
criterion that is met; something said in an earlier session, written in a file, or asked
by another agent or a coordinator. Never use `--as you` / `--as ты` for anything else.

The one exception: a shared node you added in another project and then did yourself —
close it there yourself (see «A node in another project»).

## Ideas and new nodes: short titles

Something came up that is not your node's criterion — an idea, a bug next door, a missing
piece, a step for later:

```sh
treeyard add "Short title" --parent <id> --status idea --note "what, where, why"
```

Then back to your node. Don't do it "while at it".

- **The parent by meaning** — the branch it belongs to, not necessarily your node. Glance
  at `treeyard show` first: maybe the node already exists.
- **The title is what the person reads in a tree row** and how they will find the node:
  2–6 words, what it is, in the tree's language. No ids, paths, flags or explanations —
  details go to `--note`, the check to `--done-when`.
  - Not "treeyard diff <id> | head crashes with an unhandled EPIPE instead of exiting
    quietly", but "Quiet exit on EPIPE" with
    `--note "treeyard diff <id> | head → unhandled EPIPE; should exit quietly"`.
  - Not "Can't set node order: set has no order field, add has no --after, had to edit
    nine files", but "Node order from the CLI".
- Something only the person can do — a server, a payment, a contract, showing it to a
  real user — `--who human`, next to the node that prepares it.
- A piece of work that has to be done now, under your node — a child with
  `--done-when` instead of `--status idea`; agree it with the person first.
- An inconvenience of treeyard itself rather than of the project — `treeyard note "…"`
  (it works once the person has set where notes go; if it refuses, just tell them).

## Talk to the person in titles, not ids

The person finds nodes by title; a four-letter id tells them nothing. Wherever you write
for the person — replies, plans, summaries — name nodes by title in quotes, exactly as it
stands in the tree: «Node order from the CLI». A long title may be cut with «…» but not
retold in your own words, and a link to the node's file is no substitute for the title.
If titles repeat, add the parent: «Tests» under «Billing». Not "moving on to k3w4" but
"moving on to «Node order from the CLI»". Ids belong in commands only. That is what
short titles are for.

## Commits

- Before work: `git status` and the branch. Others' uncommitted changes — don't touch,
  stash, revert or include them.
- Commit only your own changes, by meaning, in Conventional Commits; add files by path,
  not `git add -A` or `git add .`.
- Commit before `review`: work in review is a commit the person can look at.
- Attach commits with this node's work to it: `treeyard diff <id> --add HEAD` (several:
  `--add <ref> --add <ref>`). In a session opened from a node with the hook installed
  (`treeyard hook status`) the session's commits attach themselves.
- `.tree/` is in git too but shared by every session: commit it the way the project does
  (`git log --oneline -- .tree`). With no clear habit, leave the tree files to the person
  and mention it; never sweep other nodes' changes into your commit.
- Push, PR, merge — only when the person asks. The project's own git rules win.

## A node in another project

- A change is needed in another project (a library, a sibling repo) — don't make it there
  silently. Add a node there, linked to yours: `treeyard add "Short title" --project ../X
  --for <your id> --done-when "…"`. It lands in X's «Shared nodes», and your node shows
  that it waits for it. A node that already exists there — `treeyard set <your id>
  needs=../X#<id>`.
- The person asks you to do it yourself — work in X by X's rules (its AGENTS.md, its
  tests, commits in its repository), then close that node: `treeyard set <id>
  status=done --project ../X`.
- Reading and writing another tree: `treeyard show --project ../X`, `treeyard log <id>
  "…" --project ../X`, `treeyard diff <id> --project ../X --add HEAD`.
- In a git worktree, `.tree/` is the branch's copy. Read and write the main tree:
  `--project <main folder>` with `show`, `log`, `set` and `diff` (`git worktree list` —
  the first line is the main folder). `add` has no such form: put the idea into your
  journal entry on the main tree.

## Order in the tree

Leave the tree truer than you found it. While you work and before you finish, look
around your node:

- **One node — one session or one PR.** It turned out bigger — more than ~10 steps,
  several sessions, two agents in the same files — propose splitting it into children
  with short titles and their own "done when" instead of going on.
- **A criterion nobody can see or run** — propose a concrete one; change it after the
  person's yes.
- **A parent whose children are now all done** — tell the person: the parent may be
  ready for review against its own criterion.
- **Crooked spots** — open nodes under a closed branch, duplicates, a node in the wrong
  place, `waiting` whose "come back when" has come, `active` nobody works on, `review`
  with uncommitted work, long titles, work done in the code while its node is still open.
  Point them out by title, each with the command that fixes it (`set <id> parent=<id>`,
  `set <id> title="…"`, `set <id> status=todo`, `set <id> status=dropped`), and run it
  after the person agrees. Nodes you added in this session you may fix freely.
- **Order among siblings** is set by place — `add … --after <id>`, `set <id>
  after=<id>|first|last` — not by editing `order:`.
- **A decision that is costly to change** (the stack, the data model, an invariant) —
  propose a line for «Decisions» in `.tree/tree.md`: what was decided and why.

## Commands at hand

- `treeyard show [<id>…] [--brief] [--journal N]` — the open tree; nodes
- `treeyard set <id> status=active` · `status=review` · `status=todo`
- `treeyard set <id> status=waiting waiting="…" until="…"` — blocked
- `treeyard set <id> title="…" done_when="…" parent=<id> after=<id>` — change a node
- `treeyard log <id> "what is done; what is left"` — summary
- `treeyard add "Title" --parent <id> --status idea --note "…"` — an idea
- `treeyard add "Title" --parent <id> --done-when "…" [--who human] [--after <id>]` — work
- `treeyard image <id> shot.png --note "…"` — a screenshot as evidence
- `treeyard diff <id> --add HEAD` — attach a commit
- `treeyard add "Title" --project ../X --for <id>` — a node in another project
- `treeyard note "…"` — an inconvenience of treeyard itself
- `treeyard help`, `treeyard <command> --help` — everything else
