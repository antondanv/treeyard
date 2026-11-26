#!/usr/bin/env node
// Runs the skill scenarios of test/skill-evals/treeyard.json on models of Claude Code and Codex
// in a clean stand, and prints a table of the rules they break.
//
//   node scripts/skill-evals.mjs run [model…] [--scenario id[,id]] [--jobs N] [--out dir] [--keep]
//   node scripts/skill-evals.mjs report <run folder>… [--examples N] [--json]
//
// A model is `haiku@low`, `sonnet@medium`, `opus`, `gpt-6-luna@low` (@ is the reasoning effort;
// `claude:` or `codex:` in front picks the CLI when the name does not say). No models — the five
// of the last full run. The scenarios are chains (`follows`): one session, one stand, the next
// query resumes it; a scenario without `follows` gets a fresh stand and a new session.
//
// A stand is test/skill-evals/fixture.sh, rebuilt per model and chain. Claude Code gets only the
// project's settings and skills (`--setting-sources project,local`), Codex has the skills of the
// user switched off. Codex's workspace-write sandbox keeps .git read-only, so a session cannot
// commit; the stand's .git folders are writable roots for it. A git add/commit that is blocked
// anyway is not held against the model: the commit expectations of that query are skipped.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { commandsOf, isTreeyard, loopedTreeyard, treeAccess, treePath } from './lib/shell.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOME = homedir();
const DEFAULT_MODELS = ['haiku@low', 'sonnet@medium', 'opus@medium', 'gpt-6-luna@low', 'gpt-5.6-luna@low'];
const PROJECTS = ['tipcalc', 'money'];

const HELP = `usage:
  node scripts/skill-evals.mjs run [model…] [options]
      model             haiku@low, sonnet@medium, opus, gpt-6-luna@low … (default: ${DEFAULT_MODELS.join(' ')})
      --scenario ids    only these scenarios, comma separated; the ones they follow run first
      --scenarios file  the scenarios (default test/skill-evals/treeyard.json)
      --jobs N          runs at the same time (default 2)
      --timeout min     per query (default 15)
      --treeyard path   the treeyard to test (default dist/cli/main.js: build it first)
      --out dir         the run folder (default: a new one in the temporary folder)
      --keep            keep the stands (tipcalc, money) after the run
  node scripts/skill-evals.mjs report <run folder>… [options]
      --examples N      details shown per model and scenario (default 3)
      --json            everything as JSON`;

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const oneLine = (s, n = 160) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);

// ── models and scenarios ───────────────────────────────────────────────────

export function parseSpec(text) {
  const m = /^(?:(claude|codex):)?([^@]+)(?:@(\w+))?$/.exec(text);
  if (!m) throw new Error(`model «${text}»: expected haiku, sonnet@medium, gpt-6-luna@low …`);
  const [, driver, model, effort] = m;
  return {
    label: text.replace(/^(claude|codex):/, ''),
    driver: driver ?? (/^(gpt|codex|o\d)/.test(model) ? 'codex' : 'claude'),
    model,
    effort: effort ?? null,
  };
}

/** Scenarios in runs: a chain is a scenario and those that follow it, one session in one stand. */
export function chainsOf(scenarios, only = []) {
  const chains = [];
  for (const s of scenarios) {
    const chain = s.follows ? chains.find((c) => c.at(-1).id === s.follows) : null;
    if (s.follows && !chain) throw new Error(`scenario ${s.id} follows ${s.follows}, which does not come right before`);
    if (chain) chain.push(s);
    else chains.push([s]);
  }
  if (!only.length) return chains;
  for (const id of only) if (!scenarios.some((s) => s.id === id)) throw new Error(`no scenario «${id}»`);
  // The predecessors have to run, the rest of the chain does not.
  return chains
    .map((chain) => chain.slice(0, Math.max(...only.map((id) => chain.findIndex((s) => s.id === id))) + 1))
    .filter((chain) => chain.length);
}

// ── transcripts of the two CLIs ────────────────────────────────────────────

