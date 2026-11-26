// Shell parsing shared by the scripts that read what agents ran: usage-audit.mjs (transcripts of
// real work) and skill-evals.mjs (transcripts of skill runs).
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const HOME = homedir();
export const TEMP = /^(\/private)?\/(tmp|var\/folders)\//;

// ── shell ──────────────────────────────────────────────────────────────────

/**
 * Splits a command line into simple commands, in the order they run:
 * { words, redirects, heredocs, text, pipeline, at, loop }.
 * Enough of sh for agents' one-liners: quotes, escapes, $(…), `…`, heredocs, ;, &&, ||, |, &, (),
 * for/while/until loops. Quoted text stays one word, so a journal entry that mentions
 * «treeyard show» is not a call.
 */
export function parseShell(src, inheritedLoop = null) {
  const commands = [];
  const loops = inheritedLoop ? [inheritedLoop] : [];
  const scopes = []; // the subshells a command runs in: ( … ) and $( … )
  let i = 0;

  const finish = (cmd) => {
    const w = cmd.words;
    while (w.length) {
      const k = w[0];
      if (/^(for|select|while|until)$/.test(k)) {
        loops.push({ kind: k, text: src.slice(cmd.start, cmd.start + 200) });
        // `for x in …` runs nothing itself; `while cond` runs cond.
        if (k === 'for' || k === 'select') w.length = 0;
        else w.shift();
      } else if (k === 'done') {
        if (loops.length > (inheritedLoop ? 1 : 0)) loops.pop();
        w.shift();
      } else if (/^(do|then|else|elif|if|fi|\{|\}|!|time|esac)$/.test(k)) w.shift();
      else break;
    }
    cmd.loop = loops.at(-1) ?? null;
    cmd.scope = [...scopes];
    return w.length > 0 || cmd.redirects.length > 0;
  };

  function list(inSubst) {
    let pipeline = [];
    let cmd = { words: [], redirects: [], heredocs: [] };
    let word = null;
    let redirect = null;
    let pendingDocs = [];
    let parens = 0;
    let at = 0;
    if (inSubst) scopes.push(++subshells);

    const add = (s) => {
      cmd.start ??= at;
      word = (word ?? '') + s;
    };
    const endWord = () => {
      if (word === null) return;
      if (redirect) cmd.redirects.push({ op: redirect, target: word });
      else cmd.words.push(word);
      redirect = null;
      word = null;
    };
    const endCommand = () => {
      endWord();
      cmd.text = src.slice(cmd.start ?? i, i).trim();
      if (finish(cmd)) pipeline.push(cmd);
      cmd = { words: [], redirects: [], heredocs: [] };
    };
    const endPipeline = () => {
      endCommand();
      pipeline.forEach((c, k) => {
        Object.assign(c, { pipeline, at: k });
        commands.push(c);
      });
      pipeline = [];
    };
    const readDocs = () => {
      for (const doc of pendingDocs) {
        const lines = [];
        while (i < src.length) {
          const end = src.indexOf('\n', i);
          const stop = end < 0 ? src.length : end;
          const line = src.slice(i, stop);
          i = stop + 1;
          if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delim) break;
          lines.push(line);
        }
        doc.body = lines.join('\n');
      }
      pendingDocs = [];
    };
    const subst = () => {
      i += 2;
      list(true);
      return '$(…)';
    };
    const backtick = () => {
      const end = src.indexOf('`', i + 1);
      const stop = end < 0 ? src.length : end;
      commands.push(...parseShell(src.slice(i + 1, stop), loops.at(-1) ?? null));
      i = stop + 1;
      return '`…`';
    };
    const dquote = () => {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        const ch = src[i];
        if (ch === '\\') {
          const n = src[i + 1] ?? '';
          s += n && '"\\$`'.includes(n) ? n : n === '\n' ? '' : ch + n;
          i += 2;
        } else if (ch === '$' && src[i + 1] === '(' && src[i + 2] !== '(') s += subst();
        else if (ch === '`') s += backtick();
        else {
          s += ch;
          i++;
        }
      }
      i++;
      return s;
    };

    while (i < src.length) {
      at = i;
      const ch = src[i];
      const next = src[i + 1];
      if (ch === '\\') {
        if (next !== '\n') add(next ?? '');
        i += 2;
      } else if (ch === "'") {
        const end = src.indexOf("'", i + 1);
        const stop = end < 0 ? src.length : end;
        add(src.slice(i + 1, stop));
        i = stop + 1;
      } else if (ch === '"') add(dquote());
      else if (ch === '`') add(backtick());
      else if (ch === '$' && next === '(' && src[i + 2] === '(') {
        const end = src.indexOf('))', i + 3);
        i = end < 0 ? src.length : end + 2;
        add('$((…))');
      } else if (ch === '$' && next === '(') add(subst());
      else if (ch === '#' && word === null) {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (ch === ' ' || ch === '\t' || ch === '\r') {
        endWord();
        i++;
      } else if (ch === '\n') {
        endPipeline();
        i++;
        readDocs();
      } else if (ch === ';') {
        endPipeline();
        i += next === ';' ? 2 : 1;
      } else if (ch === '&' && next === '>') {
        endWord();
        redirect = src[i + 2] === '>' ? '&>>' : '&>';
        i += redirect.length;
      } else if (ch === '&') {
        endPipeline();
        i += next === '&' ? 2 : 1;
      } else if (ch === '|' && next === '|') {
        endPipeline();
        i += 2;
      } else if (ch === '|') {
        endCommand();
        i += next === '&' ? 2 : 1;
      } else if (ch === '(' && word === null) {
        endPipeline();
        parens++;
        scopes.push(++subshells);
        i++;
      } else if (ch === ')' && inSubst && parens === 0) {
        endPipeline();
        scopes.pop();
        i++;
        return;
      } else if (ch === ')') {
        endPipeline();
        if (parens > 0) scopes.pop();
        parens = Math.max(0, parens - 1);
        i++;
      } else if (ch === '<' && next === '<' && src[i + 2] !== '<') {
        endWord();
        i += 2;
        const doc = { delim: '', strip: src[i] === '-', body: '' };
        if (doc.strip) i++;
        while (src[i] === ' ' || src[i] === '\t') i++;
        while (i < src.length && !/[\s;&|<>()]/.test(src[i])) {
          if (src[i] === "'" || src[i] === '"') {
            const end = src.indexOf(src[i], i + 1);
            const stop = end < 0 ? src.length : end;
            doc.delim += src.slice(i + 1, stop);
            i = stop + 1;
          } else {
            if (src[i] !== '\\') doc.delim += src[i];
            i++;
          }
        }
        cmd.heredocs.push(doc);
        pendingDocs.push(doc);
      } else if (ch === '>' || ch === '<') {
        if (word !== null && /^\d+$/.test(word)) word = null; // a descriptor: 2>&1
        endWord();
        cmd.start ??= at;
        let op = '';
        while (src[i] && '<>&|'.includes(src[i])) op += src[i++];
        redirect = op;
      } else {
        add(ch);
        i++;
      }
    }
    endPipeline();
    if (inSubst) scopes.pop();
  }

  list(false);
  return commands;
}

