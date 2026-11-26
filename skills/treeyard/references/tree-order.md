# Keeping the tree in order and reviewing it

Leave the tree truer than you found it. For every finding: name the node by title, give the
command that fixes it, and run the command after the person agrees. Nodes you added in this
session you may fix without asking.

## A review of the tree

Asked for a review, or where the project stands and where it stopped:

1. **Read.** A session opened from the root already has the tree with its criteria, «Now»,
   «Waiting», the latest journal entries and the sections treeyard found by itself (all
   children done, open under closed branches, in review with uncommitted code, deadlines
   passed, a come-back date passed, long titles) — check every finding there. Otherwise:
   `treeyard show` whole, then `treeyard show <id> <id> --brief` for the nodes in question,
   `treeyard show --status review,active`. Look into the code and `git log` as much as you need.
2. **A short summary first:** where the project stands and where it stopped.
3. **Then the findings by importance**, each with its node's title and the treeyard command
   that fixes it, and what is missing for the nearest milestone and the project's goal.
4. **Change nothing until the person agrees;** then run the commands and show what came of
   them. A review does not change the project's code: work on a node is a session from that
   node.

## What to look for

| What you notice | What to do |
|---|---|
| A node grew beyond one session or PR: more than ~10 steps, several sessions, two agents in the same files | Split it into children with short titles and their own criteria: `treeyard add "…" --parent <id> --done-when "…"` |
| No criterion, or one nobody can see or run | Propose a concrete one: `treeyard set <id> done_when="…"` |
| Every child of a parent or a milestone is done | Check its own criterion: met — offer review («done» at the person's word); not met — add what is missing. Ideas inside move to an open branch first. Standing buckets (ideas, notes) stay open |
| An open node under a closed branch, or in the wrong branch | `treeyard set <id> parent=<id>`, an idea to the ideas branch; or `status=dropped` |
| A duplicate | `treeyard set <id> status=dropped` and a journal entry naming the node it duplicates; one you just added, with no history — `treeyard rm <id>` |
| `waiting` whose "come back when" has come or whose date has passed | Condition met — `treeyard set <id> status=todo`; not yet — `set <id> until="…"` or a journal entry why it waits on |
| `active` or `review` without movement for over a week; `active` with nobody working on it | Ask the person: back to work (`status=todo`), continue it, or accept it |
| `review` without evidence in the journal | Ask for the evidence, or back to `active` |
| `review` with uncommitted work | Find whose it is from `git diff` and the journals: that node's — commit it and attach it (`treeyard diff <id> --add <sha>`); unfinished — `status=active`. Leave another live session's changes alone |
| A deadline in a title or a criterion has passed, the node still open | Offer: close what is done, move the deadline (`set <id> done_when="…"`), or admit it was missed and decide what next |
| A long title (over 60 characters, or details instead of the gist) | `treeyard set <id> title="2–6 words" note="…"` — `note` replaces the whole description, so keep the old text in it |
| Work done in the code while its node is still open, or the other way round | Tell the person, with the commit |
| An idea worth taking up, or one that is dead | Offer `status=todo` with a criterion, or `status=dropped` |
| A node that waits for another one only in words | `treeyard set <id> needs+=<other id>` |
| Siblings in the wrong order | `treeyard set <id> after=<sibling id>` (or `first`, `last`); several in a row — `treeyard set a b c after=<id>`; never edit `order:` |
| A decision that is costly to change: the stack, the data model, an invariant | Propose a line for «Decisions»: what was decided and why; after the person agrees — `treeyard decide "…"` |