/**
 * The stream of `claude -p --output-format stream-json` as events:
 * { kind: 'text' | 'shell' | 'edit' | 'skill' | 'read', … } and what the CLI says about the run.
 */
export function parseClaude(text) {
  const events = [];
  const meta = {};
  const pending = new Map();
  for (const line of text.split('\n')) {
    const j = line ? safeJson(line) : null;
    if (!j) continue;
    if (j.type === 'system' && j.subtype === 'init') Object.assign(meta, { model: j.model, session: j.session_id });
    else if (j.type === 'result')
      Object.assign(meta, {
        cost: j.total_cost_usd,
        turns: j.num_turns,
        error: j.is_error ? oneLine(j.result ?? j.subtype) : null,
      });
    else if (j.type === 'assistant' || j.type === 'user') {
      for (const part of Array.isArray(j.message?.content) ? j.message.content : []) {
        if (part.type === 'text' && j.type === 'assistant') events.push({ kind: 'text', text: part.text });
        else if (part.type === 'tool_use') {
          const input = part.input ?? {};
          if (part.name === 'Bash') {
            const e = { kind: 'shell', cmd: String(input.command ?? ''), out: '', failed: false };
            pending.set(part.id, e);
            events.push(e);
          } else if (part.name === 'Skill')
            events.push({ kind: 'skill', name: String(input.skill ?? input.name ?? '') });
          else if (part.name === 'Read') events.push({ kind: 'read', path: String(input.file_path ?? '') });
          else if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(part.name))
            events.push({ kind: 'edit', tool: part.name, path: String(input.file_path ?? input.notebook_path ?? '') });
        } else if (part.type === 'tool_result' && pending.has(part.tool_use_id)) {
          const e = pending.get(part.tool_use_id);
          const c = part.content;
          e.out = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x?.text ?? '').join('\n') : '';
          e.failed = !!part.is_error;
        }
      }
    }
  }
  return { events, meta };
}

/** The JSONL of `codex exec --json`. */
export function parseCodex(text) {
  const events = [];
  const meta = {};
  for (const line of text.split('\n')) {
    const j = line ? safeJson(line) : null;
    if (!j) continue;
    if (j.type === 'thread.started') meta.session = j.thread_id;
    else if (j.type === 'turn.failed' || j.type === 'error')
      meta.error = oneLine(j.error?.message ?? j.message ?? 'error');
    else if (j.type === 'item.completed') {
      const item = j.item ?? {};
      if (item.type === 'agent_message') events.push({ kind: 'text', text: String(item.text ?? '') });
      else if (item.type === 'command_execution')
        events.push({
          kind: 'shell',
          cmd: String(item.command ?? ''),
          out: String(item.aggregated_output ?? ''),
          failed: item.exit_code !== 0 && item.exit_code !== null,
        });
      else if (item.type === 'file_change')
        for (const c of item.changes ?? [])
          events.push({ kind: 'edit', tool: 'apply_patch', path: String(c.path ?? '') });
    }
  }
  return { events, meta };
}

/** git add/commit calls that failed on a permission error: the sandbox, not the model. */
export const blockedGit = (events) =>
  events.filter(
    (e) =>
      e.kind === 'shell' &&
      /\bgit\b[^|;&]*\b(commit|add)\b/.test(e.cmd) &&
      /not permitted|index\.lock|read-only/i.test(e.out),
  ).length;

// ── the audit of one scenario run ──────────────────────────────────────────

export const CODES = ['pipe', 'loop', 'hand-edit', 'done', 'id', 'other', 'skill', 'title'];
const DONE_WORDS = /^(done|готово|готов|готовые|closed|finished|сделано)$/i;
const SKILL_FILE = /skills\/treeyard\/SKILL\.md/;

const nodesOf = (snap, project) => snap?.[project]?.nodes ?? [];
const byId = (nodes) => new Map(nodes.map((n) => [n.id, n]));

