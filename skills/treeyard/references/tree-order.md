# Keeping the tree in order

Leave the tree truer than you found it. For every finding: name the node by title, give the
command that fixes it, and run the command after the person agrees. Nodes you added in this
session you may fix without asking.

| What you notice | What to do |
|---|---|
| A node grew beyond one session or PR: more than ~10 steps, several sessions, two agents in the same files | Split it into children with short titles and their own criteria: `treeyard add "…" --parent <id> --done-when "…"` |
| A criterion nobody can see or run | Propose a concrete one: `treeyard set <id> done_when="…"` |
| Every child of a parent is done | Tell the person: the parent may be ready for review against its own criterion |
| An open node under a closed branch, or in the wrong branch | `treeyard set <id> parent=<id>` |
| A duplicate | `treeyard set <id> status=dropped` and a journal entry naming the node it duplicates; one you just added, with no history — `treeyard rm <id>` |
| `waiting` whose "come back when" has come | `treeyard set <id> status=todo` |
| `active` with nobody working on it | `treeyard set <id> status=todo` |
| `review` with uncommitted work | Commit it, or tell the person |
| A long title | `treeyard set <id> title="2–6 words"`; details go to a journal entry |
| Work done in the code while its node is still open, or the other way round | Tell the person, with the commit |
| Siblings in the wrong order | `treeyard set <id> after=<sibling id>` (or `first`, `last`); several in a row — `treeyard set a b c after=<id>`; never edit `order:` |
| A decision that is costly to change: the stack, the data model, an invariant | Propose a line for «Decisions»: what was decided and why; after the person agrees — `treeyard decide "…"` |
