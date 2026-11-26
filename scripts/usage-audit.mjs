#!/usr/bin/env node
// How agents really use the treeyard CLI, read from Claude Code and Codex transcripts:
// calls by command, pipes and loops around them, unknown commands, errors, hand edits of .tree/.
// Claude Code deletes transcripts after ~30 days, so run it every 2–3 weeks.
//
//   node scripts/usage-audit.mjs [--since 21d|2026-11-01|all] [--project <part of a path>]… [--temp]
//                                [--examples N] [--json]
//
// Transcripts come from $CLAUDE_CONFIG_DIR/projects (~/.claude) and $CODEX_HOME/sessions (~/.codex).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { commandsOf, isTreeyard, loopedTreeyard, TEMP, treeAccess, treePath as treePathOf } from './lib/shell.mjs';

const HELP = `usage: node scripts/usage-audit.mjs [options]
  --since 21d|<date>|all   only calls since then (default 21d)
  --project <text>         only sessions whose folder contains the text (repeatable)
  --temp                   also sessions and commands in temporary folders (test copies, skill runs)
  --examples N             examples per finding, the latest (default 2)
  --json                   everything as JSON, for programs`;

const { values: opts } = parseArgs({
  options: {
    since: { type: 'string', default: '21d' },
    project: { type: 'string', multiple: true, default: [] },
    temp: { type: 'boolean', default: false },
    examples: { type: 'string', default: '2' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const HOME = homedir();
const since = sinceTime(opts.since);
const EXAMPLES = Math.max(0, Number(opts.examples) || 0);

function sinceTime(value) {
  if (value === 'all') return 0;
  const days = /^(\d+)d$/.exec(value);
  if (days) return Date.now() - Number(days[1]) * 86_400_000;
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    console.error(`--since: expected 21d, a date or all, got «${value}»`);
    process.exit(2);
  }
  return time;
}

// ── transcripts ────────────────────────────────────────────────────────────

function jsonlFiles(dir) {
  const found = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) found.push({ path: p, stat: statSync(p) });
    }
  };
  walk(dir);
  return found;
}

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((x) => (typeof x === 'string' ? x : (x?.text ?? ''))).join('\n');
  return '';
};

/** Unescapes the body of a JS string literal (Codex writes its commands as JS). */
const unescapeJs = (s) =>
  s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e) => {
    if (e.length > 1 && e[0] === 'u') return String.fromCodePoint(Number.parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e.length > 1 && e[0] === 'x') return String.fromCharCode(Number.parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
  });

const BT = '`';
const JS_STRING = String.raw`"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|${BT}(?:[^${BT}\\]|\\[\s\S])*${BT}`;

/** Shell commands inside a Codex `exec` script: tools.exec_command({cmd: "…"}). */
function codexCommands(js) {
  const cmds = [...js.matchAll(new RegExp(String.raw`\bcmd\s*:\s*(${JS_STRING})`, 'g'))].map((m) =>
    unescapeJs(m[1].slice(1, -1)),
  );
  if (cmds.length || !js.includes('exec_command')) return cmds;
  // The command sits in a variable: take the literals that look like ours.
  return [...js.matchAll(new RegExp(JS_STRING, 'g'))]
    .map((m) => unescapeJs(m[0].slice(1, -1)))
    .filter((s) => /\btreeyard\b|\.tree\//.test(s));
}

const shellCalls = []; // { session, time, cmd, out, failed }
const toolEdits = []; // { session, time, tool, path }
const toolReads = []; // { session, time, tool, path }
const oldest = {};

function readClaude(file) {
  const session = { src: 'claude', id: basename(file, '.jsonl'), cwd: '' };
  const pending = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"tool_')) {
      if (!session.cwd && line.includes('"cwd"')) session.cwd = safeJson(line)?.cwd ?? '';
      continue;
    }
    const j = safeJson(line);
    if (!j) continue;
    if (j.cwd) session.cwd = j.cwd;
    const time = Date.parse(j.timestamp) || 0;
    const content = j.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type === 'tool_use') {
        const input = part.input ?? {};
        if (part.name === 'Bash' && typeof input.command === 'string') {
          const call = { session, time, cmd: input.command, out: '', failed: false };
          pending.set(part.id, call);
          shellCalls.push(call);
        }
        const path = input.file_path ?? input.notebook_path;
        if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(part.name) && typeof path === 'string')
          toolEdits.push({ session, time, tool: part.name, path });
        if (/^(Grep|Glob)$/.test(part.name) && typeof input.path === 'string')
          toolReads.push({ session, time, tool: part.name, path: input.path });
      } else if (part.type === 'tool_result' && pending.has(part.tool_use_id)) {
        const call = pending.get(part.tool_use_id);
        pending.delete(part.tool_use_id);
        call.out = textOf(part.content);
        call.failed = !!part.is_error;
      }
    }
  }
}

