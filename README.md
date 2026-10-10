<div align="center">

<img src="docs/logo.png" width="420" alt="treeyard">

**Treeyard is a system for Agent-Driven Development (ADD): agents write the code, and you
plan, hand out the tasks and accept the work.**

Planning, building and managing a project in one terminal — on top of Claude Code, Codex,
Antigravity and OpenCode.

[![CI](https://github.com/antondanv/treeyard/actions/workflows/ci.yml/badge.svg)](https://github.com/antondanv/treeyard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@antondanv/treeyard?color=6d7dfc)](https://www.npmjs.com/package/@antondanv/treeyard)
![node](https://img.shields.io/badge/node-%E2%89%A522-3c873a)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**English** · [Русский](README.ru.md)

https://github.com/user-attachments/assets/e2f796e4-2617-4ba7-97e9-ef8ba56e2ed3

</div>

## What it is and why you'd want it

You already work with Claude Code or Codex, and the project's rules are in `AGENTS.md` or
`CLAUDE.md`. And still you know how it goes. The code is written in an evening, and the
project has been “almost ready” for a month. The plan has grown into a file thousands of
lines long, and the agent rereads it in every session. You ask for one thing and get
three more “while I was at it”. The agent says “done”, and it doesn't work. A week later
you can't tell where you stopped.

Treeyard puts the whole project into one tree on your screen: the goal at the top,
milestones under it, tasks under them. All of them are nodes of the tree. You plan in the
tree, start agents from its nodes, and see in it what is done, what is in progress and
where things are stuck.

<img src="docs/screenshot.png" width="860" alt="treeyard in a terminal: a coffee shop's goal tree — the goal at the top, two milestones with their tasks, a node waiting for the bank, two ideas; one task is selected, and the bar at the bottom says what “done” means for it">

### “I already have AGENTS.md and CLAUDE.md”

Keep them: they hold the rules — the stack, the commands, the style. But the rules are
the same for every task, and they say nothing about where the project stands. So a
`PLAN.md` or a `ROADMAP.md` appears next to them, and the trouble starts:

- it grows to thousands of lines, and the agent reads all of it in every session: tokens
  spent, instructions blurred;
- the agent ticks its own boxes, and “done” there doesn't mean “works”;
- two agents edit the same file and know nothing about each other;
- your own steps, and everything that waits for a server or a payment provider, get lost
  among the items.

Treeyard leaves only the rules in `AGENTS.md` and moves the plan and the state of the
project into the tree. Each task is a file of its own, with a status and a journal, and
an agent gets the context of its one task, not the whole plan. And it is still Markdown
in your repository: it lives in `.tree/` and is committed along with the code.

### You have an idea and don't know where to start

Open an empty folder and run `treeyard`. Say it the way it comes: plain text, in any
order. The agent asks questions and offers its own answer to each one; you correct it and
tell it more. The idea in your head becomes a plan on the screen: the goal, the first
result you can check in real life, and the tasks on the way to it — including the ones no
agent will do for you: a server, a domain, payments.

### You already have a project, and it is big

Run `treeyard` in the project's folder. The agent reads the code, the documents and the
history on its own and tells you what it found: what really works, what was promised and
never done, where the loose ends are. Then it asks a few questions and builds a tree of
the project. On it you see what is done, what is in progress and where you have hit a
wall — with the reason and with what has to happen before you can move on. At any moment
an agent can review the whole tree and show what has stalled, what has grown too big and
what it is time to pick up.

### From there, you see your project

Pick a task and open Claude Code or Codex on it, right next to the tree. The agent starts
with the context of this very task: why it exists, what is next to it, what the project's
rules are. It doesn't need to read the whole plan. It doesn't close its own work either:
it shows proof, and you accept. With several agents running, the tree shows who is
working and who is waiting for your answer. Back after a week? Every task keeps its own
journal, and one list shows everything you can do right now.

That is Agent-Driven Development: you plan, the agents build, and you manage the project
and accept the work.

## The vibe-coding practices built in

Treeyard doesn't just show tasks. It has rules built in that save tokens and time and
raise the quality of what you ship. You don't have to police them yourself: the tool
works that way.

| What Treeyard does | What you get |
| --- | --- |
| An agent gets the context of its own task only | A session starts with about 3k tokens instead of 65k for the whole plan, and short instructions don't get lost |
| One task — one session | The agent finishes the task while its context is fresh; no endless “just a bit more” |
| A plan first, then code | A mistake is caught in the plan, not in code already written |
| An agent can't mark its own work done; it shows proof | Fewer “done, but it doesn't work”: there is a command with its output, a screenshot, the commits |
| A new idea is a separate task, not “while I'm at it” | Tokens and time go into what you asked for, and ideas aren't lost |
| History lives in the task's journal, decisions in one place with their reasons | A new session doesn't reread a log thousands of lines long; what was decided, and why, is written down once |
| A goal from real life, your own steps in the plan, a “waiting” status | The project doesn't stall on a server, a domain or payments: they are visible from day one, and work goes on in other branches |

The rules come from my own projects and from practices other people have tested for
years: Mikado, Shape Up, GTD, Anthropic's recommendations for Claude Code. All twelve are
on one page — [docs/practice.md](docs/practice.md).

## Why I built it

I built Treeyard out of my own vibe coding. With agents, code gets written fast — and then
the project stalls. It stalls on the steps only a person can take: a server, a domain,
payments, showing it to a real person. Meanwhile the agents get side features, the plan
grows into a log thousands of lines long, and every new session starts by rereading it.
Code: done. Project: stuck.

Treeyard is the practices that got my projects past that point, put into one tool. I run
my own projects this way, Treeyard itself included.

## In numbers

- **~95% fewer tokens to get an agent going.** A session opened from a node starts with
  about 3k tokens of context: 2.6k–4.0k, median 3.0k over seven nodes of this repository's
  tree. Handing the agent the whole plan instead — every node with its description and
  journal — is 65k tokens on the same tree of 105 nodes, 84k with `docs/` and the README:
  the node's context is 95–96% smaller. Even the one-page overview (`treeyard show`, 5.5k)
  is almost twice as big.
- **The saving grows with the tree.** On a fresh tree of 12 nodes the whole plan (1.0k) is
  smaller than a node's context (1.7k), so there is nothing to save yet. And most of a
  session's tokens go into the code itself, not into its start.
- **Built with itself.** Treeyard has been run by its own tree since the first commit: in
  five days, 108 commits, 41 nodes done and 18 more in review, 35 agent sessions opened
  from nodes (2026-10-02 → 2026-10-06).

<sub>How the tokens were counted (2026-10-06): `treeyard context <id>` into a file, then
`claude -p "/context" --system-prompt-file <file>` — Claude's own tokenizer, checked
against a real request (3,387 tokens against “3.4k”). Codex and Gemini count with their
own tokenizers.</sub>

## When to use it — and when not

**Use it when**

- the project lives longer than one session — days, weeks, months;
- there are several directions at once, and some of them wait for the outside world;
- part of the work is yours alone: a server, a domain, payments, a contract, showing it to
  people;
- you run several agents or several CLIs in parallel and want to see who is doing what;
- you keep several projects and come back to one after a break: the tree and the journals
  say where you stopped.

**Don't, when**

- it's one small task: write a script, fix a bug, answer a question. Open plain `claude`
  or `codex` — planting a tree, criteria and statuses won't pay off;
- it's a throwaway prototype for one evening;
- a team already lives in its own tracker: Treeyard is made for one person with agents (it
  does sync with a GitHub Project board, though).

Treeyard doesn't write code itself — your agents do. It keeps the plan, gives each agent
its task and shows where the project stands.

## Quick start

You need Node.js 22+ and at least one agent CLI: Claude Code, Codex, Antigravity or
OpenCode. For sessions in panes next to the tree, tmux (`brew install tmux` on macOS).
macOS is the main platform.

```sh
npm install -g @antondanv/treeyard
cd my-project && treeyard                  # no tree yet: the planting wizard
```

Other ways in:

```sh
treeyard init                              # a new tree: with an agent or from a template
treeyard init --agent --brain codex        # straight to the agent, no wizard
treeyard import                            # the agent quietly reads the project's plan and builds the tree
treeyard config lang ru                    # Russian: the interface, templates and what agents get
```

## How you work with it

1. **Now** (`2`) lists everything you can do right now, across all branches. Pick a node.
2. `c` opens a Claude Code session for it, in a pane next to the tree; `⏎` — every action,
   other agents among them.
3. The agent gets the node's context, studies the code and proposes a plan. You agree; it
   works.
4. When the task is finished, the agent sets **in review** and shows proof: a command and
   its output, a screenshot, its commits (`V`). You look and press `d` — **done**.
5. Hit something outside — `w`: **waiting**, with a reason and when to come back. Go to
   another branch.
6. A new idea on the way — `a`, as an idea. Once a week, look through **Waiting** (`3`):
   has the condition come?

## Documentation

- [docs/reference.md](docs/reference.md) — everything in detail: planting a tree, the
  interface, keys and mouse, settings, sessions in panes, the CLI commands for you and
  for agents, node diffs, pictures, shared nodes, GitHub issues and a Project board.
- [docs/practice.md](docs/practice.md) — how to run a project as a tree: twelve rules and
  the templates (Stages, Directions, Mikado, Finding improvements, Client work).
- [docs/architecture.md](docs/architecture.md) — how Treeyard is built.

In the terminal: `?` shows all the keys, `treeyard help` all the commands.

## Development

```sh
git clone https://github.com/antondanv/treeyard && cd treeyard
npm install                     # with NODE_ENV=production: npm install --include=dev
npm run build && npm link       # the treeyard command from dist/
npm run dev -- <args>           # treeyard from the sources (tsx)
npm run typecheck && npm test && npm run lint && npm run build
npm run screenshots             # the README's pictures again, in English and in Russian (needs Chrome)
FORCE_COLOR=2 npx tsx scripts/screenshot.ts ../my-app shot.png 130x36   # a PNG of the interface
```

Sessions, panes and models go through [Brainyard](https://github.com/antondanv/brainyard)
(`@antondanv/brainyard`), one layer for every agent CLI.

## License

[MIT](LICENSE)