/** What a run broke: [{ code, detail }]; transcript events and the stand before and after. */
export function audit(meta, events) {
  const found = [];
  const add = (code, detail) => found.push({ code, detail: oneLine(detail) });
  const scenario = meta.scenario;
  const asks = scenario.asks ?? [];
  const cwd = meta.stand.tipcalc;
  const ids = new Set(
    PROJECTS.flatMap((p) => [...nodesOf(meta.before, p), ...nodesOf(meta.after, p)].map((n) => n.id)).filter(
      (id) => id !== 'root',
    ),
  );
  const idRe = ids.size ? new RegExp(`(?<![\\w-])(?:${[...ids].join('|')})(?![\\w-])`) : null;
  const needsSkill = !scenario.follows && (scenario.skills ?? []).length > 0;

  let skillSeen = false;
  let treeyardSeen = false;
  let skillBroken = false;
  const doneBy = []; // commands that tried to close a node
  for (const e of events) {
    if (e.kind === 'skill' && /treeyard/.test(e.name)) skillSeen = true;
    else if (e.kind === 'read' && SKILL_FILE.test(e.path)) skillSeen = true;
    else if (e.kind === 'text') {
      const m = idRe?.exec(e.text);
      if (m) add('id', `«${e.text.slice(Math.max(0, m.index - 30), m.index + 40)}»`);
    } else if (e.kind === 'edit') {
      const rel = treePath(e.path, cwd, { temp: true });
      if (rel) add('hand-edit', `${e.tool} ${rel}`);
    } else if (e.kind === 'shell') {
      for (const c of commandsOf(e.cmd, { vars: new Map(), cwd })) {
        if (c.words.some((w) => SKILL_FILE.test(w))) skillSeen = true;
        for (const f of treeAccess(c, { temp: true })) if (f.group !== 'reads') add('hand-edit', `${f.key}: ${c.text}`);
        const looped = isTreeyard(c.name) ? null : loopedTreeyard(c.name, c.args);
        if (!isTreeyard(c.name) && !looped) continue;
        if (needsSkill && !skillSeen && !treeyardSeen && !skillBroken) {
          skillBroken = true;
          add('skill', `a treeyard call before the skill: ${c.text}`);
        }
        treeyardSeen = true;
        const args = looped ? looped.args : c.args;
        const next = c.pipeline[c.at + 1];
        if (next) add('pipe', `${c.text} | ${next.text}`);
        if (looped || c.loop) add('loop', looped ? c.text : (c.loop?.text ?? c.text));
        // Closing a node of the other project's tree (`--project ../money`, or from its folder) is asked for.
        const elsewhere = args.includes('--project') || (c.cwd ?? '').startsWith(meta.stand.money);
        const done =
          (args[0] === 'set' && args.some((a) => /^status=/.test(a) && DONE_WORDS.test(a.slice(7)))) ||
          (args[0] === 'log' &&
            args.some(
              (a, k) =>
                (a === '--status' && DONE_WORDS.test(args[k + 1] ?? '')) ||
                (a.startsWith('--status=') && DONE_WORDS.test(a.slice(9))),
            ));
        if (done && !elsewhere && !asks.includes('close')) doneBy.push(c.text);
      }
    }
  }
  for (const d of doneBy) add('done', d);
  if (needsSkill && !skillSeen && !skillBroken) add('skill', 'the skill was never loaded');

  // State: what became done, what changed in the other project, how new nodes are titled.
  const before = byId(nodesOf(meta.before, 'tipcalc'));
  const wanted = new Set(meta.expectSpec?.newlyDone ?? []);
  if (!doneBy.length)
    for (const n of nodesOf(meta.after, 'tipcalc'))
      if (n.status === 'done' && before.get(n.id)?.status !== 'done' && !wanted.has(n.title))
        add('done', `«${n.title}» became done`);
  const moneyChanged = meta.after?.money?.changed ?? [];
  const baseNodes = nodesOf(meta.base, 'money').length;
  const moneyNodes = nodesOf(meta.after, 'money').length;
  if (moneyChanged.length) {
    if (!asks.includes('fix-other-project'))
      add('other', `money changed without being asked: ${moneyChanged.join(', ')}`);
    else if (moneyNodes <= baseNodes) add('other', `money changed with no node of its own: ${moneyChanged.join(', ')}`);
  }
  for (const p of PROJECTS) {
    const was = byId(nodesOf(meta.before, p));
    for (const n of nodesOf(meta.after, p).filter((x) => !was.has(x.id)))
      if (n.title.length > 60 || n.title.trim().split(/\s+/).length > 6) add('title', `«${n.title}»`);
  }
  return found;
}