let subshells = 0;

const WRAPPERS = new Set(['command', 'exec', 'env', 'sudo', 'nice', 'nohup', 'time', 'npx', 'bunx', 'pnpx']);

/** The program a simple command runs, past VAR=value and wrappers like env, npx, timeout. */
export function programOf(words) {
  let k = 0;
  while (k < words.length) {
    const w = words[k];
    if (/^[A-Za-z_]\w*=/.test(w)) k++;
    // `command -v treeyard` looks the program up and runs nothing.
    else if (w === 'command' && /^-[vV]$/.test(words[k + 1] ?? '')) break;
    else if (WRAPPERS.has(w) || w === 'timeout') {
      k++;
      while (words[k]?.startsWith('-')) k++;
      if (w === 'timeout') k++;
    } else break;
  }
  return { name: (words[k] ?? '').split('/').pop(), args: words.slice(k + 1) };
}

export const isTreeyard = (w) => (w ?? '').split('/').pop() === 'treeyard';
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash']);
// xargs and parallel options that take a value in the next word.
const XARGS_VALUE = /^-[nIPLsEda]$/;

/** The treeyard arguments run by xargs, parallel or find -exec, and the kind of loop; null if none. */
export function loopedTreeyard(name, args) {
  if (name === 'find') {
    const at = args.findIndex((a) => /^-(exec|execdir|ok)$/.test(a));
    return at >= 0 && isTreeyard(args[at + 1]) ? { args: args.slice(at + 2), kind: 'find -exec' } : null;
  }
  if (name !== 'xargs' && name !== 'parallel') return null;
  let k = 0;
  while (args[k]?.startsWith('-')) k += XARGS_VALUE.test(args[k]) ? 2 : 1;
  return isTreeyard(args[k]) ? { args: args.slice(k + 1), kind: name } : null;
}

/**
 * Simple commands of a call, with `bash -c "…"` opened up, variables set earlier in the call
 * expanded and the folder each command runs in (after `cd`).
 */
export function commandsOf(cmd, ctx, loop = null) {
  const out = [];
  const entered = []; // subshells we are in, with the folder to go back to
  const expand = (w) =>
    w
      .replace(/^~(?=\/|$)/, HOME)
      .replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a, b) => (ctx.vars.has(a ?? b) ? ctx.vars.get(a ?? b) : m));
  for (const c of parseShell(cmd, loop)) {
    // A `cd` inside ( … ) stays there.
    while (entered.length && !c.scope.includes(entered.at(-1).id)) ctx.cwd = entered.pop().cwd;
    for (const id of c.scope) if (!entered.some((e) => e.id === id)) entered.push({ id, cwd: ctx.cwd });
    c.words = c.words.map(expand);
    for (const r of c.redirects) r.target = expand(r.target);
    const { name, args } = programOf(c.words);
    if (SHELLS.has(name) && /^-\w*c$/.test(args[0] ?? '') && args[1]) {
      const cwd = ctx.cwd;
      out.push(...commandsOf(args[1], ctx, c.loop));
      ctx.cwd = cwd;
      continue;
    }
    const assigns = name === '' ? c.words : /^(export|declare|local|readonly)$/.test(name) ? args : [];
    for (const a of assigns) {
      const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(a);
      if (m) ctx.vars.set(m[1], m[2]);
    }
    if (name === 'cd') {
      const to = args.find((a) => !a.startsWith('-')) ?? HOME;
      // `cd $S` with $S unknown: relative paths after it lead nowhere we can tell.
      ctx.cwd = to.includes('$') || ctx.cwd === null ? null : resolve(ctx.cwd || HOME, to);
    }
    out.push(Object.assign(c, { name, args, cwd: ctx.cwd }));
  }
  return out;
}