function readCodex(file) {
  const session = { src: 'codex', id: basename(file, '.jsonl').slice(-36), cwd: '' };
  const pending = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const j = line ? safeJson(line) : null;
    if (!j) continue;
    const p = j.payload ?? {};
    const time = Date.parse(j.timestamp) || 0;
    if (j.type === 'session_meta') session.cwd = p.cwd ?? session.cwd;
    else if (p.type === 'custom_tool_call' && typeof p.input === 'string') {
      // apply_patch, as its own tool or inside an exec script.
      for (const m of p.input.matchAll(/\*\*\* (?:Update|Add|Delete) File: ([^\s\\"'`]+)/g))
        toolEdits.push({ session, time, tool: 'apply_patch', path: m[1] });
      const calls = codexCommands(p.input).map((cmd) => ({ session, time, cmd, out: '', failed: false }));
      shellCalls.push(...calls);
      if (calls.length) pending.set(p.call_id, calls);
    } else if (p.type === 'function_call') {
      // Older Codex: a shell tool with {command: ["bash", "-lc", "…"]} or {cmd: "…"}.
      const args = safeJson(p.arguments) ?? {};
      let cmd = args.cmd ?? args.command;
      if (Array.isArray(cmd)) cmd = cmd.length >= 3 && /^-\w*c$/.test(cmd[1]) ? cmd[2] : cmd.join(' ');
      if (typeof cmd !== 'string') continue;
      const call = { session, time, cmd, out: '', failed: false };
      shellCalls.push(call);
      pending.set(p.call_id, [call]);
    } else if (/^(custom_tool_call|function_call)_output$/.test(p.type) && pending.has(p.call_id)) {
      const meta = typeof p.output === 'string' ? safeJson(p.output) : null;
      const out = typeof meta?.output === 'string' ? meta.output : textOf(p.output);
      const printed = /exit_code\\?"?[:=]\s*(\d+)|exited with code (\d+)/.exec(out);
      const code = meta?.metadata?.exit_code ?? Number(printed?.[1] ?? printed?.[2] ?? 0);
      const failed = /^Script failed/.test(out) || code !== 0;
      for (const call of pending.get(p.call_id)) Object.assign(call, { out, failed });
      pending.delete(p.call_id);
    }
  }
}

const claudeDir = join(process.env.CLAUDE_CONFIG_DIR || join(HOME, '.claude'), 'projects');
const codexDir = join(process.env.CODEX_HOME || join(HOME, '.codex'), 'sessions');
for (const [src, dir, read] of [
  ['claude', claudeDir, readClaude],
  ['codex', codexDir, readCodex],
]) {
  for (const { path, stat } of jsonlFiles(dir)) {
    oldest[src] = Math.min(oldest[src] ?? Number.POSITIVE_INFINITY, stat.birthtimeMs || stat.mtimeMs);
    // A file last written before --since holds nothing newer.
    if (stat.mtimeMs >= since) read(path);
  }
}

const keepSession = (s) =>
  (opts.temp || !TEMP.test(s.cwd)) &&
  (!opts.project.length || opts.project.some((p) => s.cwd.toLowerCase().includes(p.toLowerCase())));
const inRange = (x) => x.time >= since && keepSession(x.session);

// ── analysis ───────────────────────────────────────────────────────────────

/** Commands of the CLI as `main` dispatches them, read from the source next to this script. */
function knownCommands() {
  try {
    const src = readFileSync(new URL('../src/cli/commands.ts', import.meta.url), 'utf8');
    const start = src.indexOf('switch (command) {');
    const words = [...src.slice(start, src.indexOf('default:', start)).matchAll(/case '([^']+)':/g)].map((m) => m[1]);
    return start >= 0 && words.length ? new Set(words) : null;
  } catch {
    return null;
  }
}
const KNOWN = knownCommands();

class Groups {
  constructor() {
    this.map = new Map();
  }
  add(key, example) {
    let g = this.map.get(key);
    if (!g) {
      g = { key, count: 0, examples: [] };
      this.map.set(key, g);
    }
    g.count++;
    // Calls come oldest first: keep the latest examples.
    if (EXAMPLES && example) {
      g.examples.push(example);
      if (g.examples.length > EXAMPLES) g.examples.shift();
    }
  }
  get total() {
    let n = 0;
    for (const g of this.map.values()) n += g.count;
    return n;
  }
  list(limit = Number.POSITIVE_INFINITY) {
    return [...this.map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit);
  }
}

/** The project of a session: its folder, a Claude Code worktree folded into its repository. */
const projectOf = (session) =>
  session.cwd
    .replace(/\/\.claude\/worktrees\/[^/]+$/, '')
    .replace(/^\/private\/tmp\/claude-\d+\/[^/]+\/[^/]+\/scratchpad/, 'scratchpad')
    .replace(HOME, '~');

const example = (x, text) => ({
  time: new Date(x.time).toISOString().slice(0, 16).replace('T', ' '),
  src: x.session.src,
  project: projectOf(x.session),
  session: x.session.id,
  cmd: text.replace(/\s+/g, ' ').trim().slice(0, 200),
});

const treePath = (p, cwd) => treePathOf(p, cwd, { temp: opts.temp });

const commandsCount = new Groups();
const unknown = new Groups();
const pipes = new Groups();
const loops = new Groups();
const chains = new Groups();
const manualLoops = new Groups();
const errors = new Groups();
const edits = new Groups();
const gitByHand = new Groups();
const reads = new Groups();
const accessGroups = { edits, gitByHand, reads };
const projects = new Groups();
const usedSessions = new Set();

/** A short label of one treeyard call, for chains and runs: `set status=review`, `log --status`. */
function label(args) {
  const [sub = '', ...rest] = args;
  if (sub === 'set') {
    const keys = rest.filter((a) => /^\w+=/.test(a)).map((a) => (a.startsWith('status=') ? a : `${a.split('=')[0]}=`));
    return `set ${keys.sort().join(' ')}`.trim();
  }
  const flag = { log: '--status', diff: '--add', show: '--json', add: '--from-json' }[sub];
  return flag && rest.includes(flag) ? `${sub} ${flag}` : sub;
}

const isId = (w) => /^[0-9a-z]{4}$/.test(w) && !KNOWN?.has(w);

/**
 * What a run of calls would share if it were one command, and what it would take many of:
 * show/set/rm/commit take several ids (set — with the same values; after= puts them in a row),
 * add takes many nodes from JSON, image and diff --add take several files and refs.
 * null for a command that takes one target (log, note…).
 */
function batchOf(args) {
  const [sub = '', ...rest] = args;
  if (sub === 'add') return { key: 'add', target: rest.join(' ') };
  if (sub === 'image' || (sub === 'diff' && rest.includes('--add')))
    return { key: `${sub} ${rest[0]}`, target: rest.slice(1).join(' ') };
  if (!/^(show|set|rm|commit|open)$/.test(sub)) return null;
  const same = rest.filter((a) => !isId(a)).map((a) => (a.startsWith('after=') ? 'after=' : a));
  return { key: [sub, ...same].join(' '), target: rest.filter(isId).join(' ') };
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const NOT_FOUND = /treeyard: (command )?not found|command not found: treeyard/;

/** treeyard's own error lines (they start with ✗), raw. */
const errorLines = (out) =>
  out
    .replace(ANSI, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('✗ ') || NOT_FOUND.test(l));

/** An error line with node ids folded, for grouping; command names stay. */
const normalizeError = (line) =>
  line
    .replace(/«([0-9a-z]{4})»/g, (m, w) => (isId(w) ? '«<id>»' : m))
    .replace(/\b(?=[0-9a-z]*\d)[0-9a-z]{4}\b/g, '<id>')
    .slice(0, 140);

/**
 * The call an error line belongs to: the one whose usage it prints, the one with a word
 * the message quotes (an option, a field, an id), else the only one.
 */
function failedCall(line, mine) {
  const usage = /^✗ treeyard (\S+)/.exec(line)?.[1];
  const quoted = [...line.matchAll(/'([^']+)'|«([^»]+)»/g)].map((m) => m[1] ?? m[2]);
  const has = (t, q) => t.args.some((a) => a === q || a.startsWith(`${q}=`));
  return (
    (usage && mine.find((t) => t.args[0] === usage)) ??
    mine.find((t) => quoted.some((q) => has(t, q))) ??
    (mine.length === 1 ? mine[0] : null)
  );
}

const calls = shellCalls.filter(inRange).sort((a, b) => a.time - b.time);
const runs = new Map(); // session → the current run of the same single treeyard call
let treeyardCalls = 0;

const flushRun = (session) => {
  const run = runs.get(session);
  if (run && run.targets.size >= 3)
    manualLoops.add(`${run.label} ×${run.calls.length}, call after call`, example(run.calls[0], run.calls[0].cmd));
  runs.delete(session);
};

for (const call of calls) {
  const cmds = commandsOf(call.cmd, { vars: new Map(), cwd: call.session.cwd });
  const mine = [];
  for (const c of cmds) {
    for (const f of treeAccess(c, { temp: opts.temp })) accessGroups[f.group].add(f.key, example(call, c.text));
    // A treeyard run in a temporary copy of a tree is a test, not work on a tree.
    if (!opts.temp && TEMP.test(c.cwd)) continue;
    const looped = isTreeyard(c.name) ? null : loopedTreeyard(c.name, c.args);
    if (!isTreeyard(c.name) && !looped) continue;
    const next = c.pipeline[c.at + 1];
    mine.push({
      args: looped ? looped.args : c.args,
      loop: looped ? { kind: looped.kind, text: c.text } : c.loop,
      pipeTo: next?.name ?? null,
      text: next ? `${c.text} | ${next.text}` : c.text,
    });
  }
  // Shell functions that wrap treeyard and run more than once: a loop by other means.
  for (const m of call.cmd.matchAll(/(?:^|[\s;&|])(\w+)\s*\(\)\s*\{[^}]*\btreeyard\s+([\w-]+)/g)) {
    const runsOf = cmds.filter((c) => c.name === m[1]).length;
    if (runsOf >= 2) loops.add(`function ${m[1]}() … treeyard ${m[2]}, run ${runsOf}×`, example(call, call.cmd));
  }
  if (!mine.length) {
    flushRun(call.session);
    continue;
  }
  usedSessions.add(call.session);
  projects.add(projectOf(call.session));
  treeyardCalls += mine.length;
  for (const t of mine) {
    const sub = t.args[0] ?? '';
    commandsCount.add(sub || '(none)');
    if (!sub) unknown.add('(none: opens the TUI, which an agent cannot drive)', example(call, t.text));
    else if (KNOWN && !KNOWN.has(sub)) unknown.add(sub, example(call, t.text));
    if (t.pipeTo) pipes.add(`${label(t.args)} | ${t.pipeTo}`, example(call, t.text));
    if (t.loop) loops.add(`${t.loop.kind} … treeyard ${sub}`, example(call, t.loop.text));
  }
  if (mine.length >= 2)
    chains.add(mine.map((t) => label(t.args)).join(' → '), example(call, mine.map((t) => t.text).join(' ; ')));
  // The same command on 3+ targets in one call, where one command would take them all.
  const batched = Map.groupBy(
    mine.filter((t) => !t.loop && batchOf(t.args)),
    (t) => batchOf(t.args).key,
  );
  for (const [key, same] of batched) {
    if (same.length >= 3 && new Set(same.map((t) => batchOf(t.args).target)).size >= 3)
      manualLoops.add(`${key} ×${same.length}, in one call`, example(call, same.map((t) => t.text).join(' ; ')));
  }

  const lines = errorLines(call.out);
  for (const line of new Set(lines)) {
    const t = failedCall(line, mine);
    const where = t ? t.args[0] || '(none)' : [...new Set(mine.map((x) => x.args[0] ?? ''))].join('+');
    errors.add(`${where}: ${normalizeError(line)}`, example(call, t ? t.text : call.cmd));
  }
  // A failure with no ✗ line from a call that runs nothing but treeyard: a crash, a timeout.
  if (call.failed && !lines.length && cmds.length === mine.length) {
    const out = call.out.split('\n');
    const line =
      out.find((l) => /^\w*Error\b|^error:/i.test(l)) ??
      out.find((l) => l && !/^(Exit code|Script failed|Wall time|Output:)/.test(l)) ??
      '';
    errors.add(
      `${mine[0].args[0] ?? ''}: failed: ${line.trim().slice(0, 120) || '(no output)'}`,
      example(call, call.cmd),
    );
  }

  // Calls in a row, one target each, where one command would take them all.
  const single = mine.length === 1 && cmds.length === 1 ? batchOf(mine[0].args) : null;
  const run = runs.get(call.session);
  if (single && run && run.label === single.key) {
    run.calls.push(call);
    run.targets.add(single.target);
  } else {
    flushRun(call.session);
    if (single) runs.set(call.session, { label: single.key, calls: [call], targets: new Set([single.target]) });
  }
}
for (const session of [...runs.keys()]) flushRun(session);

for (const e of toolEdits.filter(inRange)) {
  const rel = treePath(e.path, e.session.cwd);
  if (rel) edits.add(`${e.tool} ${rel}`, example(e, `${e.tool} ${e.path}`));
}
for (const r of toolReads.filter(inRange)) {
  const rel = treePath(r.path, r.session.cwd);
  if (rel) reads.add(`${r.tool} ${rel}`, example(r, `${r.tool} ${r.path}`));
}

// ── report ─────────────────────────────────────────────────────────────────

const used = [...usedSessions];
const bySrc = (src) => used.filter((s) => s.src === src).length;
const day = (t) => new Date(t).toISOString().slice(0, 10);
const findings = {
  pipes: pipes.list(),
  loops: loops.list(),
  manualLoops: manualLoops.list(),
  unknown: unknown.list(),
  errors: errors.list(30),
  edits: edits.list(),
  gitByHand: gitByHand.list(),
  chains: chains.list(15),
  reads: reads.list(15),
};

if (opts.json) {
  const total = (g) => g.total;
  console.log(
    JSON.stringify(
      {
        since: since ? new Date(since).toISOString() : null,
        sessions: { claude: bySrc('claude'), codex: bySrc('codex') },
        treeyardCalls,
        projects: Object.fromEntries(projects.list().map((g) => [g.key, g.count])),
        commands: Object.fromEntries(commandsCount.list().map((g) => [g.key, g.count])),
        totals: Object.fromEntries(
          Object.entries({ pipes, loops, manualLoops, unknown, errors, edits, gitByHand, chains, reads }).map(
            ([k, g]) => [k, total(g)],
          ),
        ),
        ...findings,
      },
      null,
      1,
    ),
  );
} else printText();

function printText() {
  const out = [];
  const say = (s = '') => out.push(s);
  const section = (title, groups, total, hint = '') => {
    say();
    say(`${title}: ${total}${hint && total ? `  — ${hint}` : ''}`);
    for (const g of groups) {
      say(`  ${String(g.count).padStart(4)}  ${g.key}`);
      for (const e of g.examples)
        say(`        ${e.time} ${e.src} ${basename(e.project)} ${e.session.slice(0, 8)}: ${e.cmd}`);
    }
  };
  const onDisk = (src) => (Number.isFinite(oldest[src]) ? day(oldest[src]) : 'none');

  say(
    `treeyard in agent transcripts, ${since ? day(since) : 'all'} … ${day(Date.now())}` +
      (opts.project.length ? `, projects: ${opts.project.join(', ')}` : ''),
  );
  say(`on disk since: claude ${onDisk('claude')}, codex ${onDisk('codex')} (Claude Code keeps ~30 days)`);
  say(
    `sessions with treeyard: ${used.length} (claude ${bySrc('claude')}, codex ${bySrc('codex')}); treeyard calls: ${treeyardCalls}` +
      (opts.temp ? '' : '; temporary folders left out (--temp)'),
  );
  say(
    `projects: ${
      projects
        .list(8)
        .map((g) => `${g.key} ${g.count}`)
        .join(' · ') || '—'
    }`,
  );
  say();
  say(
    `problems: pipes ${pipes.total} · loops ${loops.total} · hand-written loops ${manualLoops.total} · ` +
      `unknown commands ${unknown.total} · errors ${errors.total} · hand edits of .tree/ ${edits.total} · git on .tree/ ${gitByHand.total}`,
  );
  say();
  say(
    `commands: ${
      commandsCount
        .list()
        .map((g) => `${g.key} ${g.count}`)
        .join(' · ') || '—'
    }`,
  );
  if (!KNOWN) say('(src/cli/commands.ts not found: unknown commands are not checked)');
  section('pipes out of treeyard', findings.pipes, pipes.total, '--brief, --only, find instead of head and grep');
  section(
    'loops around treeyard',
    findings.loops,
    loops.total,
    'several ids in one command: set a b c, show a b, add --from-json',
  );
  section('hand-written loops (the same command on 3+ ids)', findings.manualLoops, manualLoops.total);
  section('unknown commands', findings.unknown, unknown.total);
  section('errors (top 30)', findings.errors, errors.total);
  section('hand edits of .tree/', findings.edits, edits.total, 'only treeyard writes .tree/');
  section('git on .tree/ by hand', findings.gitByHand, gitByHand.total, 'treeyard commit <id>');
  section(
    'several treeyard calls in one tool call (top 15)',
    findings.chains,
    chains.total,
    'log … --status review --commit HEAD',
  );
  section('shell reads of .tree/ (top 15)', findings.reads, reads.total, 'treeyard show --brief, find');
  console.log(out.join('\n'));
}