// ── the stand ──────────────────────────────────────────────────────────────

function flatten(nodes, out = []) {
  for (const n of nodes ?? []) {
    const { children, journal, history, images, ...rest } = n;
    out.push({ ...rest, journal: (journal ?? []).length });
    flatten(children, out);
  }
  return out;
}

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Both trees and git of a stand; `changed` is what differs from `since` outside .tree/. */
function snapshot(stand, env, since = {}) {
  const snap = {};
  for (const p of PROJECTS) {
    const cwd = join(stand, p);
    const tree =
      safeJson(execFileSync(env.TREEYARD_BIN, ['show', '--json', '--all'], { cwd, env, encoding: 'utf8' })) ?? {};
    const head = git(cwd, 'rev-parse', 'HEAD');
    const changed = since[p]
      ? [
          ...git(cwd, 'diff', '--name-only', since[p].head).split('\n'),
          ...git(cwd, 'ls-files', '--others', '--exclude-standard').split('\n'),
        ].filter((f) => f && !f.startsWith('.tree/'))
      : [];
    snap[p] = { nodes: flatten(tree.nodes), head, commits: Number(git(cwd, 'rev-list', '--count', 'HEAD')), changed };
  }
  return snap;
}

function checkExpect(expect, { stand, env, before, after, base, blocked }) {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });
  const skip = (name, why) => results.push({ name, ok: true, skipped: why });
  const titles = (snap, p) => nodesOf(snap, p);
  for (const [title, status] of Object.entries(expect.status ?? {})) {
    const node = titles(after, 'tipcalc').find((n) => n.title === title);
    check(`«${title}» is ${status}`, node?.status === status, node ? `is ${node.status}` : 'no such node');
  }
  for (const r of expect.run ?? []) {
    let out = '';
    let code = 0;
    try {
      out = execFileSync('sh', ['-c', r.cmd], {
        cwd: join(stand, r.in),
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
      });
    } catch (e) {
      code = e.status ?? 1;
      out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    const exit = r.exit ?? (r.includes ? undefined : 0);
    const ok = (exit === undefined || code === exit) && (!r.includes || out.includes(r.includes));
    check(
      `${r.in}: ${r.cmd}${r.includes ? ` → «${r.includes}»` : ''}`,
      ok,
      ok ? '' : oneLine(`exit ${code}: ${out}`, 100),
    );
  }
  if (expect.newIdea) {
    const was = byId(titles(before, 'tipcalc'));
    const idea = titles(after, 'tipcalc').find((n) => !was.has(n.id) && n.status === 'idea');
    check('a new idea node in tipcalc', !!idea, idea ? `«${idea.title}»` : 'none');
  }
  if (expect.newNodeIn) {
    for (const p of expect.newNodeIn)
      check(
        `a node of its own in ${p}`,
        titles(after, p).length > titles(base, p).length,
        `${titles(base, p).length} → ${titles(after, p).length} nodes`,
      );
  }
  for (const p of expect.untouched ?? [])
    check(`${p} is untouched`, !(after[p]?.changed ?? []).length, (after[p]?.changed ?? []).join(', '));
  if (expect.treeUnchanged) {
    const was = byId(titles(before, 'tipcalc'));
    const moved = titles(after, 'tipcalc').filter(
      (n) => was.get(n.id) && (was.get(n.id).status !== n.status || was.get(n.id).journal !== n.journal),
    );
    const added = titles(after, 'tipcalc').filter((n) => !was.has(n.id));
    check(
      'the tree of tipcalc is unchanged',
      !moved.length && !added.length,
      [...moved, ...added].map((n) => `«${n.title}»`).join(', '),
    );
  }
  if (expect.newlyDone) {
    const was = byId(titles(before, 'tipcalc'));
    const now = titles(after, 'tipcalc')
      .filter((n) => n.status === 'done' && was.get(n.id)?.status !== 'done')
      .map((n) => n.title);
    check(
      `done now: ${expect.newlyDone.map((t) => `«${t}»`).join(', ')}`,
      now.length === expect.newlyDone.length && expect.newlyDone.every((t) => now.includes(t)),
      now.map((t) => `«${t}»`).join(', ') || 'none',
    );
  }
  for (const p of expect.commits ?? []) {
    const name = `${p} has a new commit`;
    if (blocked) skip(name, 'git was blocked by the sandbox');
    else check(name, (after[p]?.commits ?? 0) > (before[p]?.commits ?? 0), '');
  }
  return results;
}

