**English** · [Русский](reference.ru.md)

# Treeyard reference

Everything the [README](../README.md) leaves out: how a tree is planted, what the
interface shows, every key, every setting and every command.

- [Planting a tree with an agent](#planting-a-tree-with-an-agent)
- [What it looks like](#what-it-looks-like)
- [Keys](#keys) · [With the mouse](#with-the-mouse)
- [Confirmation and settings](#confirmation-and-settings) · [What agents may do](#what-agents-may-do)
- [Sessions next to the tree](#sessions-next-to-the-tree)
- [Agents and the tree: the CLI commands](#agents-and-the-tree)
  - [Project status](#project-status) · [The root and the project's documents](#the-root-and-the-projects-documents)
  - [Node diffs](#node-diffs) · [Notes](#notes) · [Node pictures](#node-pictures)
  - [Shared nodes](#shared-nodes) · [A GitHub Project board](#a-github-project-board)
- [Tree files and templates](#tree-files-and-templates)
- [Removing treeyard](#removing-treeyard)
- [Development](#development)

## Planting a tree with an agent

In a folder without a tree, `treeyard` opens a full-screen wizard: **with an agent**
(Claude Code, Codex, Antigravity or OpenCode) or **on your own, from a template**.

The agent gets the [`treeyard-init`](../skills/treeyard-init/SKILL.md) skill and goes like
this:

1. **Looks at where you are.** In an empty folder it asks you to pour out everything you
   think about the project, as plain text. In a project it studies the code, the documents
   and the history and gives a short report: what really works, what was promised and not
   done, where the loose ends are.
2. **Asks questions.** 1–3 at a time, each with its own suggestion, so “yes” is often
   enough. No more than ~12, only what shapes the tree. Nothing it can see in the
   repository. Small things like the README's language go straight into the draft as
   nodes.
3. **Agrees on the goal and the first milestone — in that order.**
   - The root gets the project's big goal: why it exists at all (“ten strangers order our
     coffee online — and come back for a second bag”), not “build an MVP”.
   - The first branch is the first milestone: the nearest check in real life (“a stranger
     orders a bag from the site”).
   - Plus the appetite: how much time you're ready to put in before that milestone.
4. **Asks about steps in the world, not in the code.** A server, a domain, payments, a
   contract, a live user. They go into the tree at once as “done by: you” nodes instead of
   piling up at the end, where projects used to stall.
5. **Shows the draft tree as text.** The walking skeleton first, a “done when” on every
   node, blockers as “waiting”, ideas in a separate branch. It plants it with one command
   (`treeyard import --from-json -`) only after your “yes”.
6. **Writes short documents instead of the old ten.** `docs/vision.md`, `AGENTS.md` as the
   single source of rules, `CLAUDE.md` of one line, `@AGENTS.md`. The plan and the tasks
   live in the tree.

With tmux the conversation opens on the right, and on the left the tree appears and grows
as it is planted. What you type goes straight to the agent; `⌃Q` gives control back to the
tree, `f` to the conversation, `F` shows the conversation full screen. Nothing to run
after planting. Without tmux (or with `open=terminal`) the agent works full screen in this
terminal: leave the session, and the tree opens.

treeyard's skills — `treeyard-init` (planting), `treeyard` (working with a tree) and
`treeyard-coordinate` (handing several nodes out to sessions, accepting and merging their
work) — install themselves: `treeyard init`, `treeyard` and any command in a folder with a
tree put them into every CLI on the machine — `~/.claude/skills`, `~/.codex/skills`,
`~/.gemini/config/skills` — and bring them up to date when a new version of treeyard ships
other ones. So a plain `claude`, `codex` or `agy` started in the project knows them too, not
only a session opened from a node. Once something is written, the command says so in a line
(the tree — in a toast).

They go into the CLIs' own folders, not into the project: the repository gets no copies to
commit and keep in step, and `treeyard-init` works where there is no tree yet. A skill folder
that is a link (to a checkout, say) is left alone; copies the project keeps for itself
(`.claude/skills`, `.agents/skills`) are refreshed, never created. `treeyard status` and
`treeyard skills` show where they are.

```sh
treeyard skills            # where the skills are in each CLI: installed, outdated, not installed
treeyard skills install    # install or refresh them now, links included
treeyard config skills off # don't install them by yourself; TREEYARD_SKILLS=off — for one run
treeyard uninstall         # remove them everywhere, with the hook — see «Removing treeyard»
```

A skill is installed as a whole folder (SKILL.md and `references/`); a copy that is already
current is left alone.

## What it looks like

<img src="screenshot.png" width="860" alt="treeyard in a terminal: a coffee shop's goal tree — the goal at the top, two milestones with their tasks, a node waiting for the bank, two ideas; one task is selected, and the bar at the bottom says what “done” means for it">

- **Graph** (the default): the goal on the left, branches grow to the right, a parent sits
  in the middle of its children. A node is one line, so the whole working tree fits on the
  screen. Children stand right after their parent's title, and leaves take the room left
  on the right: a short “Done · N” doesn't push its children away, and long titles get cut
  less often. The selected node is a green pill, and the path to it from the root is lit;
  if its title doesn't fit, it slowly scrolls to the end and back, pausing at both ends.
  `z` shows the same nodes as cards, `v` the tree as an indented list. With a session
  open, the cards' width follows the room on the left. In a narrow list, long indents
  shrink to `…`, keeping the node's status and title. With a session open, the graph and
  the cards shift to the working branch; the root stays further left, and `⌥←` or going to
  the top branch gets you there. Agent labels go compact: `⠋ claude` — working, `? claude`
  — waits for you, `▣ codex` — an open agent pane; they show on the selected node too, set
  off from its highlighted title.
- **The bar at the bottom**: where you are, what “done” means for this node (or what it
  waits for), and how its sessions are doing — an agent working, waiting for you, or no
  sessions. The selected node's title and status get the room first; the path in between
  shrinks to `…` when it doesn't fit.
- **Tabs**: `1` Tree · `2` Now — everything you can do right now, across all branches ·
  `3` Waiting — blocked branches with the reason and the condition to come back · `4`
  Ideas · `5` Sessions — this folder's sessions, grouped by Claude Code, Codex,
  Antigravity, OpenCode (`← →` between them) · `6` Journal — what happened in the tree.

<img src="screenshot-menu.png" width="860" alt="Enter on a node: a menu with a new session — Claude Code, Claude Code in the background, Codex, Antigravity, OpenCode, set up the launch — and agent tasks without a session: break into steps, write a “done when”, run the check, node diffs, what the agent gets">

From the root, `c` starts a review of the whole tree by the project's agent; `⏎` opens a
menu with the review and a conversation about the project. In “⚙ Another agent, place,
model…” (`o`) you pick Claude Code, Codex, Antigravity or OpenCode, a pane or the
terminal; Claude can also work in the background. The agent gets the goal, an overview of
the nodes, Now, Waiting, the latest journals, the rules and the decisions — and what
treeyard found by itself: parents and milestones whose children are all done while they are
open; open nodes under closed branches; nodes in review while the folder has uncommitted code
(files in `.tree/` do not count); titles over 60 characters; nodes past their deadline (a date
after «by», «until», «before», «deadline», «до», «к» in the title or the criterion; a bare date
such as «28.08 Review» is not a deadline; a milestone is a node whose title starts with
«Milestone» or «Веха»); waiting nodes whose date in «come back when» has passed (there a date
counts without a word before it; a date without a year falls after the day the node went to
waiting). A review gives
its findings and `treeyard` commands first, and changes only after you agree. In a
conversation the first message is yours: ask about the status, open or close nodes. The
project's sessions are kept in `.tree/tree.md`, shown in the root's menu and in the
Sessions tab as belonging to the project `◆`; `f` resumes a pane, `x` puts it to sleep.

## Keys

Letter keys also work in the Russian layout, from the same keys: `р о л д` are `h j k l`,
`ф` is `a`, `Ф` is `A` — in the tree, lists, menus and dialogs; Shift keeps the key's
meaning. Russian text in search, forms and agent panes is typed as usual.

| | |
| --- | --- |
| `↑ ↓` `← →` | along the graph's column · to the parent and to the children (`j k` — every node in turn); from the top level `←` goes to the root `◆` |
| `space` `+` `−` | fold a branch · unfold everything · fold everything |
| `:` or `⌃K` | palette: find any node or action by words |
| `/` | filter the tree by title |
| `⏎` | everything about the node: resume a session, start a new one, an agent without a session, the check |
| `c` `b` | Claude Code for the node (in a pane, with tmux) · in the background |
| `f` `F` `x` `p` | the session on the right: type into it · full screen · put to sleep · hide (more below) |
| `a` `A` | a new node inside · beside — on a line at the bottom; long text wraps and stays visible (`tab` — with a criterion) |
| `r` `e` `E` | rename · the node's fields and description · the node in your editor |
| `d` `w` `s` | done (on a done node — back to todo) · waiting, with a reason · any status |
| `D` `y` | delete the node · copy its id |
| `G` | GitHub: the wizard when nothing is connected; sync with the board; with only issues linked — a choice: sync them or connect a board |
| `I` | node pictures: a screenshot from the clipboard (`v`), a caption (`n`), full screen (`o` — full size in Preview), delete (`D`); a picture file can be dragged into the window |
| `V` | node diffs: linked commits → files → a coloured diff; also in the `⏎` menu and the `:` palette |
| `P` | project documents: every `.md`, read with Markdown drawn and edited in the built-in editor; also `⏎` on the root `◆` |
| `S` | an agent breaks the node into 3–7 steps, you tick the ones to add (who breaks it — you choose in the confirmation) |
| `t` | run the node's check (the command in its “check” field) |
| `u` | undo the last change |
| `tab` `⇧tab` | nest · lift a level up |
| `K` `J` or `⇧↑` `⇧↓` | raise · lower the priority among siblings of the same status (also in the `⏎` menu and the `:` palette) |
| `⌥` + arrows | move the graph · `f` — back to the selected node |
| `v` `z` `i` `.` | list ↔ graph · lines ↔ cards · details panel · done nodes (a finished node with open ones under it stays as a row over them) |
| `,` `⌃R` | settings · reread the tree from disk |
| `?` `q` | all keys (if they don't fit, `↑↓` `PgUp` `PgDn` scroll) · quit |

The “Edit node” window (`e`) has a multi-line “Description” field: `Enter` is a new line,
`↑↓` move the cursor between lines, `←→` along the text. A paste keeps its line breaks;
long text wraps to the width, and the visible part follows the cursor. `Tab` / `Shift+Tab`
switch fields, `Ctrl+S` saves the whole window; in the other fields `Enter` saves too.
`Esc` drops the edits, `u` in the tree undoes a save. The journal is saved apart from the
description. To edit the whole Markdown file, journal included, there is still `E` from
the tree.

Under each parent, nodes go by status, by default: **active → in review → todo → waiting →
idea → done → dropped**. Within one status you set the order yourself, top to bottom; it
is kept in the nodes' `order`, shows in the CLI, and `u` undoes a move. (The generated
`.tree/README.md` lists siblings by `order` alone, whatever their status and your status
order: it is committed, so it must not depend on whose settings wrote it.) From the CLI:
`treeyard set <id> after=<sibling id>|first|last` (a sibling of another status works too:
the node takes the nearest place in its own group); a new node — `treeyard add … --after <sibling id>`,
and when the sibling's status differs, `add` says which group the node went to. Changing a status moves the node to
its part. The order of statuses is a setting —
“Status order” in `,` or `treeyard config status_order`:

| Preset | Top to bottom |
| --- | --- |
| `active-first` — active on top (default) | active → in review → todo → waiting → idea → done → dropped |
| `done-first` — done on top | done → active → in review → todo → waiting → idea → dropped |
| `active-last` — active at the bottom | idea → waiting → todo → in review → active → done → dropped |
| `custom` — your own | as you arrange it: `⏎` on the “Status order” line opens the list of statuses, `K` `J` or `⇧↑` `⇧↓` move them, `⏎` saves |

Confirmed done nodes are gathered into a folded group **“Done · N”** — at the end of the
branch, or wherever “done” stands in the chosen order. Select the group and press `space`
(or `⏎`) to unfold it; `space` folds it back. `+` unfolds these groups too. Nodes “in
review” stay in sight. Search `/` and the palette `:` find done nodes as well; inside the
group their sessions and actions are at hand. The group changes only the view: parents,
history and node files stay as they were.

### With the mouse

| | |
| --- | --- |
| click | select a node in the graph and in the list (the root `◆` too), a line in Now, Waiting, Ideas, Journal, Sessions · switch tabs |
| double click | the same as `⏎`: the node's actions, open a session, from the journal — to the node; in a menu — pick the item |
| click on `▸` `▾` or `›4` | unfold or fold a branch in the list · unfold a folded branch in the graph and step into it |
| click on a hint | press its key: the hints at the bottom of the screen, `,` `?` in the header, the session pane's buttons and dialog footers |

A click on a hint is exactly a press of its key, so the mouse does what the keyboard does.
While a dialog is open, the tree on the left takes no clicks.

## Confirmation and settings

Before every session and agent task treeyard asks: which node, who (Claude Code, Codex,
Antigravity, OpenCode), where (in a pane, in this terminal or in the background), how to
start, which model, what access the agent gets — and shows the first message the agent will
get. `⏎` starts, `o` changes the parameters, `esc` cancels, `!` stops asking. `treeyard open`
from the shell asks the same way (`--yes` — without asking). What each agent may do — in
[What agents may do](#what-agents-may-do).

“Plan” starts Claude Code in its plan mode and OpenCode with its plan agent: edits are
closed until you agree. Claude Code with a plan ready asks itself whether to get to work;
OpenCode asks the same or asks you to switch agents — `Tab` in its pane turns on the build
agent. Codex and Antigravity get the same request in words.

Before “Break into steps” and “Write a "done when"” the confirmation is a small form: the
brain (Claude Code, Codex, Antigravity, OpenCode), the model and the effort are picked
with `←→`, the field with `↑↓`. It starts with the project's brain and `assist_model`;
another choice applies only to this task, and the project's settings stay as they were. An
effort the model doesn't have (Haiku has none at all) is not passed to the agent.

Settings — the `,` key (always shown in the top right corner) or `treeyard config`:

| For all projects (`~/.treeyard/settings.json`) | |
| --- | --- |
| `lang` | `en` (default) or `ru` — the interface, templates and what agents get |
| `confirm` | confirm before starting sessions and agent tasks |
| `theme` | `dark` or `light` — to match your terminal |
| `animation` | spinners and the blinking leaf |
| `marquee` | running title: a long title of the selected node scrolls so you can read it whole |
| `status_order` | the order of statuses under each parent: `active-first` (default), `done-first`, `active-last`, `custom`, or all seven statuses comma-separated — your own |
| `live` | live status of Claude Code, Codex, Antigravity and OpenCode sessions: who is working, who waits for you |
| `open` | open sessions in a pane (`pane`, the default) or in the terminal (`terminal`); without tmux — in the terminal |
| `sleep_after` | put sessions to sleep after 15/30/60 idle minutes (default 30); `0` — never |
| `max_panes` | the limit of the project's live panes: 3/5/8 (default 5); `0` — no limit |
| `stale_after` | hours after which an «in progress» node with no live session and no records is marked «no session N h» (default 2); `0` — off |
| `notes` | the folder with the tree where `treeyard note` writes notes from any project; `off` — none. In `,` — “Where notes go”: a path (`~`, `.` — this project), empty — none |
| `antigravity_access` | Antigravity's access: `full` (no confirmations), `normal` (it asks before every command) or `ask` (the default — asked before the first launch); see “What agents may do” |
| `codex_access` | how Codex starts from the tree: `sandbox` (the sandbox + treeyard and git: workspace-write with the network and the project's `.git` open), `config` (as `~/.codex/config.toml` says) or `ask` (the default — asked before the first launch); see “What agents may do” |
| `skills` | install treeyard's skills into Claude Code, Codex and Antigravity and keep them at its version (default on); `off` — only by hand, `treeyard skills install` |

With `live` on, a working Codex shows a spinner at its node and counts among “agents
working” at the top, in a long session too. A question or a permission request in a pane
shows “waits for you”; after an answer or a cancel the wait clears on the next update.
Statuses update every 3 seconds. The counter at the top counts the sessions attached to
this tree's nodes. For OpenCode Brainyard sees only “working” so far: its question or
permission request also looks like work, not “waits for you”.

| This project (`.tree/tree.md`) | |
| --- | --- |
| `brain` | the default brain: claude, codex, antigravity, opencode (unset — current session's CLI or first installed CLI) |
| `start` | how a session starts: plan, do, goal, chat |
| `model`, `effort` | the sessions' model and effort — picked from the list the CLI itself gives |
| `assist_model` | the model for “break into steps” and the criterion — can be a cheaper one |
| `setup` | a command that prepares a new [worktree of a node](#git-worktrees-of-nodes): `npm install`, a build…; `treeyard config setup "npm ci"` |
| `mail_limit` | how many messages two nodes may exchange in a row before [the brake](#agents-and-the-tree) stops the next one (6 by default); `treeyard config mail_limit 10`, `off` — no brake, `default` — back to 6 |

Models don't need typing in: treeyard asks the CLIs for them (`codex debug models`, `agy
models`, `opencode models` — the models of the providers connected to OpenCode; for Claude
Code — the aliases fable, opus, sonnet, haiku, which always mean the latest version). Only
the efforts the chosen model understands are offered, `*` marks its default one. The model
and the effort belong to the project's brain: they reset when the brain changes. The same
lists are in the launch window (`o`). An OpenCode session doesn't get the effort at start:
OpenCode changes it — the model's variant — right in the session (`ctrl+t`); “break into
steps” and the criterion do pass it to OpenCode.

```sh
treeyard config                 # everything that is set
treeyard config lang ru         # Russian
treeyard config confirm off     # don't ask before starting
treeyard config sleep_after 15  # sleep after 15 minutes of confirmed idling
treeyard config max_panes 3     # up to three panes; working and visible ones are protected
treeyard config stale_after 4   # mark «in progress» nodes nobody has touched for 4 hours
treeyard config status_order done-first  # done on top
treeyard config status_order todo,review,active,waiting,idea,done,dropped  # your own order
treeyard config notes ~/Projects/my-notes  # where notes go
treeyard config antigravity_access normal  # Antigravity asks before every command
treeyard config codex_access sandbox  # Codex gets through its sandbox to treeyard send and git commit
treeyard config skills off      # skills only by hand: treeyard skills install
TREEYARD_LANG=ru treeyard       # the language for one run
```

## What agents may do

| Agent | Access from the tree |
| --- | --- |
| Claude Code | its own settings (`permissions` in `~/.claude/settings.json`); a “plan” start — its plan mode: no edits until you agree |
| Codex | your choice: the **sandbox + treeyard and git** — `workspace-write` with the network and the project's `.git` open, the rest from `~/.codex/config.toml` — or **as in config.toml**: its sandbox and approvals, no flags from treeyard |
| OpenCode | its own settings (`permission` in `opencode.json`); a “plan” start — its plan agent |
| Antigravity | your choice: **full access** — commands, editing and deleting files, the network with no confirmations (`--dangerously-skip-permissions`), or the **ordinary mode** — it asks before every command |
| Break into steps, write a “done when” | read-only, no network — whichever agent does it |

Antigravity has only plan and accept-edits in its own settings and asks before every
command, while an agent from a node has to run treeyard, tests and git. So before the first
launch of Antigravity — a new session, a resumed one or a woken pane — treeyard asks once:
full access or the ordinary mode. The question comes even with `confirm` off; `esc` starts
nothing. The choice is kept in `~/.treeyard/settings.json` (`antigravity_access`) and
changes in `,` → “Antigravity access” or with `treeyard config antigravity_access
full|normal|ask` (`ask` — ask again at the next launch). Until it is chosen, Antigravity gets
no extra rights. `treeyard open` and `treeyard init --agent` in a terminal ask the same
question; without a terminal (an agent or a script calling `open`) they stop with exit code
2 and say how the person chooses — `--yes` skips the confirmation, it does not grant access.

Codex's default sandbox keeps two things shut: the tmux socket (`treeyard send`, panes) and
the project's `.git` (`git commit`) — a Codex session from the tree cannot talk to other
sessions or commit. So the first launch of Codex asks once too (the same way, `esc` starts
nothing):

- **sandbox + treeyard and git** — treeyard starts Codex with `--sandbox workspace-write`,
  `-c sandbox_workspace_write.network_access=true` and `-c
  sandbox_workspace_write.writable_roots=[…]` with the project's `.git` (from a git worktree
  — the main repository's, where its commits go). Your own `writable_roots` from
  config.toml stay; approvals, model and everything else come from config.toml. The flags go
  with a new session, a resumed one and a woken pane. `~/.treeyard` stays closed to Codex:
  it writes only in the project.
- **as in config.toml** — no flags; the sandbox is whatever `~/.codex/config.toml` says.

The choice is kept in `~/.treeyard/settings.json` (`codex_access`) and changes in `,` →
“Codex access” or with `treeyard config codex_access sandbox|config|ask`. `treeyard status`
shows how Codex is started and, if config.toml shuts the tmux socket or `.git` and the
choice is not the sandbox, names the lines to add — for every Codex start, not only
treeyard's:

```toml
[sandbox_workspace_write]
network_access = true
writable_roots = ["/path/to/project/.git"]
```

## Sessions next to the tree

A session opened “in a pane” lives in tmux: its screen shows to the right of the tree, you
can type into it without leaving treeyard, and closing treeyard doesn't stop it — next
time it is back in its node. All four CLIs work this way.

| | |
| --- | --- |
| `f` or a click on the pane | type into the session: everything, arrows, pastes and `⌃C` included, goes to the CLI |
| `⌃Q` or a click on the tree | back to the tree |
| `F` | full screen; `⌃Q` — back to the tree |
| `x` | put to sleep: the CLI closes and gives its memory back, the conversation stays in its history |
| `f` on a node with a sleeping session | wake it: the same conversation in a new pane (with a confirmation) |
| `p` | hide or show the pane |
| `⇧←` `⇧→` or `<` `>` | wider, narrower — the pane's border follows the arrow; a click on `⇧← ⇧→` in the pane's corner does the same |
| wheel · `PgUp` `PgDn` · `End` | the pane's history · page by page · to the live screen |
| drag the mouse over the pane's screen | select and copy to the clipboard (Treeyard holds the mouse, so it selects by itself) |

The top right shows how many sessions are alive and how much memory they take (Claude Code
— about 200–300 MB, Codex — about 80, Antigravity — about 350, OpenCode — 0.5–1 GB).
Treeyard reads the screen only of the session in sight and leaves the rest alone: 8 times
a second while nothing happens, and right after a key or a scroll at once and then often for
half a second, so the CLI's echo shows without delay. Quiet
sessions fall asleep by themselves (`sleep_after`, by default after 30 idle minutes), and
when more than `max_panes` are alive (5 by default), the one idle the longest falls
asleep. A session that is working, waiting for you or open on the screen never falls
asleep. OpenCode doesn't fall asleep by itself at all yet — Brainyard can't tell that it's
free — `x` puts it to sleep. A session without a single message doesn't fall asleep but
just closes: the CLI doesn't keep an empty conversation, and there would be nothing to
wake.

In the Sessions tab (`5`) select a session and press `x` — that very session falls asleep,
even if its pane is hidden or it was started in the background with `b`. Claude Code
background sessions stop with its own `stop` command; the conversation and its node stay.
The list shows `☾ sleeping`, and `⏎` resumes the same conversation. Putting a working
session to sleep by hand stops it. A session open full screen or in another terminal —
close it there first.

This folder's sessions that are in no node are marked `no node` — they were opened past
the tree. Above the list: how many sessions there were in the last 14 days and how many of
them went past the tree; the same at the end of `treeyard sessions`. To attach such a
session to a node — `l`.

It needs tmux. Treeyard has its own tmux server (`tmux -L brainyard`) and doesn't touch
your own tmux or its settings.

A program that shows a session's terminal itself (Treeyard Web) learns which pane to attach
to from treeyard. `treeyard open <id> --pane --json` starts the session and prints
`{"node", "brain", "id", "pane", "startedAt", "warnings"}`: `id` is the session's id, `pane` is
the name of its tmux session on that server (`tmux -L brainyard attach -t <pane>`). Codex,
Antigravity and OpenCode name a session only once it has started, so their `id` is `null` at
first. `treeyard sessions --json` gives every session a `pane` — its live pane, or `null` when
it runs in no pane — and finds a fresh pane's session in the CLI's own store; the plain
`treeyard sessions` marks it `▣ <pane>`. Neither command writes the found id into the tree:
the TUI does that when it next looks. With several nodes — `treeyard open a b c --pane --json` — it
prints an array of those objects, one per node, in the order given; a pane that did not start is an
object with `error` and `null` for `id`, `pane` and `startedAt`.

`treeyard sessions <id> <old-id> --replace <new-id> [--project <dir>]` repairs a node's session
binding. Copy the full old id (or `pane:…`) from `treeyard show <id> --only sessions` and the full
conversation id from `treeyard sessions --json`. The command updates the stored id and its live
pane and records the change in the node's journal. If the conversation already belongs to another
node, correct that node's binding first.

`treeyard open <id> --bg --json` is the same for a background session, for a coordinator that
reads the result with a program: `{"node", "brain", "id", "startedAt", "warnings"}` — no `pane`,
and stdout holds only the JSON (the `✓` lines and warnings go quiet). Several nodes —
`treeyard open a b c --bg --json` — give an array, one object per node in the order given; a
session that did not start is an object with `error` and `null` for `id` and `startedAt`, and
the exit code is 1 as without `--json`.

`treeyard sleep <id> [<id>…] [--force] [--json] [--project <dir>]` puts a node's live pane to
sleep: closes the tmux process, leaving the session in the node for waking and continuation
(`wakeInPane`, `treeyard send`, or `⏎` in the TUI). If the pane is currently working (`busy`),
waiting for the person (`waiting`), or attached to a terminal (`attached`), without `--force`
the command refuses, explains why, and exits with code 1; with `--force` it closes the pane.
Before closing, it settles any pending session id so the conversation is not lost. If the pane
is already sleeping or the node has no live pane, it notes that cleanly without error. Multiple
ids are put to sleep in turn; `--json` outputs an array of results for each node (or an object for
a single node).

`treeyard peek <id> [--lines N] [--json] [--project <dir>]` peeks at the screen of a node's live
pane straight from the CLI, without `tmux attach` or manual capture: shows the session status,
pane name, and the last N lines of the screen (default 25) without ANSI codes. If the session is
waiting for the person (`waiting`), it includes the command to attach. When the pane sleeps or the
node has no live pane, it reports that politely (exit code 0; in `--json`, `live: false, pane: null, screen: []`)
with hints on how to continue or inspect the journal. If the node does not exist, it exits with code 1.

`treeyard models [brain] [--json]` shows available models and their effort levels for a CLI (`claude`,
`codex`, `antigravity` / `agy`, `opencode`) or for all four CLIs: prints model id, label (if different),
and supported reasoning effort levels (with default effort marked, e.g. `high*`). If a CLI is not
installed or returned an error, explains the reason without failing the whole command. `--json` outputs
the clean catalog structure.

`treeyard limits [brain] [--json] [--offline]` shows usage percentages, reset times, sources and
snapshot ages. By default, Brainyard reads Claude Code and Antigravity quotas via `/usage` and
queries the quota endpoint for OpenCode Go. These checks make no model calls and have a 15-second
timeout per CLI. Use `--offline` to read local snapshots only.

Codex limits currently come from saved session rollouts. A snapshot older than one hour is marked
stale (`limitsStale: true` in JSON). It updates when a Codex session writes new limits to its rollout.
A window past its reset time is shown as reset at 0%. In `--json` it gets `expired: true`,
`utilization: 0` and the last recorded value in `previousUtilization`.

## Agents and the tree

A session from a node gets a short context: the path from the root (why this), the
criterion, the neighbours, the project's rules and the tree's commands. The commands end
with the rules agents broke most often, the same from a node and from the root: name nodes
to the person by title, ids only in commands; read `show` whole (`--brief`, `--journal N`)
instead of cutting it; give a subagent the node id and `--project <main folder>`; status
done only when the person asks for it in the conversation (`--as you`). Agents write back
with the same commands a person uses:

```sh
treeyard show                                   # the tree; off a terminal finished work folds into «✓ done: N» (--all — everything, --open — without finished)
                                                # open work under a finished or dropped parent stays in sight: the parent is one folded line («· folded, N hidden»)
treeyard show <id>                              # a node; several at once: treeyard show a b c (--json — an array)
treeyard show <id> --brief                      # header, criterion, check/waiting and the last 3 journal entries
treeyard show <id> --journal 5                  # only the last 5 entries (--journal all — every one)
treeyard show <id> --only journal,sessions      # only these parts: header, criterion, commits, children, sessions, note, journal, history
treeyard show --status review,idea --under <id> # nodes of these statuses in a branch, a line each with the path (--json — an array)
treeyard show --under <id>                      # the branch as a tree (--open, --all, --json as for the whole tree)
treeyard show --json --all                      # everything about every node for a program: description, journal, status changes, pictures, dates, place (--under <id> — a branch)
treeyard watch --json                           # watch the tree: a JSON line per change — a node added, removed, its status changed, a new entry, an edit (without --json — a line for a person)
treeyard docs --json                            # the project's documents as the «Documents» window lists them: path, title, lines, time (without --json — a line each)
treeyard projects --json                        # folders with trees treeyard has seen, the most recent first: path, title, goal, when seen (without --json — a line each)
treeyard find "rounding|cents"                  # search every node, done ones too: id, status word, path and the matching piece (--status, --under, --json, --limit)
treeyard add "Show the product to a person" --who human --parent <id>
treeyard add "Quiet exit on EPIPE" --parent <id> --done-when "…" --note "details"   # a title is the gist in 2–6 words; past 60 characters add still adds the node but hints at --note and set <id> title=
treeyard add "Fix the help" --parent <id> --after <id>     # right after a sibling, like set after= (no --parent — under its parent; default — last)
treeyard add "Idea from worktree" --parent <id> --status idea --project ../main   # add to another folder's tree (without --for — a regular node, not a shared one)
treeyard add --parent <id> --from-json - < nodes.json      # several nodes at once (an error adds none); prints their ids (--project works too)
treeyard set <id> after=<sibling id>|first|last # the place among siblings; with parent=<id> — in a new parent
treeyard set <a> <b> <c> status=todo            # several nodes: the same change to each (after=<id> puts them one after another); an error changes none
treeyard set <id> status=waiting waiting="no server" until="a VPS is up"
treeyard set <id> status=review                 # the agent; “done” is set by a person
treeyard set <id> status=done --as you          # only at the person's word; from an agent (or --as not a person) done turns into review — the output line says so; a node with a merged, clean worktree hints `treeyard worktree rm <id>`
treeyard log <id> "what is done; what is left"
treeyard log <id> "summary, evidence" --status review --commit HEAD   # closing in one command: the entry, the status and the commits (--commit a b, --commit a,b)
treeyard log <id> --fix "corrected text"        # replace your own last entry (its time stays; status changes and commits are not touched)
treeyard set <id> note="…"                      # the node's description; the journal stays as it is
treeyard log <id> "…" --project ../main         # from a git worktree: write to the main tree (show, find, add, set and diff take it too)
treeyard note "the help doesn't fit the screen" # a note about treeyard itself — into “Notes”
treeyard rm <id>                                # delete a node added by mistake; one with a journal, children, sessions or commits is closed instead: status=dropped
treeyard decide "SQLite, not Postgres: one user" # a dated line in «Decisions» of .tree/tree.md; without text — the list (--json)
treeyard goal "Ten strangers order from us"     # the tree's goal in .tree/tree.md, only that line changes; without text — print it (--json)
treeyard rules --from - < rules.md              # the rules (tree.md without «Decisions»); the header and «Decisions» stay; without --from — print them (--json)
treeyard image <id> shot.png --note "…"         # a picture for the node (a screenshot, proof)
treeyard diff <id> --add HEAD                   # attach your commit to the node for review
treeyard commit <id> [<id>…]                    # commit the tree files of these nodes, README, tree.md and .gitattributes (chore(tree): …); never code, other nodes or the index of others
treeyard add "Codex: turn status" --project ../api --for <id>   # a change needed in another project
treeyard set <id> needs=<other id>              # waits for a node of this tree (needs=../api#<id> — of another); sets the whole list and says what it was
treeyard set <id> needs+=<other id>             # adds one link, the others stay
treeyard set <id> needs-=<other id>             # removes one link, the others stay
treeyard open root --start plan --pane          # a review of the tree in a pane
treeyard open root --start chat --brain codex   # a conversation about the project
treeyard open <id> --brain codex                # a session for the node right from the shell
treeyard open <id> --brain codex --pane         # start a pane and return to the shell
treeyard open <id> --brain opencode --pane      # the same with OpenCode
treeyard open <id> --pane --json                # for a program: the session id and the tmux pane name as JSON
treeyard open <id> <id> <id> --brain codex --pane   # three panes, one per node (--json: an array); the first stays in the project's folder, the others get a git worktree each
treeyard open <id> --brain codex --pane --worktree   # the node's own git worktree and branch treeyard/<id>, for any CLI (--no-worktree — the project's folder)
treeyard open <id> <id> --bg --json             # for a program: a JSON array, an object per started session
treeyard open <id> --bg --task "no paid calls" --model sonnet --effort high   # a coordinator hands the node to its own session
treeyard open <id> --bg --task - < task.txt     # a long assignment with quotes — from stdin
treeyard open <id> <id> <id> --bg --task "…"   # three nodes in one command: a session in each, a line per node
treeyard wait <id> <id> --timeout 10m          # a coordinator waits: a node left “active”, its session ended its turn or waits for the person (--all — every one; --json)
treeyard send <id> "fix the test"               # the next message of the node's own session, not a new session (- reads stdin); can't take it now — queued, treeyard delivers it
treeyard send <id> "which port?" --wait --timeout 10m   # a message and its answer (or the end of the turn without one)
treeyard send <id> "go on" --force               # past the brake on messages going round in a circle — only when the coordinator or the person said to
treeyard send <id> --answer "2"                  # the person's answer to a question in the session's dialog (a choice or a text)
treeyard send <id> --approve [2] --as you        # confirm a permission or startup dialog in the pane (only at the person's direct request)
treeyard send <id> --reject --as you             # decline a permission or startup dialog in the pane (only at the person's direct request)
treeyard deliver --once                          # one delivery pass over waiting messages (the deliverer usually starts by itself)
treeyard queue <id> --pane --parallel 2 --task "…"   # a queue: the node's open children in order, two sessions at a time, the next when a node leaves “active”
treeyard worktree                               # the nodes' worktrees: folder, branch, commits, what is not committed (add | setup | rm <id>)
treeyard sessions                               # the folder's sessions in every CLI, “no node” — past the tree, ▣ — a live pane (--json: pane)
treeyard sessions <id> <old-id> --replace <new-id>  # repair a node's session binding, including pane:…
treeyard sleep <id> [<id>…] [--force] [--json]  # put the live panes of nodes to sleep; keeps the session for waking; refuses on busy/waiting/attached without --force
treeyard peek <id> [--lines N] [--json]        # peek at a node's live pane screen: session status, pane name and the last N lines (default 25) without ANSI
treeyard models [brain] [--json]               # models and effort levels for CLIs (id, label, efforts)
treeyard limits [brain] [--json] [--offline]   # quota windows via Brainyard, --offline reads local snapshots
treeyard status                                 # a summary: versions, tree, nodes, skills, Codex's way to treeyard and git, pointer, hook, sessions, GitHub; a command for every problem (--json)
treeyard context <id>                           # exactly what an agent gets
treeyard pointer                                # the block about the tree in AGENTS.md / CLAUDE.md (what it says — below)
treeyard help                                   # all the commands; treeyard <command> --help — the lines of one
```

Statuses in commands are the key (`review`), the word in either language (`in review`,
`на проверке`) or a short alias (`check`, `wip`, `проверка`); a glyph copied from the output
works too. Off a terminal every line of the tree carries its status as a word after the id —
an agent never has to read or type `◐ ◎ ○`.

`treeyard add [--parent <id>] [--project <dir>] --from-json <file|->` takes an array of nodes:
`[{"title": "…", "parent": "<id>", "done_when": "…", "note": "…", "who": "agent", "status": "todo",
"check": "…", "key": "api", "needs": ["api", "k3f9", "../api#y79a"], "children": […]}]`. Only `title`
is required; top-level nodes may set their own `parent` (id, prefix or `root`), overriding
`--parent`; `key` names a node inside the batch for the `needs` of the others; `--status` and
`--who` on the command line fill in what a node doesn't say. The whole batch is checked first:
an unknown field, parent, status or ref adds no node at all.

`treeyard show --json --all` is the whole tree for a program (Treeyard Web): nothing left to
parse in the markdown of `.tree/`. Without `--all`, `--json` stays short: a node's fields and its
children. The full form:

- at the top — `version` (the JSON format, now `1`; a new field does not change it, a renamed or
  removed one does — skip keys you don't know), `title`, `goal`, `created`, `summary` and `nodes`;
  with `--under <id>` — the branch's node itself with `version` added;
- every node — the fields of the short form (`id`, `title`, `status`, `who`, `done_when`, `check`,
  `waiting`, `until`, `needs`, `for`, `sessions`, `stale`, `commits`) and also:
  - `parent`, `position` — the place among siblings of the same status (0 — first; the tree groups
    siblings by status, and `order` in the files means something only inside a group);
  - `created` and `closed` (`YYYY-MM-DD`, `closed` only for done and dropped), `updated` (ISO time);
  - `note` — the description, `""` when there is none;
  - `journal` — every entry, oldest first: `{at, who, text}` (`at` — `2026-11-12 09:42`, local time
    as the journal has it; a line without a stamp has only `text`);
  - `history` — the status changes: `{at, who, from, to, comment}`, statuses as keys (`todo`,
    `review`) whichever language wrote the line; `comment` — what follows the change, e.g. why it
    waits;
  - `images` — `{file, path, note, added}`: `path` is absolute, `added` — ISO time;
  - `children` — by status in the default order (in progress first), whatever your own setting is;
    within a status — by `position`.

`treeyard watch --json` gives the changes of the tree as people, agents and git make them: a JSON
line per event until the command is stopped (Ctrl+C, SIGTERM or a closed pipe — exit code 0).
The first line is `{"type": "ready", "version": 1, "dir", "at"}`: the watch has begun, so now
read the whole tree (`show --json --all`) and miss nothing. `version` is the format of the events,
by the same rules as in `show --json --all`. Then a line per node:

- every line has `type`, `id`, `at` (ISO time: the node's new `updated` when treeyard wrote the
  change, otherwise when it was noticed), `title` and `status` (the last one for a removed node, none for the root);
- `type` is the biggest thing that happened to the node: `added` (it appeared; also `parent` and
  `journal` — its entries), `removed` (it is gone; `parent` — where it stood), `status` (its status
  changed: `from`, `to` as keys and `who` when the journal says who), `journal` (new entries at
  the end of the journal), `changed` (another edit);
- `fields` — what changed, as the keys of `show --json --all`: `status`, `title`, `done_when`,
  `note`, `journal`, `sessions`, `updated`…; `journal` — the new entries `{at, who, text}`;
  `history` — the status changes among them `{at, who, from, to, comment}`: several when the node
  went through more than one status;
- a corrected entry (`log --fix`) is `changed` with `journal` in `fields`, not a new entry;
- the root (`tree.md`) — `{"type": "changed", "id": "root", "fields": ["goal", "body", …]}`.

The command waits until the files go quiet (150 ms) and only then compares them with the last
look: a command that writes a node three times, or a `git checkout` that rewrites fifty files,
gives one event per node. A file that can't be read (a hand edit half done) stays as it was
instead of leaving the tree.

`treeyard projects` lists the folders with trees treeyard has seen, so a program (Treeyard Web)
finds the projects by itself instead of keeping a list. A folder is remembered when a command
that reads or writes its tree runs there (`show`, `log`, `--project <dir>`…) or the tree opens
in the TUI; the list lives in `~/.treeyard/projects.json` (`$TREEYARD_HOME`), the most recently
seen first. A folder that is gone or no longer has `.tree/tree.md` is not listed but stays in the
file, so a disk that isn't mounted comes back; neither is a linked git worktree: its `.tree/` is
the branch's copy, the main checkout is the project. `treeyard projects --json` is an array of
`{"path", "title", "goal", "seen"}`: `path` — the folder's absolute real path; `title` and `goal`
from `.tree/tree.md` (`goal` is `null` when there is none); `seen` — ISO time treeyard last saw
the tree, refreshed at most every ten minutes.

Flags of `treeyard open`: `--task "…"` adds your assignment to the end of the first
message, after the standard one, under “Task for this node:” (in a `chat` start it
becomes the first message; `--task -` reads it from stdin; `treeyard context <id> --task "…"`
shows the result; with `--start goal` it becomes part of the `/goal` condition).
`--model` and `--effort` set the model and the effort for this launch only; without them the CLI
uses its own defaults. `--worktree` starts the session in the node's own
[git worktree](#git-worktrees-of-nodes), in any CLI; `--no-worktree` — in the project's folder.
`--pane` starts the session in a tmux pane (works in Claude Code, Codex, Antigravity and OpenCode)
and returns at once; the session is saved in the node. With `--pane` you can name several nodes —
`treeyard open a b c --brain <cli> --pane --task "…"` — checks every id first (a wrong one — no
session at all), starts a pane in each node one after another with the same flags, and prints a line
per node to stdout: `✓ <id> <title> · pane <name>`. A pane that fails to start is a `✗` line on
stderr; the rest still start, and the exit code is 1. `--bg` (Claude Code only) works the same way
in the background (`✓ <id> <title> · session <session id>`). With `--json`, one array on stdout (see
“Sessions next to the tree”). Several nodes without `--pane` or `--bg` are an error: in this
terminal sessions run one after another.

A coordinator follows the nodes it handed out with two commands, without polling `show` and
`git log` and without subagents of its own. `treeyard wait a b` waits until at least one node needs
it: the node left “active” (to review, waiting, done), or its newest session ended its turn,
waits for the person (a permission, a question in a dialog, or a CLI startup dialog on the pane's
screen — trusting the folder in Claude Code, Codex and Antigravity, external `CLAUDE.md` imports in
Claude Code, before the CLI itself reports the session) or ended (its pane went to sleep, its
background run is over). A node no longer active answers at once. For such a node it prints
the status (`active → in review`), the last journal entry written by a person or an agent
(the session's summary, as a rule), the session's state (when a session waits for the person in a
pane — with `tmux -L brainyard attach -t <pane>`) and the last message the session wrote,
whole, however long: the question it ended its turn with, or its summary. The message comes from
the CLI's own transcript, read through Brainyard (Claude Code, Codex, OpenCode — where Brainyard
can read the CLI's store); where there is no transcript to read, a session in a pane shows the end
of its screen instead (twelve rows with something on them), and a short pointer replaces the long
journal entry next to a whole message. Nodes still at work get a line each under “still active:”. A change of the tree wakes the command at once; the sessions are asked every three
seconds, through Brainyard. A session just started or just written to gets half a minute unless the
command has seen it at work: a CLI says “idle” at its start before its turn begins. `--all` — wait
for every node; `--timeout 10m` (or `90`, `90s`, `1h`) — how long to wait, after which the exit code
is 124 with the same lines; without it — as long as it takes. A message to your session's node
(the coordinator's: `TREEYARD_NODE` of this tree) waiting while you are busy waiting ends the
command too: it is printed whole under `✉ message #N from «…»` with how to answer, and counts as
delivered — it never comes into your conversation again. `--json` —
`{"version": 1, "timedOut", "letters", "settled", "pending"}`; `letters` — `{n, from, title, who, text,
at, replyTo}`; each node with `node`, `title`, `status`, `from` (the status when the wait began),
`reason` (`status`, `waiting`, `idle`, `gone`, `letter` — its session wrote to you — or `null`),
`entry` (`{at, who, text}`), `message` (the session's last message, `{text, source:
"transcript"|"screen"}`, or `null` — `screen` when there was no transcript to read, the text is then
the end of the pane's screen) and `session` (`{brain, id, mode, state, waitingFor, pane, screen}`;
`screen` only for a session without a transcript message). Sessions of any CLI follow handed-out
nodes with `wait`, `peek`, `send` and `sleep`; call `wait` with a `--timeout` under your shell's
limit per command and run it again on exit 124 (CLIs with background shell commands, such as Claude
Code, can also run `wait` in the background and hear when it ends).

Nodes handed out in parallel should touch different files — `wait` and `queue` check that instead of
guessing. They read every node of the project that has a worktree and is at work or in review (the
files its branch committed since it parted from the main folder's branch, `HEAD...treeyard/<id>`,
and the files not committed yet in its worktree) as well as an active node running without a
worktree in the main folder (its attached commits plus uncommitted edits beyond the baseline taken
when its session started, so the person's own edits are left out). Where two nodes touch the same
files, treeyard runs an in-memory trial three-way merge (`git merge-tree --write-tree`, with
uncommitted edits snapshotted via a temporary index, without touching working trees) so edits to
different places of one file stay quiet. Where changes genuinely collide, `wait` prints
`⚠ «A» and «B» edit the same file: path` after the nodes (a line per file, five at most, the rest
counted) — and returns at once on the first new collision (remembered in `.tree/.local/wait-seen/`,
so the next `wait` does not wake again for the same collision until a new one appears); `queue`
prints the same line as an event (`--json`: `{"type": "overlap", "a", "aTitle",
"b", "bTitle", "files"}`); `wait --json` has `conflicts` — `[{"nodes": [{"node", "title",
"status"}, …], "files": […]}]`, empty when there are none. A pair counts when at least one of its
nodes is named in the command. A file that is the same in both worktrees (a settings file copied
into each, a deletion both made) and the tree's own `.tree/` files do not count; a branch that
was merged has nothing left to meet. The worktrees are read while waiting every 15 seconds and once
more before the answer. The first time a file shows up for a pair, a letter goes to the sessions of
both nodes — once per pair and file, remembered in `.tree/.local/conflicts/` — written by treeyard,
not by a person: who the other node is, which files, and `treeyard send <it> "…"` to agree on who
changes what. A node in review is not written to (its session is not woken); the one at work is.
The letters go through the mailbox like any `send`.

`treeyard send <id> "…"` writes the next message to the node's newest session — the same
conversation going on, not a new session that would read it all again. A message is never lost or
refused for what the receiver is doing: it goes whole into the project's mailbox first
(`.tree/.local/mail/`, a file per message, not in git) and gets a number, then it is delivered — at
once if the session can take it, otherwise by itself as soon as it can:

- a live pane whose turn is over — typed as a paste and Enter;
- a sleeping pane — the same conversation resumed in a new pane (`--resume`) with the message as
  its first one; OpenCode wakes without it (its interface loses a text given at its start), and the
  message is typed in once it is ready;
- a Claude Code background session — resumed in the background (one that ended its turn is stopped
  first);
- a busy session, one waiting for the person (a permission, a question in a dialog, a startup
  dialog of trusting the folder or external `CLAUDE.md` imports — keys would
  land in it) and one open in the person's terminal — the message waits: for the end of the turn,
  for the person's answer in the pane (`tmux -L brainyard attach -t <pane>`) or in the terminal where
  the session is open (`claude attach` for a Claude Code background session),
  or for the terminal to be closed so the session can wake in a pane. With the mail hooks and plugin
  below (Claude Code, Codex, Antigravity, OpenCode), the session can also receive the message alongside
  the person's next prompt or between tool calls during a turn;
- a node with no session — the message waits for its first one: `treeyard open` and a start from
  the tree put every waiting message into its first message.

Waiting messages are delivered by treeyard itself, not by the sender: `send` starts the deliverer
`treeyard deliver` in the background — one per project; it looks at the sessions every three
seconds (every 15 after ten minutes) and ends when nothing is left to wait for. Stopped (a reboot, a
sandbox without tmux) — the next `send`, `wait` or the tree starts it again. `treeyard deliver
--once` — one pass by hand, a line per node. Several messages for one session go as one message, in
order. A session just written to or started gets a few seconds: a CLI says “idle” before its turn
begins.

`send` prints the number and the state: `message #12 delivered: typed into its pane` or `message
#12 queued: the session is busy — it arrives when its turn is over`, and what happens next on the
following line. Exit code 0 either way; 1 — there is no such node, or the brake below stopped it. `-` instead of the
text reads stdin; `--json` — `{"node", "sent": true, "letter": 12, "state": "queued"|"delivered",
"how": "typed"|"woke"|"resumed"|null, "held": "busy"|"waiting"|"terminal"|"starting"|"none"|null,
"heldFor", "brain", "id", "pane", "warnings"}`.

**The brake on messages going round in a circle.** Two sessions answering each other for ever burn
the subscription's limits and move nothing. When `mail_limit` messages (6 by default, `treeyard config
mail_limit N`, `off` — no brake) have gone between two nodes, one way or the other, and since the
first of them neither node has written a journal entry that is not a message, changed a status or
committed (a commit of the node's worktree branch counts with no hook and no `--add`), the next
`treeyard send` between them sends nothing. It prints why and what to do — ask the coordinator or the
person; write what has been done into the journal (`treeyard log`) and the count starts again; told to
go on — the same message with `--force` — and exits 1; with `--json`: `{"node", "sent": false,
"error", "reason": "ping-pong", "from", "letters", "limit"}`. The count is per pair, the letters of
other pairs do not enter it, `--force` lets one message through, and a message from a shell outside
the nodes' sessions (a person) is never braked and never counted. The journals' timestamps are
whole minutes: a message in the minute of an entry is not counted against the pair.

`--wait` — wait for the answer: the answer is the next message from the receiver's node to the
sender's (marked “answers #N”); the command prints it whole and hands it to you instead of typing it
into your conversation later. If the session got the message and ended its turn without one, waits
for the person or ended, it prints “no answer:” and its state with the end of its screen, as `wait`
does. `--timeout 10m` — how long to wait, after which the exit code is 124. With `--json` — also
`reply` (`{n, from, text, at}` or `null`), `session` (as a node in `wait --json`) and `timedOut`.

`treeyard send <id> --answer "…"` passes the person's answer to a question the node's session asks
in a dialog (Claude Code: “input needed”, Codex: “input”) in a pane: a choice's number or words —
picked with the arrows and Enter, any other text — into the row of one's own answer (“Type
something”, “Other”) and Enter. The node's journal gets `the person's answer in the dialog: «…»`. A
permission, a startup dialog (trusting the folder, external `CLAUDE.md` imports) and anything that
is not a question — refused with exit code 1 and `tmux -L brainyard attach -t <pane>`: use
`--approve` / `--reject` with `--as you` at the person's direct request, or answer in the pane. A
session that does not wait on a question, is not in a pane or shows no choices — refused too.

`treeyard send <id> --approve [choice] --as you` and `treeyard send <id> --reject --as you` confirm
or decline a permission dialog or a startup dialog (trusting the folder, external `CLAUDE.md`
imports) in the node's live pane — only when the person directly asks for it, just like
`status=done --as you`. Without `--as you` (or `--as ты` in Russian; a person at their own terminal
needs no flag), an agent gets exit code 1. The command checks that the session is waiting on a
permission or startup dialog (for a question it points to `--answer`) and reads the choices off the
pane's screen — both numbered (`1. Yes, proceed`) and unnumbered arrow lists (`> Yes, I trust this
folder` / `  No, exit`). If no dialog is visible on the screen it refuses instead of sending a blind
Enter. Without a choice, `--approve` picks the first affirmative option; with a number or words
(`--approve 2`, `--approve "Yes, proceed"`) it moves to that option and presses Enter. `--reject`
picks a negative option (`No`, `Cancel`, `Exit`, `Don't`) or presses Escape when none is listed. The
node's journal gets `permission approved: …` or `permission rejected: …` with the reason and chosen
option, and stdout prints the result and the end of the screen (with `--json`: `node`, `resolved`,
`decision`, `option`, `label`, `key`, `waitingFor`, `pane`, `screen`).

A message written by a node's session (the command knows its node by `TREEYARD_NODE` of this tree)
is correspondence between two nodes: the receiver's journal gets `message #12 from «Coordinator»:
«…»`, the sender's `message #12 to node «Site»: «…»`, a line per message whatever happens to it
next; in the receiver's conversation it arrives under the line “A message from the session of node
«…» (id), not from the person; to answer — treeyard send <id> "…"”: an agent's message never passes
for the person's word. A message from outside a node's session (a person in a shell) goes into the
receiver's journal only: `message #12 to session <cli> 1a2b3c4d: «…»`, or `message #12: «…»` to a
node with no session. `treeyard show <id> --only mail` — every message of the node, got `←` and sent
`→`, whole and with its state from this machine's mailbox (“queued: …”, “delivered: …”); messages
journals have without a mailbox (another machine, before the mailbox) — as the journal's line, no
state. With `--json`, `mail: [{n, direction: "in"|"out", peer, session, text, at, who, state, held,
heldFor, how}]`. The node's card in the TUI has a “Letters” section: the last four, each with its
state; a waiting one in yellow.

A session started by another node's session (`treeyard open` from a coordinator's session) learns
in its first message how to answer: a question — `treeyard send <coordinator's node> "…"`, then the
end of its turn; the answer comes as its next message. Codex's sandbox keeps a session away from the
tmux socket, so a Codex session asks its question as its last message and ends its turn — `treeyard
wait` shows that message (whole, from Codex's rollout; the end of the screen where the rollout cannot be read). `wait` learns that a Codex session in a pane ended its turn
from Codex's own rollout: idle Codex sessions are not on the list of live ones.

`treeyard queue <id…> --pane|--bg` keeps a queue of nodes instead of the coordinator's chat. One
node with children — its open children (to do and active, the person's own steps aside) in their
order among siblings; several ids — as named. At most `--parallel` (2) sessions at a time, for panes
also at most `max_panes` live panes of the project. The next node starts when a node leaves
“active” or its session ends; a session that ended its turn or waits for the person keeps its slot —
the queue says so, and `treeyard send` answers it. A node with `needs` on nodes of this tree waits
until they are in review or done. Before a start the queue looks at the CLI's subscription windows
(Brainyard's `usage()`, only what the CLI saved itself, no model call) and with one filled to
`--limit` (90%) starts nothing new until it resets. A line per event: `▶` started, `✓` left
“active”, `■` the session ended while the node is active, `?` ended its turn or waits for the
person, `‖` a limit or a node that never got its `needs`, `⚠` two nodes change one file (see
`wait`), `✗` did not start (no retry); `--json` —
a JSON line per event with `at`. The queue ends when all have gone (exit 0) or the rest will never
get their `needs` (exit 1). Ctrl+C — start no more; the same command again picks up the nodes at
work. The start is `do` by default; `--brain`, `--start`, `--model`, `--effort`, `--worktree`,
`--no-worktree`, `--task`, `--yes` — as for `open`. With `--parallel` from 2 one node works in the
project's folder and every other one in a worktree of its own (`--worktree` — all of them,
`--no-worktree` — none); the folder is freed when its node leaves “active”.

### Git worktrees of nodes

Sessions of one project in one folder step on each other's files. `treeyard open <id> --worktree`
gives the node a folder and a branch of its own, for **Claude Code, Codex, OpenCode and Antigravity**
alike: treeyard makes the worktree itself, not the CLI.

- **The branch** is `treeyard/<id>` — the node's id is in its name — from the commit the main folder
  stands on. The folder is `<project>.worktrees/<id>`, next to the project, so no tool of the project
  scans it. The node remembers it in `.tree/.local/worktrees.json` (per machine, out of git); the
  node's session notes the folder in its `dir`, because the CLIs find a conversation by the folder it
  ran in. Opening the node again — a new session, a resume, waking a sleeping pane — goes to the same
  worktree without the flag; `--no-worktree` sends one session to the project's folder.
- **Several nodes at once.** `open a b c --pane|--bg` and `queue` (with `--parallel` from 2) keep one
  session in the project's folder and give every other node a worktree. A folder without git, or a
  repository without a commit, makes no worktrees and the nodes stay together, as they did.
  `--worktree` gives one to every node, `--no-worktree` to none. The confirmation says which.
- **Commands from inside write the main tree.** `treeyard` (including the TUI, `show`, `log`, `add`,
  `set`, `config`…) run inside any linked git worktree of the repository — whether treeyard made it,
  `git worktree add`, or Claude Code's `.claude/worktrees/…` — finds the main checkout through the
  git common dir and reads/writes the main tree that the TUI sees, not the branch's copy of `.tree/`,
  with no `--project` needed. A worktree keeps its own `.tree/` only when the main checkout has no
  tree (only the branch has one), in a bare repository's worktree (there is no main checkout), in a
  submodule, or when targeted explicitly with `--project .` (from inside) or `--project <worktree>`.
  The session's first message says where it stands and that the branch is merged by the coordinator
  or the person.
- **Commits are the node's by themselves.** What the branch made since it started shows in the node
  (`treeyard show <id>`, the card, `V` in the tree) and in `treeyard diff <id>` — no
  [hook](#commit-hook) and no `--add`. When the branch is merged and the worktree removed, its
  commits are attached to the node for good.
- **Preparation.** The files of the main folder that git does not track and that
  `.worktreeinclude` (patterns as in `.gitignore`, in the repository's root) names — `.env`, local
  keys — are copied to a new worktree; a tracked file or one that is already there is left alone.
  Claude Code's settings of the project, `.claude/settings.local.json`, and Codex's `.codex/hooks.json`
  are copied too.
  The project's `setup` command (`treeyard config setup "npm ci"`, key `setup` in `.tree/tree.md`) runs
  in the new worktree before the session starts. A setup that fails stops the launch and says why; the
  worktree stays, and `treeyard worktree setup <id>` or the next launch runs it again.
- **Work is not lost.** `treeyard worktree rm <id>` removes the folder and the branch only when
  nothing is uncommitted and the main folder's branch has all the commits of the node's branch; or it
  says what is left, and a session still open there keeps it too. Passing several ids
  (`treeyard worktree rm a b c`) prints a line per node, does not let a refusal on one stop the rest,
  and exits with 1 if any was refused. `treeyard worktree rm --done` removes clean, merged worktrees
  of every closed node (`done` or `dropped`) and reports what was removed, what was kept and why;
  `--dry-run` only shows what would be removed or kept without changing anything. Closing a node with
  `treeyard set <id> status=done` hints `treeyard worktree rm <id>` when its worktree is merged and
  clean. There is no `--force`: it is for git (`git worktree remove`) and for the person.
- **In the tree.** `treeyard show <id>` and `show --json` give the folder, the branch and what it
  holds (`commits: 3 · not merged: 3 · not committed: 2`); the node card shows the branch and the
  folder; the launch window (`o`) has a «Worktree» row for every brain. Panes and sessions in a
  worktree count as the project's: the tree lists them, `max_panes` counts them, `wait`, `send` and
  `sessions` find them.

```sh
treeyard open <id> --brain codex --pane --worktree   # one node in its own worktree
treeyard open a b c --brain opencode --pane          # a in the project's folder, b and c in worktrees
treeyard worktree                                    # the list with what each holds (--json)
treeyard worktree add <id>                           # make one without a session; prints the folder
treeyard worktree setup <id>                         # copy by .worktreeinclude and run setup again
treeyard worktree rm <id> [<id>…]                    # only when nothing would be lost (several ids — a line each)
treeyard worktree rm --done [--dry-run]              # clean, merged worktrees of closed nodes (--dry-run only shows)
```

Undo (`u`) brings back only your own changes: if an agent has already edited the same
node, its edit stays.

### Project status

`treeyard status` shows in one command how the project is set up and what is wrong with it:

- the versions of treeyard and Brainyard;
- the folder and its tree; in a git worktree — the main tree (the one the person sees and that
  treeyard commands use automatically), not the branch's copy (pass `--project .` for the branch's copy);
- nodes by status and the abandoned ones — «in progress» with no live session and no pane for
  longer than `stale_after` hours; unlike `show`, live sessions and panes count here;
- the `treeyard`, `treeyard-init` and `treeyard-coordinate` skills in Claude Code, Codex and
  Antigravity: installed, outdated (some file differs from what came with this version), not installed, or no CLI; copies
  in the project folder (`.claude/skills`, `.agents/skills`) count too; and whether treeyard installs
  them by itself (the `skills` setting);
- Codex, when it is installed or you chose how to start it: the choice (`codex_access`) and
  whether its config.toml lets a session through to treeyard (the tmux socket) and git (the project's
  `.git`); if not, the problem comes with the lines to add to `~/.codex/config.toml` and
  `treeyard config codex_access sandbox`;
- the block about the tree in CLAUDE.md, AGENTS.md and GEMINI.md: in place, outdated, no block,
  via an import (`@AGENTS.md`), or no file;
- the post-commit git hook;
- the Claude Code and Codex hooks for letters: in the project's settings or yours, or not installed;
- the folder's live sessions in every CLI and its tmux panes — with the nodes they belong to;
- the GitHub link: the board, issues, `gh`, and statuses that have not reached GitHub yet.

It ends with «To fix»: every problem and the command that fixes it.

**The block about the tree.** A session opened in the project not from a node reads only
AGENTS.md / CLAUDE.md, so the block is how it learns about the tree. It stays short and says:
use the `treeyard` skill (`treeyard skills install` when it is not there); find the node and stay
on it; write the outcome to the journal, `review` when the criterion is met, and «done» only when
the person asks directly; a side idea is a node with a short title (2–6 words); name nodes to the
person by title, never by id; a long tree is read with `show <id> --brief` or `find`. `treeyard
pointer` writes it between `<!-- treeyard -->` markers, so it is replaced, not duplicated. When a
project has no block (or an old one), `treeyard status` says so, and the TUI shows «agents do not
know about the tree» next to the project's name: `!` or a click offers to write it.

| Problem | Command |
|---|---|
| no tree | `treeyard init` |
| an abandoned node | `treeyard set <id> status=todo` or `treeyard open <id>` |
| a skill is missing or outdated | `treeyard skills install` |
| no block about the tree, or an outdated one | `treeyard pointer` |
| no AGENTS.md, CLAUDE.md or GEMINI.md | `touch AGENTS.md && treeyard pointer` |
| no git hook | `treeyard hook install`; hooks inside the repository — `echo '…' >> <post-commit>` |
| no `gh`, not logged in, no access to boards | `brew install gh`, `gh auth login`, `gh auth refresh -s project` |
| statuses that have not reached GitHub | `treeyard github sync` |
| a broken tree file, a lost parent | `$EDITOR <file>`, `treeyard set <id> parent=root` |

From a git worktree, commands that write the tree get `--project <main folder>`. `--json` gives
the same as an object (problems have `kind`, `what`, `fix`); `--project <dir>` — the summary of
another folder. The command only reads: it writes and starts nothing, and asks `gh` only when the
tree is linked to GitHub. The exit code is 0 even with problems: it is a report, not a check.

### The root and the project's documents

The root `◆ <project>` is a stop too: `←` from a top-level branch, a click on it, or `↑`
from the list's first line. The root has its own card (`i`): the goal, progress, the
project's documents and how the tree is run. `⏎` on the root is the project's menu:
documents, “Goal, rules and decisions” (`.tree/tree.md`), settings, a new branch.

`P` (`З` in the Russian layout) opens “Project documents” from anywhere: every `.md` of
the project from Git — tracked and new, without ignored files and tree nodes; without Git
— the folder's files. `.tree/tree.md` first, then README, AGENTS, CLAUDE. `⏎` reads a
document: headings, lists, quotes, code and links in colour, `↑↓` `PgUp/PgDn` `Home/End`
scroll. `e` opens the built-in editor where you were reading:

| | |
| --- | --- |
| arrows · `PgUp` `PgDn` · `Home` `End` | cursor · page · start and end of the line (`⌃Home` `⌃End` — of the text) |
| `⌥← ⌥→` · `⌃A` `⌃E` | by words · to the start and end of the line |
| `⌃W` · `⌃K` · `⌃U` | delete a word · to the end of the line · to the start of the line |
| `⌃S` · `⌃Z` | save · undo the last edit (by words) |
| `esc` | leave; with unsaved changes — `s` save, `d` drop, `esc` stay |

If the file changes on disk while it is open (an agent, another editor), `⌃S` doesn't
silently overwrite someone else's edit: `o` — overwrite, `r` — reload from disk. A
`tree.md` whose YAML header doesn't parse is not saved; its edit is undone by `u` in the
tree, like any edit of the tree.

`treeyard docs` prints the same list in the same order, so a program (Treeyard Web) never
picks the files itself; `--project <dir>` — the tree of another folder. `treeyard docs --json`
is an array of `{"path", "title", "lines", "modified"}`: `path` from the project folder with
`/`; `title` — `title` from the document's front matter, else its first top-level heading
(`# …`, a line over `===` or `<h1>`; code blocks don't count), else the file name without
`.md`; `.tree/tree.md` is “Goal, rules and decisions” in the language of treeyard; `lines` —
as the window counts them; `modified` — ISO time of the file's last change.

The root's own document, `.tree/tree.md`, is read and changed in parts, so a program never
parses it and a change never rewrites the whole file. `treeyard goal` prints the goal (`goal`
in the header), `treeyard goal "…"` writes a new one — the goal is one line, line breaks become
spaces. `treeyard rules` prints the rules — the body without «Decisions»: the method, how the
tree is kept, rules for agents; `treeyard rules --from <file|->` writes new ones; decisions are
added with `treeyard decide`. Each command changes only its own piece: the other header keys
with their quotes, comments and sessions, and «Decisions», stay byte for byte (a section that
stood after «Decisions» is part of the rules, and «Decisions» then ends the file). Rules with
their own «Decisions» heading, empty rules and an empty goal are refused. `treeyard decide`
prints «Decisions» line by line, `treeyard decide "…"` adds one with today's date at the end of
«Decisions» (a line that already has a date keeps it) — the file gains that line and nothing else. `--json` gives `{"goal": "…"}` (`null` when there is none),
`{"rules": "…"}` and `{"decisions": [{"text": "…", "date": "2026-10-07"}]}`, after a write too:
`text` is the line as written without its `- `, `date` the last `YYYY-MM-DD` in it (`null` when
there is none); `--project <dir>` — the tree of another folder.

### Node diffs

`V` (`М` in the Russian layout), `⏎` → “Node diffs” or the palette `:` open the commits
linked to the selected node. `a` picks a commit from the Git log; `n` in the list of
commits loads 100 more. After a commit, the agent attaches it with `treeyard diff
<id> --add HEAD` — the command is in the node's context — or the
[commit hook](#commit-hook) does it by itself; the commits of the node's own
[worktree](#git-worktrees-of-nodes) branch are in the list without either. The links are kept in the node
file's `commits` field and are committed along with the tree. Attach the commits with work
on this node: the view shows the whole selected commit.

`↑↓` pick a commit or a file, `Enter` / `→` open it. The diff shows line numbers before
and after the change next to the code. Additions are green, deletions red; changed words
get a brighter background. Long lines wrap with a `↪` mark and keep their indent. Git's
service headers are hidden, and hunks are separated by line ranges. The `+`/`−` stats in
the file list are coloured too. `↑↓`, `PgUp/PgDn`, `Home/End` scroll the text. `Esc` / `←`
go back to the files, then to the commits and to the tree; `r` rereads Git. A line can be
picked with the mouse and opened with a double click. `D` in the list of linked commits
removes the link; `u` after going back to the tree undoes the link or its removal. The Git
commit itself stays where it is.

“Current project changes” is a separate item: files in the index, edits in the working
folder and new files that aren't ignored. They are shared by all nodes of this repository.
Each linked commit is shown on its own, against its parent (for a merge commit — the first
one), so commits of other nodes in between don't get into its diff. Binary files show
Git's mark instead of text. The view changes no files, no index and no Git history.

```sh
treeyard diff <id>                              # the diffs of every commit of the node
treeyard diff <id> --add HEAD                   # any ref: HEAD, HEAD~1, a branch, a tag, a short SHA; the node keeps the full SHA
treeyard diff <id> --add <ref1> <ref2>          # several commits (--add a,b and repeated --add work too)
treeyard diff <id> --rm <sha>                   # remove a link, even if the commit is gone
treeyard diff <id> --commit <ref> --file src/app.ts
treeyard diff <id> --stat                       # files and +/−, no diff text
treeyard diff <id> --working                    # the current shared changes of the project
treeyard diff <id> --json                       # commits, files and diffs for a script
treeyard diff <id> --project ../X --add HEAD    # attach to the tree of another folder or the main worktree
```

`diff --add` and `log --commit` resolve a ref (`HEAD`, a branch) in the repository of the folder
they run in when it is a git worktree of the same repository: from a session's worktree `HEAD` is
its branch's commit, with `--project <main folder>` too. From another repository — in the tree's.

#### Messages alongside a prompt and during a turn in Claude Code, Codex, Antigravity and OpenCode

Treeyard installs two hooks in Claude Code and in Codex (0.172+): `UserPromptSubmit` adds waiting
messages as `additionalContext` alongside the submitted prompt, including in a session open in your
terminal, and `PostToolUse` adds the same context after a tool call during the current turn. In
Antigravity (`agy` 1.5+), Treeyard installs a `PreInvocation` hook (`treeyard-mail`) that injects waiting
messages as `injectSteps` (`systemMessage`) before each model call — alongside the prompt (`invocationNum: 0`)
and mid-turn after tool calls (`invocationNum > 0`). In OpenCode (1.19+), which has JS plugins instead of
command hooks, Treeyard installs `treeyard-mail.js`: `chat.message` attaches waiting messages as a synthetic
part of the submitted prompt, and `tool.execute.after` appends mid-turn messages as `<system-reminder>` after
tool calls. All hooks and plugins use the usual sender and reply line for messages from other nodes. The
mailbox reports “delivered: alongside the prompt” or “delivered: in the middle of a turn” and sends each
message once.

```sh
treeyard hook claude install              # install or update both hooks in the project's .claude/settings.local.json
treeyard hook claude install --user       # or into Claude Code's own settings, for every project
treeyard hook claude status               # show both scopes and report an installation that needs updating
treeyard hook claude remove               # remove Treeyard's two entries (use --user for your own settings)

treeyard hook codex install               # install or update both hooks in the project's .codex/hooks.json
treeyard hook codex install --user        # or into ~/.codex/hooks.json ($CODEX_HOME), for every project and worktree
treeyard hook codex status                # show both scopes and report an installation that needs updating
treeyard hook codex remove                # remove Treeyard's two entries (use --user for your own settings)

treeyard hook antigravity install         # install or update PreInvocation in the project's .agents/hooks.json (alias: agy)
treeyard hook antigravity install --user  # or into ~/.gemini/config/hooks.json, for every project and worktree
treeyard hook antigravity status          # show both scopes and report an installation that needs updating
treeyard hook antigravity remove          # remove Treeyard's entry (use --user for your own settings)

treeyard hook opencode install            # install or update .opencode/plugins/treeyard-mail.js in the project
treeyard hook opencode install --user     # or into ~/.config/opencode/plugins/ ($OPENCODE_CONFIG_DIR), for every project and worktree
treeyard hook opencode status             # show both scopes and report an installation that needs updating
treeyard hook opencode remove             # remove Treeyard's plugin (use --user for your own settings)
```

`treeyard status` has a “letter hook” row for Claude Code, Codex, Antigravity and OpenCode. If you installed
`PostToolUse` before, rerun `install` in the same scope to add `UserPromptSubmit`. `remove` and `uninstall`
preserve other settings and plugins and delete empty files; project files stay out of `git status`
through `.git/info/exclude`.

- **Trusting the hook in Codex.** Codex asks you to review any new or changed hook once — in the
  “Hooks need review” prompt when a session starts or via `/hooks` inside an open session — and stores
  its hash per file in `config.toml`; trusted hooks run outside Codex's sandbox. With `--user`
  (`~/.codex/hooks.json`) you trust it once for every project and every git worktree. Claude Code,
  Antigravity and OpenCode load `.claude/settings.local.json`, `.agents/hooks.json` and
  `.opencode/plugins/treeyard-mail.js` without an extra approval step.
- **Only sessions started from a node.** The shell hook line starts with `[ -n "$TREEYARD_NODE" ]` and tests
  the node's inbox flag (`.tree/.local/mail/inbox/<node>`, which exists while messages wait for it): without a
  message the line is three shell tests, about 0.3 ms over an empty `sh -c` (3.0 against 2.7 ms), and in
  OpenCode the plugin checks `TREEYARD_NODE` and `existsSync` on the same flag in-process, so no `treeyard` is
  started unless mail waits. Any other Claude Code, Codex, Antigravity or OpenCode session — your own, in the
  same project — is not touched.
- **An already running session** may need a restart (or `/hooks` in Codex) if the CLI has yet to load
  the changes.
- **A session in a git worktree**: a [worktree of a node](#git-worktrees-of-nodes) treeyard makes
  gets a copy of the project's `.claude/settings.local.json`, `.codex/hooks.json`, `.agents/hooks.json` and
  `.opencode/plugins/treeyard-mail.js`, hooks and plugins included (one made before installation —
  `treeyard worktree setup <id>`, `install` there, or `--user`). Any other git worktree has no such files:
  they are not in git. For those sessions use `--user` (they still work only for sessions with `TREEYARD_NODE`).
- **A subagent** of the session gets nothing: the message is for the session itself.
- **Long messages** stay in the mailbox: the hook keeps letters under 9 000 characters and never cuts
  a message; one that does not fit goes the usual way (into the pane after the turn, or into the first
  message of a new session).
- The hooks and plugin leave the prompt and tool calls running if `treeyard` is missing from `PATH` or the
  mailbox is busy. The messages stay queued for the next delivery attempt. They wait up to
  two seconds for the mailbox lock.

#### Commit hook

`treeyard hook install` puts a `post-commit` hook into the repository of the current
folder, so a commit made in a session started from a node attaches to that node by itself
(the journal gets “commit attached …”, the message of the commit is untouched). A commit of
tree files only (`treeyard commit`) is not work on the node and is not attached. The
commands:

```sh
treeyard hook install    # add the hook; an existing shell post-commit gets a block between "# >>> treeyard" / "# <<< treeyard"
treeyard hook status     # is it in place, and where
treeyard hook remove     # remove only that block (the file too, if nothing else is in it)
```

The hook is one quiet line: it does nothing, and never fails a commit, when `treeyard` is
not on `PATH`. Every session from a node gets `TREEYARD_NODE` (the node),
`TREEYARD_PROJECT` (the folder of its tree) and `TREEYARD_SESSION` (this launch of the
session); the hook binds the commit to that node of that tree. Also `TREEYARD_AS` — its CLI: it
writes to the journal under that name, and its commands never count as the person's, even when it
runs them in a terminal (Antigravity does) — it cannot set “done”. OpenCode sessions from the tree
start without self-update (`OPENCODE_DISABLE_AUTOUPDATE`): the “restart after the update” window in
the middle of work swallowed input and messages.

When the session's agent moves on to another node of the same tree and sets it to active
(`treeyard set <id> status=active` or `treeyard log <id> "…" --status active`), the session's
commits go to that node from then on; setting the opening node to active brings them back.
Setting several nodes to active in one command does not move the session. A node with a session of
its own opened in the last 12 hours (it was handed to another session) takes no commits: a
coordinator that sets a child back to active is not doing the child's work. `set` and `log` say on
stderr where the commits go now. Moves are kept per
machine in `.tree/.local/sessions.json`; a session resumed later starts again from the node
it was opened from, and so do sessions started before `TREEYARD_SESSION` existed.

The hook does not fire when:

- the commit is made outside a node's session (no `TREEYARD_NODE`);
- the commit is in another repository than the tree's (the agent stepped into a neighbour);
  commits in worktrees of the project do fire;
- a session started before `TREEYARD_PROJECT` existed looks for the tree in the current
  folder, so the commit has to be inside the project;
- `core.hooksPath` points into the repository (husky and the like): those files are
  versioned, so `install` writes nothing and prints the line to add to your `post-commit`
  yourself;
- the existing `post-commit` is not a shell script: `install` refuses; add the call
  `treeyard hook post-commit` there.

With the hook in place the agent's context no longer asks for a manual `--add`.

### Notes

Anything where treeyard gets in the way or lacks something — one line, without leaving
your work, from any folder: `treeyard note "…"`. The note becomes an idea in the “Notes”
branch of the tree set by the `notes` setting (no such branch — it appears; to set it —
`,` → “Where notes go” or `treeyard config notes <folder>`). Its description says where it
came from: `From: my-app › «Close one node» (k3f9)`. The node is known when the command
runs from a session opened from a node: treeyard passes the session `TREEYARD_NODE=<id>`,
and Claude Code sessions opened earlier are recognised by their id. From a plain shell
only the project is written; you can name the node yourself: `--node <id>`. When `notes`
is set, an agent in a session from a node knows about `treeyard note` too: it's a line in
its tree commands.

### Node pictures

A screenshot of a bug or a mockup is attached to the node instead of described in words.
Copy a screenshot (`⌘⇧⌃4` on a Mac), press `I` on the node and `v` — the picture from the
clipboard is attached; opening the window alone attaches nothing. A picture file (PNG, and
on a Mac also JPG, HEIC, TIFF, GIF, BMP, WebP) can simply be dragged into the terminal
window: the terminal pastes its path, and the picture is attached to the selected node.
The node's details (`i`) show thumbnails with captions; the `I` window shows a list, a
preview, a caption (`n`), `←→` to flip through, `o` — full screen: full size in the system
viewer (Preview on a Mac). They are drawn with `▀` characters in colour — a truecolor
terminal is needed. Apple Terminal can't draw pixels and the preview there is a mosaic, so
there `⏎` opens the picture in Preview right away.

Pictures live in `.tree/.local/images/<id>/` — next to the tree, but not in git. A node
that is “done” or “dropped” keeps them for another week (undo `u` brings the node back
with them), then they are deleted; the same a week after a node is deleted.

A session from a node gets the pictures' paths and captions in its context, and the agent
opens them itself. An agent can attach a screenshot too — for example, as proof for
review:

```sh
treeyard image <id> shot.png --note "the button is in place"   # attach; --paste — from the clipboard
treeyard image <id> wide.png narrow.png --note "1440" --note "390"   # several files, a caption for each in order (one --note — for all)
treeyard image <id>                                            # paths and captions
treeyard image <id> 001.png --note "…" · --rm 001.png          # caption · delete
```

### Shared nodes

When a node needs a change in another project, the agent doesn't quietly edit there but
opens a node in that project's tree: `treeyard add "…" --project ../api --for <id>`. The
node lands in that tree's “Shared nodes” branch (no such branch — it appears; `--parent` —
another branch), and its description says where it came from. The two nodes are linked: in
yours — `needs: [../api#hv95]`, in that one — `for: [../my-app#g9ph]`; the path is from
the project's folder. Both journals get a line about the link.

What you see: on the card and under the graph — “waits for: ○ api › … · todo” and “needed
for: my-app › …”, in the tree's line — `→ api ○`; no folder or node — a grey “not found”.
A waiting node whose needs are all done comes back to the Now tab marked “can go on”.

A person doesn't need to close a shared node: the agent that did the work there sets
`treeyard set <id> status=done --project ../api` (agents may do this for such nodes), and
when a person marks their own node done, the shared one closes by itself — if nobody else
needs it. A link by hand: `treeyard set <id> needs+=../api#y79a` adds it, `needs-=…` removes
one, `needs=…` sets the whole list and prints the previous one (`needs=` with nothing — remove
all). A node of the same tree is written with just its id: `needs=y79a` (or `#y79a`, or `.#y79a` — it is
all the same); there is no such node — an error. Such a link is shown the same way, but
doesn't close anything: done on the waiting node leaves the node it waits for alone.

### A GitHub Project board

Why: tasks from a GitHub board become nodes of the tree, and status travels both ways.
Move a card on GitHub — the node changes status; mark a node active or done — the card
moves to its column.

Until anything is connected, the tree's root has a **GitHub** node. It's not a file but an
offer. `⏎` on it (or `G` anywhere) opens a three-step wizard:

1. **gh.** If it's missing, the wizard suggests `brew install gh`. If you're not signed in
   or have no access to boards, `gh auth login` / `gh auth refresh -s project` run right
   in this terminal.
2. **The repository** — taken from `git remote`. It tells the account: a GitHub Project
   board belongs not to a repository but to an account (you or an organisation). If there
   is none, you can pick one of your repositories (a remote is added) or create a new one:
   yourself (named after the folder, private or public — `tab`, no push) or by an agent (a
   node and a session: it asks the name and the visibility).
3. **The board.** Connect one of the repository owner's boards or create a new one:
   yourself (default columns) or by an agent (columns for the tree's statuses, connected
   by the agent). Or `i` — no board, only the repository's issues.

As soon as anything is connected — a board, or only the issues — the offer gives way to a
real “GitHub” node (`github: hub`), and the cards and issues go inside it. With a board,
`G` syncs the tree with the board and the issues. With only the issues the offer to
connect a board doesn't go away, it moves to that node: its line and details say “no
board”, and `⏎` on it (or `G`) asks what to do — check against the issues, or connect a
board. The second opens the same wizard at its last step, the board (the repository is
already known; the issues stay linked), and the cards come in next to the issues' nodes.
The node's own actions stay in that dialog too. Don't want the offer before anything is
connected — in the settings `,` → “GitHub node” → hide (in `tree.md` that's
`github: off`).

The same from the shell:

```sh
treeyard github link owner/1 [--parent <id>]    # or the board's link; without --parent — into the “GitHub” node
treeyard github link owner/app                  # the repository's issues (or its link), next to a board is fine
treeyard github sync                            # both ways: the board and the issues
treeyard github                                 # what it's linked to and which columns
```

`link` finds the board's Status field and guesses which column each status lives in (Todo
→ todo, In Progress → active, Review → in review, Done → done…). The guess is written to
`.tree/tree.md` in `github.columns`, where it can be fixed. If a status has no column of
its own, a card with that status stays where it is.

`sync` creates nodes for cards the tree doesn't have yet (done cards stay on the board),
without duplicates: a node's `github.item` holds its card. If the card was moved on the
board since last time, the node gets its status, and the journal gets “github · … card in
„Done“”. If the node's status changed instead, the card goes to the right column. A status
changed in the tree (`treeyard set`, `d`/`w` in the tree, the start of a session) moves
the card at once. If the move fails, that goes into the node's journal, and the next
`sync` finishes it. Everything goes through `gh` with its sign-in; the `project` scope is
needed (`gh auth refresh -s project`).

**Issues without a board.** After `link owner/repository` (`github.repo` in `tree.md`)
`sync` makes an idea node from every open issue (pull requests are left out), without
duplicates: a node's `github.issue` holds the number. An issue closed on GitHub makes the
node done (or dropped, if closed as not planned); reopened — todo. And the other way: done
in the tree closes the issue at once, dropped closes it as not planned, back to work
reopens it. “In review” doesn't close the issue: “done” is set by a person. If an issue is
also a card on the board, it's one node. A deleted or transferred issue is a line in the
node's journal; the node itself stays.

## Tree files and templates

The tree is plain md files in `.tree/` (`tree.md` and `nodes/*.md`): edit them with
anything and commit them along with the code. The view, the selected node and the open
branches are remembered in `.tree/.local/` — that folder doesn't go into git. `ui.json` is
saved when the view or the selection changes; animation frames don't write it.

Nodes live one per file, so two branches that touch different nodes merge in git without
conflicts. The overview, `.tree/README.md`, is drawn from all the nodes and committed too. So
that it doesn't conflict on every merge, the first write of the tree in a repository puts
`.tree/.gitattributes` in place (it is committed with the tree) and sets the merge driver
`merge.treeyard` in `.git/config`. On `merge`, `rebase` and `cherry-pick` the driver reads
the three versions of the overview, merges them node by node and draws the overview again,
so counters and progress are right for the merged tree. An overview that doesn't read back
(a hand edit, another format), and a clone without treeyard, merge line by line as usual.
When one node changed on both branches, the conflict stays in that node's file, and the
next write of the tree fixes the overview. Merges on GitHub don't run the driver: bring
the branch up to date locally.

The tree is read at startup and reloaded when its files change. Animation frames
reuse it; ordering work and ideas builds the tree order once per list.

When the terminal reports a loss of focus (the window is on another monitor), Treeyard
keeps showing what the agents do, only less often: the tree and node statuses every 2 s,
session statuses every 3 s, the visible session's screen every 2 s; a new frame is drawn
only when something changed. Animations and the running title stand still out of focus.
Returning to the window reads the session screen at once; typing or clicking also resumes
the interface if a focus report was lost. A running title schedules a frame only when its
visible text moves.

Focus tracking uses the [terminal's focus reports](https://www.invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-FocusIn_FocusOut)
and needs no operating-system polling. Terminals that do not send them keep the normal
foreground behaviour. Inside tmux, focus forwarding requires `focus-events on` in the
outer tmux server; Treeyard does not change that server setting. Focus reporting is
disabled when Treeyard hands the terminal to another CLI or exits.

How to run a project as a tree — [practice.md](practice.md). Templates: Stages,
Directions, Mikado, Finding improvements, Client work (`treeyard templates`).

## When treeyard crashes

An error treeyard did not expect, `SIGTERM` or `SIGHUP` (and `SIGINT` sent with `kill`) first
give the terminal back: mouse and focus reports off, line wrapping on, the main screen, the
cursor and ordinary line input. A signal then ends treeyard with the usual code (143, 129);
an error is written with treeyard's version, Node, the command and the stack to
`~/.treeyard/crashes/` (`$TREEYARD_HOME`; the last 20 are kept), and the terminal shows what
broke, the file's path and where to report it —
[github.com/antondanv/treeyard/issues](https://github.com/antondanv/treeyard/issues). A closed
pipe (`treeyard show | head`) is not a crash: treeyard exits quietly.

## Removing treeyard

`treeyard uninstall` removes everything treeyard put outside `.tree/`:

- the `treeyard`, `treeyard-init` and `treeyard-coordinate` skills from every CLI's folder —
  `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/config/skills`; a folder that is a link
  goes as a link, what it points to stays; other skills next to them are left alone;
- copies of these skills in the current project's folder (`.claude/skills`, `.agents/skills`)
  — they are the project's files in git, so other projects' copies are not touched;
- treeyard's block in the `post-commit` hook — in the current folder's repository and in every
  project treeyard has seen (`treeyard projects`); the hook's own lines stay, a file that held
  nothing but the block is deleted. Hooks inside the repository (husky and the like) are not
  edited; the command says where to take the line out;
- Treeyard's mail hooks and plugin for Claude Code, Codex, Antigravity and OpenCode
  (`treeyard hook claude`, `treeyard hook codex`, `treeyard hook antigravity`, `treeyard hook opencode`), in
  the same projects (and their node worktrees) and in Claude Code's, Codex's, Antigravity's and OpenCode's
  own settings;
- the overview's merge driver `merge.treeyard` from `.git/config`, in the same places;
  `.tree/.gitattributes` stays with the tree;
- with `--settings` — also the settings, the list of projects and the crash logs in
  `~/.treeyard` (or `$TREEYARD_HOME`), and the folder itself when nothing else is in it.

The `.tree/` tree and its block in `AGENTS.md` / `CLAUDE.md` stay: they are part of the project.

```sh
treeyard uninstall --dry-run    # only show what would be removed
treeyard uninstall              # remove the skills and the hook
treeyard uninstall --settings   # and treeyard's settings
npm uninstall -g @antondanv/treeyard
```

While treeyard is installed, the first command in a folder with a tree puts the skills back
(see [the `skills` setting](#confirmation-and-settings)), so remove the package right after,
or run `treeyard config skills off` first.

## Development

The commands to build and test are in the [README](../README.md#development).

`scripts/screenshot.ts` renders a frame of the interface and has headless Chrome take it;
`FORCE_COLOR=2` shows what Apple Terminal gets (256 colours). How it is built —
[architecture.md](architecture.md).

Treeyard runs React/Ink in `production` mode by default, so animations don't pile up debug
measurements in memory. An explicitly set `NODE_ENV` is kept; to debug React, run
`NODE_ENV=development npm run dev`.

## Abandoned «in progress»

A node in `active` that has no live session and has seen no activity for `stale_after` hours
(2 by default) is shown as «in progress · no session N h»: in tree and list rows, on the
node card (with the last journal line, to continue from), in `treeyard show` (the status
line; `--json` has `stale: { hours }`) and in the root review context, which offers to put
such nodes back to work or to continue them. Activity is the latest of: the node updated, a
journal line, a session started or opened, so a fresh node that a coordinator handed to a
subagent is not marked. A node with open children is not marked
either: its work lives in the children, and an abandoned child gets the mark itself. The TUI knows live sessions and panes; the CLI and the review
context judge by time alone. The setting is in the settings window («,»).
