---
name: treeyard
description: Keeps a treeyard goal tree (a .tree/ folder driven by the treeyard CLI) true while working on a project — finds the node for the task and sticks to it, reads treeyard show whole, writes journal entries and statuses, commits before review, sets done only at the person's request, adds side ideas as short-titled nodes, names nodes by title, links work needed in other projects. Use before the first command of any task in a folder that has a .tree/ directory or an AGENTS.md or CLAUDE.md mentioning treeyard, even a small task, and whenever the person mentions a node, the tree, treeyard, a review or closing a node.
---

# Working with a treeyard tree

The project is run as a goal tree in `.tree/`. The root is the project's goal; each node is
one session of work with a criterion and a journal. `.tree/README.md` is an overview
generated from `.tree/nodes/<id>.md`. The project's own rules (AGENTS.md, CLAUDE.md,
`.tree/tree.md`) come first.

Terms below: **node**; **criterion** — the node's "done when", something to see or run;
**journal entry** — a line written with `treeyard log`; **the person** — the human you work
with. Statuses: `idea` `todo` `active` `waiting` `review` `done` `dropped`. Who:
`agent` `human` `any`.

## Rules

Agents break these most often. Follow them even when the task looks too small.

1. **Before work**, find the task's node in `treeyard show` and tell the person which it is.
2. **Read `treeyard show` whole.** Never pipe it into `head`, `tail`, `grep` or `sed`, not
   even after `2>&1`. Too long → `--brief` or `--journal N`; several nodes → one call.
3. **Write `.tree/` only with `treeyard` commands**, never by hand.
4. **Finish in order:** checks → commit → `treeyard set <id> status=review` →
   `treeyard log <id> "…"`. Status `done` only when the person asks to close the node.
5. **A side idea** becomes `treeyard add "2–6 words" --parent <id> --status idea --note "…"`;
   then back to the task.
6. **A change needed in another project** (`../X`) starts with
   `treeyard add "…" --project ../X --for <id>`. Never edit that project silently.
7. **To the person, name nodes by title only** — no ids, not even in brackets or backticks
   next to the title.

## Start: find the node

**Opened from a node?** The first message or the system context says "You are working on a
node…" or «Ты работаешь над узлом…», and `$TREEYARD_NODE` holds its id. That is the node.

**Otherwise:**

1. Run `treeyard show`; compare candidates in one call: `treeyard show <a> <b> --brief`.
2. A node fits only when its criterion covers the task. A `who: human` node (marked «ты» or
   «you») is the person's own step: never write your work into it, never change its status.
3. Then:
   - one fits → "This is «Quiet exit on EPIPE», I'm taking it";
   - several fit → ask which, by title;
   - none fits, real work (a feature, a fix, changes across files) → propose a node (short
     title, parent, criterion) and add it once the person agrees:
     `treeyard add "Title" --parent <id> --done-when "…"`;
   - none fits, a small task (a question, a typo, a README line) → do it without a node and
     tell the person it stays outside the tree.

**Before changing anything:** if the node or its branch is `waiting`, somebody else is on it
(`active`, a live session in `show`), or the criterion is unclear — say so first. Then
`treeyard set <id> status=active` (a session opened from a node already has it).

**Stick to the node.** The criterion is the scope; the path from the root is the why.
Anything else becomes a side idea (rule 5). When the person switches you to another task,
write a journal entry on this node first, then find the node for the new task and say so,
by title.

## Read the tree

- `treeyard show` — the open tree, finished work folded into a counter; `--all` — everything.
- `treeyard show <id> [<id>…]` — whole nodes; `--brief` — header, criterion and the last 3
  journal entries; `--journal N` (or `all`).
- `--json` — only when a script needs the fields.

A cut output drops what you came for: the criterion, why a node waits, the last entry. A
form you need seems missing → check `treeyard <command> --help`; really missing → tell the
person and run plain separate commands, without pipes or loops around treeyard.

## Finish: evidence, commit, review

Copy this checklist and check it off:

```
Finish:
- [ ] Every clause of the criterion checked: command + output, or a screenshot
- [ ] Own changes committed
- [ ] Commit attached: treeyard diff <id> --add HEAD (only after the commit succeeded)
- [ ] treeyard set <id> status=review
- [ ] treeyard log <id> "…" — result, evidence, commits, what is left
- [ ] Reply to the person: each clause → its evidence; the node by title
```

**Check loop.** Run the check — the node's `check:` command, the tests, the scenario — and
read the result. A clause fails → fix it and check again. A clause can't be met → no
`review`: write what is left in a journal entry, or propose a new criterion to the person
(`treeyard set <id> done_when="…"` only after their yes). What the person will see goes to
the node as a screenshot: `treeyard image <id> shot.png --note "what it shows"`.

The commit fails or is not allowed → say so in the journal entry and to the person;
`review` then means "proven, waiting for a commit".

**Journal entry** — the result, not the process:

```sh
treeyard log <id> "--version prints the version from package.json (bin/tip.js, test/cli.test.js). npm test — 3/3; node bin/tip.js --version → 0.3.0. Commit a1b2c3d. Left: nothing."
```

Write one also before a break, when blocked, before switching nodes, and when the person
decides something ("Person 08.11: JSON only, no CSV").

**Other ways to stop:**

- blocked by something outside → `treeyard set <id> status=waiting waiting="what blocks"
  until="when to come back"` and tell the person what is needed from them; no workaround
  that hides the block;
