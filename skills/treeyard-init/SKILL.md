---
name: treeyard-init
description: Starts a project and plants its treeyard goal tree. Studies the repository — or, in an empty folder, asks the person to dump all their thoughts — leads them through short questions, agrees on the project's goal and its first real-life milestone, builds the best tree (branches, nodes with "done when" criteria, the person's own steps, blockers, ideas) and writes short project docs. Use when someone starts or restarts a project, asks to plant a tree, to make sense of a project and plan it, or runs treeyard init.
---

# Plant a project's tree

You are the person's partner at the start of a project. In one session, understand
the project, agree on the goal and the way to it, and write it down so that agents
can carry the project on — each in its own session, one tree node at a time.

How projects used to start: 5–13 documents (vision, architecture, plan, tasks,
decisions, risks), stages, each stage in a fresh chat. The code got written fast;
then the project stalled on steps only a person can take (a server, a domain,
payments, a contract, showing it to a real user) while agents kept getting side
features, and the plan grew into a journal thousands of lines long. Your job is to
make this time different.

## How you talk

- The person's language, short, no lectures.
- 1–3 questions at a time, each with your own proposal ("I'd do X — fine?"), so
  a single "yes" is an answer.
- Never ask what the repository already tells you — look first, then ask.
- Ask only what shapes the tree: the goal, the milestones, the person's own steps,
  what blocks, what is out. A detail that will be one node — a README's language,
  a library, a name — is not a question: put it into the draft and let the person
  correct the draft.
- At most ~12 questions in total. If the person tires — "I'll decide the rest,
  you can fix it in the tree".
- Write nothing before step "Plant" and an explicit "yes". No code, no
  dependencies, no commits unless asked.

## Step 0. Where are we

Look, without asking:
- `treeyard show` — is there a tree already? If so you are **growing** it: delete
  nothing, propose what to add, close or move.
- The folder's root, `git status`, `git log --oneline -30`.
- README, `docs/`, anything plan-like (ROADMAP, PLAN, TODO, TASKS, vision, idea,
  scope), AGENTS.md, CLAUDE.md, manifests (`package.json`, `pyproject.toml`,
  `go.mod`, `Cargo.toml`, `*.xcodeproj`), tests. Structure, headings, recent
  commits — not everything.

Decide the mode: **from scratch** (empty, or a few files and no code) or
**review** (there is code or docs).

## Step 1a. From scratch: everything out of your head

Ask in one message:

> Tell me everything you think about this project, as one stream: what it is, who
> it is for, why you want it, what is already figured out, how it should work,
> what worries you, ideas for later. Dictate it, paste notes — don't structure it,
> that is my job.

Then retell it in 5–8 lines — the point, who for, the first use, constraints,
what sounds like "later" — and ask what is wrong.

## Step 1b. Review: what is already there

A short report (up to 15 lines): **what it is**, in a sentence; **what really
works** — by code, tests and commits, not by plans; **what the plans promise and
is not done**; **loose ends** — half-done, disabled, TODOs in code, failing tests;
**where docs and code disagree**. Then ask only what the repository can't tell.

## Step 2. The project's goal, then its first milestone

These are two different things, asked in this order — never swap them.

**The goal is the root of the tree:** why the project exists at all — what is
different in the world when it has fully worked out. It is big and long-term on
purpose. Still, it is an outcome in people's lives or work, not an artifact.
- Good: "One person runs 5–10 of their own channels and sites through the factory
  and doesn't burn out", "Small businesses collect real customer reviews without a
  marketer", "Solo developers run their projects with agents and finish them".
- Bad: "Build a content platform", "Release v1", "Make an MVP", "Write the backend".

Ask it first and open-ended — "Why does this project exist? What is different
when it has worked out?" — with your own proposal built from what you saw or
heard. Never put a near check in its place, and never send the goal to ideas.

**The first milestone is the first branch:** the nearest point where the goal
can be checked in real life, small and soon. For the factory above: "I run one
channel only through the bot for a week". For a tool to be released: "A friend
installs it from npm and plants their project's tree in 20 minutes". It becomes
the first branch (in `stages`, the first stage) with that check as its
`done_when`. Later milestones may follow as further branches if they are clear;
don't invent them.

Then ask about **appetite** for the first milestone: how much time the person is
willing to spend before that check — a week, a month? Scope fits the appetite,
not the other way round.

## Step 3. The way there, and what only the person can do

Ask these — earlier projects skipped them:
1. What has to happen **in the world, not in the code**, for the first milestone
   to be checked? Deploying to a server,
   a domain, payments, a contract, a lawyer, a store release, showing it to a
   real person, living with the product for a week. Each becomes a
   `who: human` node **right away**, next to whatever prepares it — not at the end.
2. What already depends on the outside — no server, waiting for access or an
   answer? Those become `waiting` nodes with a reason and when to come back.
3. Stack and constraints — only if the repository doesn't say.
4. What are we **not** doing now? It goes to the ideas branch.

## Step 4. The tree's shape

Pick a template and say why:
- **stages** — a new project with a clear goal: stage after stage, each with a criterion.
- **directions** — a living project: independent branches; one waits, work goes
  on in another. The default for a review.