// ── run ────────────────────────────────────────────────────────────────────

function claudeArgs(spec, scenario, session, stand, resume) {
  const args = [
    '-p',
    scenario.query,
    '--model',
    spec.model,
    '--setting-sources',
    'project,local',
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    'Bash,Skill,Read,Edit,Write',
    '--add-dir',
    join(stand, 'money'),
    '--output-format',
    'stream-json',
    '--verbose',
    resume ? '--resume' : '--session-id',
    session,
  ];
  if (spec.effort) args.push('--effort', spec.effort);
  return args;
}

function codexArgs(spec, scenario, session, stand) {
  const skills = [join(HOME, '.codex/skills'), join(HOME, '.agents/skills')].flatMap((dir) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(dir, d.name, 'SKILL.md')))
          .map((d) => `{path="${join(dir, d.name, 'SKILL.md')}",enabled=false}`)
      : [],
  );
  const args = [
    'exec',
    ...(session ? ['resume', session] : []),
    '--json',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '-m',
    spec.model,
    '-c',
    'sandbox_mode="workspace-write"',
    '-c',
    `sandbox_workspace_write.writable_roots=[${[
      join(stand, 'money'),
      join(stand, 'home'),
      join(stand, 'tipcalc/.git'),
      join(stand, 'money/.git'),
    ]
      .map((dir) => `"${dir}"`)
      .join(',')}]`,
    '-c',
    `skills.config=[${skills.join(',')}]`,
    scenario.query,
  ];
  if (spec.effort) args.splice(args.indexOf('-m'), 0, '-c', `model_reasoning_effort="${spec.effort}"`);
  return args;
}

function spawnTo(cmd, args, { cwd, env, file, timeout }) {
  return new Promise((resolve) => {
    const out = openSync(file, 'w');
    const stderr = [];
    const started = Date.now();
    let timedOut = false;
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', out, 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    child.stderr.on('data', (d) => stderr.push(d));
    const finish = (code, extra = '') => {
      clearTimeout(timer);
      closeSync(out);
      resolve({
        code,
        timedOut,
        seconds: Math.round((Date.now() - started) / 1000),
        stderr: oneLine(extra || Buffer.concat(stderr).toString().slice(-600), 300),
      });
    };
    child.on('error', (e) => finish(-1, String(e)));
    child.on('close', (code) => finish(code));
  });
}