// ── .tree/ ─────────────────────────────────────────────────────────────────

/**
 * `.tree/…` of a path inside some project's tree, node files as `<id>`; null for other paths,
 * test fixtures and, without `temp`, temporary copies.
 */
export function treePath(p, cwd, { temp = false } = {}) {
  // `$T/.tree`: a folder this call made up, most likely a copy; `^./.tree`: a pattern.
  if (typeof p !== 'string' || /^[$^-]/.test(p) || !/(^|\/)\.tree(\/|$)/.test(p)) return null;
  if (cwd === null && !p.startsWith('/')) return null;
  const abs = resolve(cwd || '/', p);
  if (/(^|\/)(test|tests|fixtures|templates)\//.test(abs.slice(0, abs.lastIndexOf('/.tree')))) return null;
  if (!temp && TEMP.test(abs)) return null;
  const rel = /(?:^|\/)(\.tree(?:\/.*)?)$/.exec(abs)?.[1] ?? '.tree';
  return rel.replace(/^\.tree\/nodes\/[^/]+\.md$/, '.tree/nodes/<id>.md');
}

/**
 * What one simple command (from commandsOf) does to .tree/ without treeyard:
 * [{ group: 'edits' | 'gitByHand' | 'reads', key }]. Writes, git on the tree, and reads that
 * `treeyard show --brief` or `find` should have done.
 */
export function treeAccess(c, opts = {}) {
  const { name, args, cwd } = c;
  const found = [];
  const tree = (p) => treePath(p, cwd, opts);
  const say = (group, key) => found.push({ group, key });
  for (const r of c.redirects) {
    const rel = r.op.includes('>') && tree(r.target);
    if (rel) say('edits', `shell ${r.op} ${rel}`);
  }
  if (!name) return found;
  if (name === 'git') {
    let k = 0;
    while (/^-[Cc]$/.test(args[k] ?? '')) k += 2;
    const sub = args[k] ?? '';
    const rel = args
      .slice(k + 1)
      .map(tree)
      .find(Boolean);
    if (/^(add|checkout|restore|rm|mv|stash|reset|commit)$/.test(sub) && rel) say('gitByHand', `git ${sub} ${rel}`);
    return found;
  }
  const anyTree = args.map(tree).find(Boolean);
  const inPlace =
    (/^g?sed$/.test(name) && args.some((a) => /^(-i|--in-place)/.test(a))) ||
    (name === 'perl' && args.some((a) => /^-\w*i/.test(a)));
  const target = /^(mv|cp|install|ln|rsync)$/.test(name) && tree(args.at(-1));
  if (inPlace && anyTree) say('edits', `${name} -i ${anyTree}`);
  else if (/^(tee|rm|touch|truncate|mkdir)$/.test(name) && anyTree) say('edits', `${name} ${anyTree}`);
  else if (target) say('edits', `${name} → ${target}`);
  else if (/^(python3?|node|ruby|perl|bun|deno)$/.test(name)) {
    // Inline code that writes and names a .tree/ path as a file it opens or holds in a variable.
    const code = [...args, ...c.heredocs.map((d) => d.body)].join('\n');
    const writes = /writeFile|appendFile|write_text|write_bytes|\.write\(|open\([^)]*['"][wa]|renameSync|unlink/;
    const lit = String.raw`f?['"]([^'"\s]*\.tree\/[^'"\s]*)['"]`;
    const paths = [
      ...code.matchAll(new RegExp(String.raw`(?:open|Path|[Ff]ile(?:Sync)?|write_text)\s*\(\s*${lit}`, 'g')),
      ...code.matchAll(new RegExp(String.raw`^\s*(?:const |let |var )?\w+\s*=\s*${lit}\s*;?\s*$`, 'gm')),
    ].map((m) => m[1]);
    if (writes.test(code) && paths.some((x) => tree(x))) say('edits', `${name} script writes .tree/`);
  } else if (/^(cat|head|tail|less|more|grep|egrep|rg|ag|awk|g?sed|wc|bat|find|ls|tree|jq|yq)$/.test(name) && anyTree)
    say('reads', `${name} ${anyTree.replace(/^(\.tree\/[^/]+\/).+/, '$1…')}`);
  return found;
}