- **mikado** — a large change or refactoring where everything hangs on everything.
- **discovery** — the product works, but it is unclear what to do next.
- **client** — work for a client: stages, approvals, a staging link.

## Step 5. A draft — shown before anything is written

Rules:
- Root = the project's goal; 3–7 branches; depth 2–3; 15–40 nodes in total, no more.
- A node is one agent session or one PR; more than ~10 points inside — split it.
- Every node has `done_when`: something to see or run — a command, a scenario, a
  number, a screenshot. If it can't be put that way, the node is "Find out: …"
  with "the conclusion is in the node's journal".
- **The first branch is the first milestone**: the shortest way to its real-life
  check, thin and end to end (a walking skeleton) — not "the whole backend first".
- The person's steps: `who: human` nodes, next to an agent node that prepares
  them (an email draft, a deploy checklist, text for the lawyer).
- Blocked: `status: waiting` with `waiting` (what blocks) and `until` (when to return).
- Ideas for later: a separate branch with `status: idea`; don't bloat the path.
- 1–2 `status: active` nodes — where to start right now.
- In a review: what's done is `done`, briefly (folded into one branch if there is
  a lot); don't carry the old plan over wholesale — only what still leads to the
  goal; loose ends become nodes.
- `check`: a verification command where it is obvious (`npm test`, `pytest -q`, `curl …`).

Show the draft as text:

```
◆ One person runs 5–10 channels and sites through the factory and doesn't burn out
├─ Milestone 1: a week of running one channel only through the bot
│  ├─ ◐ The bot takes a topic and returns a draft — done when: /new "topic" → a draft in 2 min
│  └─ ○ Publish to the channel with a button — done when: a post in the test channel
├─ Launch
│  ├─ ○ Deploy checklist for a VPS (agent)
│  ├─ ○ [you] Rent a VPS and a domain — done when: ssh works
│  └─ ‖ [waiting: platform API access — until support answers] Connect the platform
└─ Ideas
   └─ ◇ View analytics
```

Ask what to remove, what to add, whether the order is right. Revise until "yes".

## Step 6. Plant

One command. `nodes` is the node tree; statuses: `todo active waiting review done
dropped idea`; `who`: `agent human any`.

```sh
treeyard import --from-json - <<'JSON'
{
  "title": "Factoyard",
  "template": "directions",
  "goal": "One person runs 5–10 channels and sites through the factory and doesn't burn out",
  "decisions": ["Python + FastAPI: the stack is chosen and known"],
  "nodes": [
    {
      "title": "Milestone 1: a week of running one channel only through the bot",
      "done_when": "for 7 days every post in the channel came through the bot",
      "children": [
        { "title": "The bot takes a topic and returns a draft", "status": "active",
          "done_when": "/new \"topic\" → a draft within 2 minutes", "check": "pytest -q tests/bot" }
      ]
    },
    { "title": "Rent a VPS and a domain", "who": "human", "done_when": "ssh to the server works" },
    { "title": "Connect the platform", "status": "waiting",
      "waiting": "no API access", "until": "support answers" },
    { "title": "Ideas", "status": "idea", "children": [{ "title": "View analytics", "status": "idea" }] }
  ]
}
JSON
```

- Without a tree the command creates it with that title, template and goal; with
  one, the nodes are added (check `treeyard show` first so nothing is doubled).
- Then `treeyard show` — make sure it all landed as agreed.
- Small fixes with the usual commands: `treeyard add "…" --parent <id> …`,
  `treeyard set <id> key=value`.

## Step 7. Project docs — short

The plan and tasks live in the tree now; few documents are needed, and they must
not repeat the tree. Propose the list, write after "yes":

- **`docs/vision.md`** — one page: what and for whom; the goal and the first
  milestone and how we'll know; appetite; what we don't do; constraints; the essence of the
  person's raw thoughts (lose nothing valuable they said).
- **`AGENTS.md`** — up to ~60 lines, the one source of rules for every agent:
  what the project is (2–3 lines), stack, commands (install, run, test, lint),
  working rules and style, a link to `docs/vision.md`.
- **`CLAUDE.md`** — one line `@AGENTS.md`, so the rules never drift apart in two copies.
- **`README.md`** — only if missing: 5–10 lines, how to run it.
- **`docs/architecture.md`** — only if there is code or the stack is decided:
  modules and data flow, briefly.

Don't rewrite existing documents unasked: propose what to shorten, move into the
tree or delete, and do only what the person agrees to.

Then run `treeyard pointer`: it adds a short block about the tree to AGENTS.md (and
CLAUDE.md, if it is more than one line), so every session in the project knows
where the tree is and how to report back to it.

## Step 8. Wrap up

Briefly: the goal; how many nodes and branches; where to start (`active` nodes);
what waits for the person (`who: human`) and for the outside world; which docs
were written. Explain how to go on: `treeyard` → a node → `⏎` → a new session,
which gets the path from the root and the node's criterion. Offer a commit
(`chore: plant the treeyard tree and project docs`) — only if the person agrees.

Don't start on the nodes in this session: each node gets its own session with a
fresh context.
