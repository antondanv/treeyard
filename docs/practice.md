**English** · [Русский](practice.ru.md)

# How to run a project with agents

The one page treeyard stands on. It's built from what worked in my own projects with
agents and from other people's practices that have held up for years. Templates are
different ways to grow the tree; the rules below are shared by all of them.

## Twelve rules

1. **The root is a goal in life, not in code.** "For a week I run the channel only
   through the bot", "production accepted a real review". Tests say the code works;
   the goal says the project did its job. Without one, "sort of done, but not quite"
   becomes the normal state.

2. **Every node has a "done when".** One sentence you can see or run: a command, a
   scenario, a screenshot, a number. If you can't write it, the node isn't understood
   yet — split it or research it first.

3. **A node is one session or one PR.** More than ~10 items inside, "just a bit more"
   after closing it, two agents editing the same files — time to split.

4. **Branches are independent.** Stuck on something external — no server, waiting for a
   lawyer, no API access — mark the node "waiting" with a reason and a condition to
   come back, and move to another branch. A dead end isn't "the project stalled", it's
   "this branch is waiting".

5. **Your work is separate from the agents'.** Nodes only a human can do (a contract, a
   lawyer, showing it to a real user, living with the product for a week) are marked
   "done by: you". They don't hide in a checklist — they're visible in the tree. An
   agent won't do them for you, but it will prepare everything so your step takes 20
   minutes.

6. **Understand first, then plan, then code.** A new session starts with a plan by
   default: the agent studies the code and proposes, you agree (Explore → Plan → Code).

7. **An agent doesn't mark "done" itself.** It marks "review" and shows evidence: a
   command and its output, a screenshot. "Done" is set by a human or by a separate
   reviewing session with a fresh context.

8. **A new idea is a new node, not "while I'm at it".** If one comes up along the way,
   add it as a node with the status "idea" and get back to your node. That's how a
   stage ends and ideas don't get lost.

9. **The log lives in the node, the plan lives in the tree.** History, findings and
   "what's left" go into the node's log. The roadmap doesn't turn into a 2,500-line log.

10. **Decisions are written down briefly, with a reason.** What's expensive to change
    (the data model, invariants, the stack) goes into the tree's "Decisions" section:
    what was decided and why, one line per decision.

11. **Give the agent only the context it needs.** The path from the root to the node,
    the node itself, the project rules. Not "read all of docs/": long context blurs the
    instructions. CLAUDE.md / AGENTS.md stay short, with a pointer to the tree.

12. **The agent does git, you push.** Before work — `git status` and a branch; don't
    touch other people's uncommitted changes; commit only your own, by meaning
    (Conventional Commits); push and PRs only on request.

## Where this comes from

- **Mikado Method** — a tree of prerequisites for big changes: try the goal head-on,
  and when it breaks, roll back and write down what's in the way as children.
- **Opportunity Solution Tree** (Teresa Torres) — outcome → opportunities → solutions
  → assumption tests. For the moment of "I don't know how to make it better".
- **Shape Up** (Basecamp) — appetite instead of estimates: how much time you're willing
  to spend, and the scope adjusts. A cure for endless polishing.
- **GTD** — the "next action" and the "waiting for" list: blocked work doesn't vanish
  and doesn't get in the way of everything else.
- **Anthropic's Claude Code best practices** — give the agent a way to check itself,
  a plan before code, a short CLAUDE.md, a fresh context for review, `/goal` to work
  until a criterion is met.

## Templates

| Template | When |
|---|---|
| **Stages** | A new project with a clear goal: stages with criteria, the next one after review |
| **Directions** | A living project: independent branches, one waits — you work in another |
| **Mikado** | A big change or refactoring where everything is tangled with everything |
| **Finding improvements** | The product works, but it's unclear what to do next |
| **Client work** | A project for a client: stages, sign-offs, a link to the staging after each |
