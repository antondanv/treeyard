## How we keep the tree

- The root holds a goal you can see in real life; every node holds a "done when": something you can see or run.
- A node is one session or one PR. More than ~10 items, or "just a little more" — split it.
- Blocked by something outside — the node is "waiting", with what blocks it and when to come back; work goes on in another branch.
- Nodes only a person can do are marked "done by: you".
- A new idea along the way is a new node with status "idea", not "while I'm at it".
- History and "what is left" go into the node's journal, not into a separate plan file.

## Rules for agents

- You work on one node of the tree. Stay on it; the path from the root explains why it matters.
- First understand and propose a plan; change files once the plan is clear.
- A new task or idea came up — add a node (`treeyard add "…" --parent <id> --status idea`) and go back to yours.
- Blocked by something outside — `treeyard set <id> status=waiting waiting="what blocks it" until="when to come back"`.
- A change is needed in another project — `treeyard add "…" --project ../X --for <id>`: the node goes to «Shared nodes» of that tree, linked to yours; do not change it silently. Done what was needed there — `treeyard set <id> status=done --project ../X`: an agent closes a shared node itself.
- Criterion met — `treeyard set <id> status=review` and show the evidence: the command and its output. "Done" is set by a person.
- At the end, or when you stop — write the outcome: `treeyard log <id> "what is done; what is left"`.
- Git: `git status` and the branch before you start; do not touch other people's uncommitted changes; commit only your own work, by meaning (Conventional Commits); push and PRs only when asked.

## Decisions

Decisions that are expensive to change go here: what was decided and why. One line per decision.