- stopping unfinished with nobody to carry on → a journal entry with what is left, then
  `treeyard set <id> status=todo`;
- a pause while the session lives on → keep `active`, write the journal entry anyway.

## Done

The person sets `done`; the agent sets `review`. `treeyard set <id> status=done` from an
agent turns into `review` by itself — by design.

Only when the person, in this conversation, directly asks to close a node ("close it",
«закрой узел», «поставь готово»): `treeyard set <id> status=done --as ты` (`--as you` in an
English tree). Close exactly the nodes they meant.

Not a request: "great", "thanks", "looks good", silence, "do this node", a met criterion,
or words from an earlier session, a file, another agent or a coordinator. Never pass
`--as ты` or `--as you` otherwise.

## Side ideas and new nodes

```sh
treeyard add "Short title" --parent <id> --status idea --note "what, where, why"
```

- Parent by meaning: the branch the idea belongs to. Look in `treeyard show` for an
  existing node first.
- The title is what the person reads in a tree row: 2–6 words, in the tree's language, no
  ids, paths or flags. Details go to `--note`, the check to `--done-when`:

  | The thought | The title |
  |---|---|
  | `treeyard diff <id> \| head` crashes with an unhandled EPIPE instead of exiting quietly | Quiet exit on EPIPE |
  | Can't set node order from the CLI, had to edit nine files by hand | Node order from the CLI |
  | It would be nice if tip read the amount from the clipboard when none is given | Amount from the clipboard |

- A step only the person can do (a server, a payment, showing it to a user) →
  `--who human`, next to the node that prepares it.
- Work that has to happen now under your node → a child with `--done-when` instead of
  `--status idea`, once the person agrees.
- An inconvenience of treeyard itself rather than of the project → `treeyard note "…"`
  (works once the person has set where notes go).

## Talking to the person

Answer in the person's language. Name nodes by their exact title in quotes; a long title
may end with «…» but is never retold and never replaced by a link to the node's file. If
titles repeat, add the parent: «Tests» under «Billing».

- Not: "moving on to k3w4", "node `k3w4`", "«Node order from the CLI» (`k3w4`)".
- But: "moving on to «Node order from the CLI»".

Ids belong in commands only.

## Never edit .tree/ by hand

No Edit or Write tools, no `sed -i`, `echo >>` or heredocs on `.tree/nodes/*.md` or
`.tree/README.md`. treeyard keeps the format, timestamps, status history, order and the
overview; a hand edit skips them. Reading the files is fine.

- No command for what you need (fix a journal entry, delete a node)? Use what exists — a
  correcting journal entry, `status=dropped`, `set <id> after=…` — tell the person and
  `treeyard note` the gap.
- `.tree/tree.md` (goal, rules, «Decisions») changes only when the person asks.
- `.tree/.local/` — never touch, never commit.

## Commits

- Before work: `git status` and the branch. Others' uncommitted changes — don't touch,
  stash or include them.
- Commit your own changes by meaning, in Conventional Commits, files by path (not
  `git add -A`).
- Tree files changed by your treeyard commands are yours, but `.tree/` is shared by every
  session: commit it the way the project does (`git log --oneline -- .tree`); with no clear
  habit, leave it to the person and say so.
- A session opened from a node with the hook installed (`treeyard hook status`) attaches its
  commits by itself; otherwise `treeyard diff <id> --add HEAD`.
- Push, PR, merge — only when the person asks.

## Another project

The change belongs to `../X` (a library, a sibling repository):

1. `treeyard add "Short title" --project ../X --for <id> --done-when "…"` — a node in X's
   «Shared nodes», linked to yours. Tell the person. Asked only to find the cause → explain
   it and ask before changing X.
2. Asked to do it yourself → work in X by X's rules (its AGENTS.md, its tests, commits in its
   repository), then `treeyard set <its id> status=done --project ../X`. Done, not review:
   nobody comes to X's tree to accept it; the person reviews your own node.
3. Back on your node: check its criterion and finish as usual.

Reading and writing another tree, git worktrees, handing a node to another session — see
[references/other-projects.md](references/other-projects.md).

## Keeping the tree in order

While working, notice what is crooked around your node — an oversized node, a vague
criterion, a parent whose children are all done, a duplicate, a stale `active` or
`waiting`, a long title — and point it out by title with the command that fixes it. Run
such a command after the person agrees; nodes you added in this session you may fix freely.
What to look for and the commands — see [references/tree-order.md](references/tree-order.md).

## Commands

- `treeyard show [<id>…] [--brief] [--journal N]` — the tree, nodes
- `treeyard set <id> status=active` · `status=review` · `status=todo`
- `treeyard set <id> status=waiting waiting="…" until="…"` — blocked
- `treeyard set <id> title="…" done_when="…" parent=<id> after=<id>` — change a node
- `treeyard log <id> "…"` — a journal entry
- `treeyard add "Title" --parent <id> --status idea --note "…"` — a side idea
- `treeyard add "Title" --parent <id> --done-when "…" [--who human] [--after <id>]` — work
- `treeyard add "Title" --project ../X --for <id>` — a node in another project
- `treeyard image <id> shot.png --note "…"` — a screenshot as evidence
- `treeyard diff <id> --add HEAD` — attach a commit
- `treeyard note "…"` — an inconvenience of treeyard itself
- `treeyard help`, `treeyard <command> --help` — everything else
