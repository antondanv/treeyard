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
   even after `2>&1`. Too long → `--brief`, `--journal N` or `--only journal,sessions`;
   several nodes → one call; looking for something → `treeyard find "…"`.
3. **Write `.tree/` only with `treeyard` commands**, never by hand.
4. **Finish in order:** checks → commit → one command:
   `treeyard log <id> "…" --status review --commit HEAD`. Status `done` only when the person
   asks to close the node.
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
  journal entries; `--journal N` (or `all`); `--only header,journal,sessions,commits,history`
  — just those parts.
- `treeyard show --status review,idea --under <id>` — the nodes of those statuses in a
  branch, a line each. A status is a word (`review`, `на проверке`, `wip`), never a glyph.
- `treeyard find "text"` — titles, criteria, descriptions and journals of every node, done
  ones too. Instead of `grep` over `.tree/` or over `show`.
- `treeyard status` — the project at a glance: its folder and tree, nodes by status and
  abandoned ones, skills per CLI, the pointer in CLAUDE.md and AGENTS.md, the git hook, live
  sessions; each problem comes with the command that fixes it. In a git worktree it names
  the main tree and the `--project` to pass. Run it when the setup looks off (a skill
  missing, commits not attaching, the tree not where you expect) instead of checking files
  one by one.
- `--json` — only when a script needs the fields.

A cut output drops what you came for: the criterion, why a node waits, the last entry. Many
nodes at once are one command too: `treeyard set a b c status=todo`, `treeyard add --parent
<id> --from-json -`. A form you need seems missing → check `treeyard <command> --help`;
really missing → tell the person and `treeyard note` the gap; no pipes or loops around
treeyard.

## Finish: evidence, commit, review

Copy this checklist and check it off:

```
Finish:
- [ ] Every clause of the criterion checked: command + output, or a screenshot
- [ ] Own changes committed
- [ ] treeyard log <id> "…" --status review --commit HEAD — result, evidence, what is left
      (--commit only after your own commit succeeded)
- [ ] Reply to the person: each clause → its evidence; the node by title
```

**Check loop.** Run the check — the node's `check:` command, the tests, the scenario — and
read the result. A clause fails → fix it and check again. A clause can't be met → no
`review`: write what is left in a journal entry, or propose a new criterion to the person
(`treeyard set <id> done_when="…"` only after their yes). What the person will see goes to
the node as a screenshot: `treeyard image <id> shot.png --note "what it shows"`.

The commit fails or is not allowed → leave out `--commit`, say so in the journal entry and
to the person; `review` then means "proven, waiting for a commit".

**Journal entry** — the result, not the process:

```sh
treeyard log <id> "--version prints the version from package.json (bin/tip.js, test/cli.test.js). npm test — 3/3; node bin/tip.js --version → 0.3.0. Left: nothing." --status review --commit HEAD
```

A typo in your entry → `treeyard log <id> --fix "corrected text"`.

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

- Your journal entry is wrong → `treeyard log <id> --fix "…"`; a node's description →
  `treeyard set <id> note="…"`; a node you added by mistake → `treeyard rm <id>` (one with a
  history → `status=dropped`); the order → `set <id> after=…`.
- No command for what you need? Tell the person and `treeyard note` the gap.
- `.tree/tree.md` (goal, rules, «Decisions») changes only when the person asks, and then by
  command: `treeyard goal "…"`, `treeyard rules --from -`, `treeyard decide "what and why"`.
- `.tree/.local/` — never touch, never commit.

## Commits

- Before work: `git status` and the branch. Others' uncommitted changes — don't touch,
  stash or include them.
- Commit your own changes by meaning, in Conventional Commits, files by path (not
  `git add -A`).
- Tree files changed by your treeyard commands are yours, but `.tree/` is shared by every
  session. If the project commits its tree (`git log --oneline -- .tree`), commit yours with
  `treeyard commit <id> [<id>…]` — the named nodes, README and tree.md, nothing else; with no
  clear habit, leave it to the person and say so. Never `git add .tree/…` by hand.
- A session opened from a node with the hook installed (`treeyard status` shows it)
  attaches its commits by itself; otherwise `--commit HEAD` in the closing `log`, or
  `treeyard diff <id> --add HEAD`.
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

- `treeyard show [<id>…] [--brief] [--journal N] [--only …]` — the tree, nodes
- `treeyard show --status review,idea [--under <id>]` · `treeyard find "…"` — look things up
- `treeyard status` — the tree (the main one from a worktree) and the setup, with fixes
- `treeyard set <id> status=active` · `status=todo`; several ids — the same to each
- `treeyard set <id> status=waiting waiting="…" until="…"` — blocked
- `treeyard set <id> title="…" done_when="…" note="…" parent=<id> after=<id>` — change a node
- `treeyard log <id> "…"` — a journal entry; `--status review --commit HEAD` — finish;
  `--fix "…"` — correct your last entry
- `treeyard add "Title" --parent <id> --status idea --note "…"` — a side idea
- `treeyard add "Title" --parent <id> --done-when "…" [--who human] [--after <id>]` — work
- `treeyard add "Title" --project ../X --for <id>` — a node in another project
- `treeyard add --parent <id> --from-json -` — several nodes at once
- `treeyard image <id> a.png b.png --note "…" --note "…"` — screenshots as evidence
- `treeyard diff <id> --add HEAD` — attach a commit
- `treeyard commit <id>…` — commit the tree files of these nodes
- `treeyard rm <id>` — a node added by mistake · `treeyard decide "…"` — at the person's word
- `treeyard note "…"` — an inconvenience of treeyard itself
- `treeyard help`, `treeyard <command> --help` — everything else