async function runChain({ spec, chain, dir, env, shim, opts }) {
  const stand = join(dir, 'stand');
  execFileSync('bash', [join(ROOT, 'test/skill-evals/fixture.sh'), stand], {
    env: { HOME, USER: process.env.USER ?? '', PATH: env.PATH },
    stdio: 'pipe',
  });
  const standEnv = {
    HOME,
    USER: process.env.USER ?? '',
    PATH: env.PATH,
    TREEYARD_HOME: join(stand, 'home'),
    TREEYARD_BIN: shim,
  };
  const { TREEYARD_BIN, ...agentEnv } = standEnv;
  let session = spec.driver === 'claude' ? randomUUID() : null;
  let base = null;
  let resume = false;
  const cwd = join(stand, 'tipcalc');
  for (const scenario of chain) {
    const before = snapshot(stand, standEnv);
    base ??= before;
    const file = join(dir, `${scenario.id}.jsonl`);
    const run =
      spec.driver === 'claude'
        ? await spawnTo('claude', claudeArgs(spec, scenario, session, stand, resume), {
            cwd,
            env: agentEnv,
            file,
            timeout: opts.timeout,
          })
        : await spawnTo('codex', codexArgs(spec, scenario, session, stand), {
            cwd,
            env: agentEnv,
            file,
            timeout: opts.timeout,
          });
    resume = true;
    const text = readFileSync(file, 'utf8');
    const parsed = spec.driver === 'claude' ? parseClaude(text) : parseCodex(text);
    if (spec.driver === 'codex') session ??= parsed.meta.session ?? null;
    const after = snapshot(stand, standEnv, before);
    const meta = {
      label: spec.label,
      driver: spec.driver,
      model: parsed.meta.model ?? spec.model,
      effort: spec.effort,
      scenario: {
        id: scenario.id,
        follows: scenario.follows ?? null,
        skills: scenario.skills ?? [],
        asks: scenario.asks ?? [],
        query: scenario.query,
      },
      expectSpec: scenario.expect ?? {},
      stand: { tipcalc: cwd, money: join(stand, 'money') },
      session: parsed.meta.session ?? session,
      exit: run.code,
      timedOut: run.timedOut,
      seconds: run.seconds,
      cost: parsed.meta.cost ?? null,
      turns: parsed.meta.turns ?? null,
      error: parsed.meta.error ?? (run.code ? run.stderr : null),
      before,
      base,
      after,
      expect: checkExpect(scenario.expect ?? {}, {
        stand,
        env: standEnv,
        before,
        after,
        base,
        blocked: blockedGit(parsed.events),
      }),
    };
    writeFileSync(join(dir, `${scenario.id}.json`), `${JSON.stringify(meta, null, 1)}\n`);
    const found = audit(meta, parsed.events);
    const missed = meta.expect.filter((r) => !r.ok).length;
    console.error(
      `[${spec.label}] ${scenario.id}: ${run.seconds}s${meta.cost ? ` $${meta.cost.toFixed(3)}` : ''}` +
        `, ${found.length ? `${found.length} to fix (${[...new Set(found.map((f) => f.code))].join(' ')})` : 'clean'}` +
        `${missed ? `, ${missed} expectations missed` : ''}${run.timedOut ? ', TIMED OUT' : run.code ? `, exit ${run.code}` : ''}`,
    );
  }
  if (!opts.keep) rmSync(stand, { recursive: true, force: true });
}

async function pool(jobs, size) {
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await job();
    }),
  );
}

function newestSource() {
  let newest = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  walk(join(ROOT, 'src'));
  return newest;
}

async function run(args, opts) {
  const specs = (args.length ? args : DEFAULT_MODELS).map(parseSpec);
  const scenariosFile = opts.scenarios ?? join(ROOT, 'test/skill-evals/treeyard.json');
  const scenarios = JSON.parse(readFileSync(scenariosFile, 'utf8'));
  const chains = chainsOf(scenarios, opts.scenario);
  const bin = opts.treeyard ?? join(ROOT, 'dist/cli/main.js');
  if (!existsSync(bin)) throw new Error(`${bin} not found: npm run build, or --treeyard <path>`);
  if (!opts.treeyard && statSync(bin).mtimeMs < newestSource())
    console.error('warning: dist/ is older than src/ — npm run build, or this tests the old treeyard');
  for (const s of specs)
    if (!existsSync(join(HOME, s.driver === 'claude' ? '.claude' : '.codex')))
      throw new Error(`${s.label}: ${s.driver} is not set up (no ~/.${s.driver === 'claude' ? 'claude' : 'codex'})`);

  const out = opts.out ?? mkdtempSync(join(tmpdir(), 'skill-evals-'));
  mkdirSync(out, { recursive: true });
  // The stand's treeyard is the one under test, ahead of any other on PATH.
  const shim = join(out, 'bin', 'treeyard');
  mkdirSync(join(out, 'bin'), { recursive: true });
  writeFileSync(shim, `#!/bin/sh\nexec node "${bin}" "$@"\n`);
  chmodSync(shim, 0o755);
  const env = { PATH: `${join(out, 'bin')}:${process.env.PATH}` };
  writeFileSync(
    join(out, 'run.json'),
    `${JSON.stringify(
      {
        started: new Date().toISOString(),
        scenarios: scenariosFile,
        order: chains.flat().map((s) => s.id),
        models: specs,
      },
      null,
      1,
    )}\n`,
  );
  console.error(`run folder: ${out}`);

  const jobs = [];
  for (const spec of specs)
    for (const chain of chains) {
      const dir = join(out, spec.label.replace(/[^\w.-]/g, '_'), chain[0].id);
      mkdirSync(dir, { recursive: true });
      jobs.push(async () => {
        try {
          await runChain({ spec, chain, dir, env, shim, opts });
        } catch (e) {
          console.error(`[${spec.label}] ${chain[0].id}: failed: ${oneLine(e.message ?? e, 300)}`);
        }
      });
    }
  await pool(jobs, opts.jobs);
  report([out], { examples: 3, json: false });
  console.error(`\nraw streams and stands' snapshots: ${out}`);
}

// ── report ─────────────────────────────────────────────────────────────────

function loadRuns(dirs) {
  const runs = [];
  const order = [];
  const scenarioOrder = [];
  for (const dir of dirs) {
    const info = existsSync(join(dir, 'run.json')) ? safeJson(readFileSync(join(dir, 'run.json'), 'utf8')) : null;
    for (const m of info?.models ?? []) if (!order.includes(m.label)) order.push(m.label);
    for (const id of info?.order ?? []) if (!scenarioOrder.includes(id)) scenarioOrder.push(id);
    for (const label of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'bin')) {
      for (const chain of readdirSync(join(dir, label.name), { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const base = join(dir, label.name, chain.name);
        for (const f of readdirSync(base).filter((x) => x.endsWith('.json'))) {
          const meta = safeJson(readFileSync(join(base, f), 'utf8'));
          const raw = join(base, f.replace(/\.json$/, '.jsonl'));
          if (!meta || !existsSync(raw)) continue;
          const text = readFileSync(raw, 'utf8');
          const { events } = meta.driver === 'codex' ? parseCodex(text) : parseClaude(text);
          const findings = audit(meta, events);
          const blocked = blockedGit(events);
          runs.push({ label: meta.label, scenario: meta.scenario.id, chain: chain.name, meta, findings, blocked });
        }
      }
    }
    for (const r of runs) if (!order.includes(r.label)) order.push(r.label);
  }
  return { runs, order, scenarioOrder };
}

function report(dirs, opts) {
  const { runs, order, scenarioOrder } = loadRuns(dirs);
  if (!runs.length) {
    console.error(`no results in ${dirs.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const rows = order.map((label) => {
    const mine = runs.filter((r) => r.label === label);
    const count = (code) => mine.reduce((n, r) => n + r.findings.filter((f) => f.code === code).length, 0);
    const expects = mine.flatMap((r) => r.meta.expect.filter((e) => !e.skipped));
    return {
      label,
      model: mine[0]?.meta.model,
      queries: mine.length,
      counts: Object.fromEntries(CODES.map((c) => [c, count(c)])),
      expectations: { ok: expects.filter((e) => e.ok).length, total: expects.length },
      cost: mine.reduce((n, r) => n + (r.meta.cost ?? 0), 0),
      seconds: mine.reduce((n, r) => n + (r.meta.seconds ?? 0), 0),
      broken: mine.filter((r) => r.meta.timedOut || r.meta.exit || r.meta.error).length,
      blocked: mine.reduce((n, r) => n + r.blocked, 0),
    };
  });
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          models: rows,
          runs: runs.map(({ label, scenario, findings, meta }) => ({ label, scenario, findings, expect: meta.expect })),
        },
        null,
        1,
      ),
    );
    return;
  }
  const out = [];
  const say = (s = '') => out.push(s);
  const w = Math.max(5, ...rows.map((r) => r.label.length));
  const head = [
    'model'.padEnd(w),
    'queries',
    ...CODES.map((c) => c.padStart(Math.max(c.length, 4))),
    'expected',
    '     cost',
    '  time',
  ];
  say(head.join('  '));
  for (const r of rows) {
    say(
      [
        r.label.padEnd(w),
        String(r.queries).padStart(7),
        ...CODES.map((c) => (r.counts[c] ? String(r.counts[c]) : '·').padStart(Math.max(c.length, 4))),
        `${r.expectations.ok}/${r.expectations.total}`.padStart(8),
        (r.cost ? `$${r.cost.toFixed(2)}` : '—').padStart(9),
        `${Math.round(r.seconds / 60)}m`.padStart(6),
      ].join('  '),
    );
  }
  say();
  say(
    'pipe: a treeyard call piped on · loop: a loop around treeyard · hand-edit: .tree/ written or committed by hand · done: closing a node unasked',
  );
  say(
    'id: a node id in a reply · other: the other project changed unasked or with no node of its own · skill: not loaded before the first call · title: a long node title',
  );
  for (const r of rows) {
    if (r.broken)
      say(
        `${r.label}: ${r.broken} of ${r.queries} queries did not finish cleanly (timeout, exit code, error) — see the by-scenario list`,
      );
    if (r.blocked) say(`${r.label}: ${r.blocked} git add/commit calls blocked by the sandbox — not held against it`);
  }
  say();
  say('by scenario');
  for (const id of [...new Set([...scenarioOrder, ...runs.map((r) => r.scenario)])].filter((x) =>
    runs.some((r) => r.scenario === x),
  )) {
    say(`  ${id}`);
    for (const label of order) {
      for (const r of runs.filter((x) => x.label === label && x.scenario === id)) {
        const codes = CODES.filter((c) => r.findings.some((f) => f.code === c)).map((c) => {
          const n = r.findings.filter((f) => f.code === c).length;
          return n > 1 ? `${c}×${n}` : c;
        });
        const missed = r.meta.expect.filter((e) => !e.ok);
        const bad = r.meta.timedOut ? ['TIMED OUT'] : r.meta.exit ? [`exit ${r.meta.exit}`] : [];
        const marks = [...codes, ...bad, ...(missed.length ? [`${missed.length} missed`] : [])];
        say(`    ${r.label.padEnd(w)}  ${marks.length ? marks.join(' · ') : 'ok'}`);
        const details = [
          ...r.findings.map((f) => `${f.code}: ${f.detail}`),
          ...missed.map((e) => `✗ ${e.name}${e.detail ? ` (${e.detail})` : ''}`),
          ...(r.meta.error ? [`error: ${r.meta.error}`] : []),
        ];
        for (const d of details.slice(0, opts.examples)) say(`        ${oneLine(d, 170)}`);
        if (details.length > opts.examples) say(`        … ${details.length - opts.examples} more (--examples N)`);
      }
    }
  }
  console.log(out.join('\n'));
}

// ── main ───────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      scenario: { type: 'string' },
      scenarios: { type: 'string' },
      jobs: { type: 'string', default: '2' },
      timeout: { type: 'string', default: '15' },
      treeyard: { type: 'string' },
      out: { type: 'string' },
      keep: { type: 'boolean', default: false },
      examples: { type: 'string', default: '3' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...rest] = positionals;
  try {
    if (values.help || !command) console.log(HELP);
    else if (command === 'run')
      await run(rest, {
        ...values,
        scenario: values.scenario ? values.scenario.split(',') : [],
        jobs: Math.max(1, Number(values.jobs) || 2),
        timeout: Math.max(1, Number(values.timeout) || 15) * 60_000,
      });
    else if (command === 'report')
      report(rest, { examples: Math.max(0, Number(values.examples) || 0), json: values.json });
    else throw new Error(`unknown command «${command}»\n${HELP}`);
  } catch (e) {
    console.error(`skill-evals: ${e.message ?? e}`);
    process.exitCode = 2;
  }
}
