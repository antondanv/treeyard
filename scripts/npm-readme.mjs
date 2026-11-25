// What the npm package page shows is the README packed into the tarball, and
// on npmjs.com relative links and images lead nowhere. So while the package is
// packed (prepack → hide), the repo README.md is swapped for a copy whose
// relative links point at GitHub at the tag of this version, and README.ru.md
// steps aside (npm packs every README.* at the root and may show the Russian
// one). postpack (show) puts both back.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const RU = 'README.ru.md';
const RU_ASIDE = '.README.ru.md.packing';
const EN = 'README.md';
const EN_ASIDE = '.README.md.packing';

// Absolute URL prefixes for a repo and a git ref, from package.json.
export function repoBases(pkg, ref = `v${pkg.version}`) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const m = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url ?? '');
  if (!m) throw new Error('package.json: repository.url must point at github.com');
  return {
    blob: `https://github.com/${m[1]}/blob/${ref}/`,
    tree: `https://github.com/${m[1]}/tree/${ref}/`,
    raw: `https://raw.githubusercontent.com/${m[1]}/${ref}/`,
  };
}

const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;

function isRelative(target) {
  return target !== '' && !target.startsWith('#') && !/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(target);
}

function absolute(target, isImage, bases) {
  if (!isRelative(target)) return target;
  const path = target.replace(/^\.\//, '');
  const pathOnly = path.split(/[?#]/)[0];
  if (isImage || IMAGE_EXT.test(pathOnly)) return bases.raw + path;
  return (pathOnly.endsWith('/') ? bases.tree : bases.blob) + path;
}

// Rewrites relative markdown links and images and HTML src/href attributes;
// fenced code is left alone, and so are #anchors (npm and GitHub both make them).
export function toAbsoluteLinks(text, bases) {
  const lines = text.split('\n');
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    lines[i] = lines[i]
      // images first, then any other link — a badge is a link wrapping an image
      .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (_, head, target) => head + absolute(target, true, bases))
      .replace(/(\]\()([^)\s]+)/g, (_, head, target) => head + absolute(target, false, bases))
      .replace(/<(img|source)\b[^>]*>/gi, (tag) =>
        tag.replace(/\bsrc="([^"]*)"/i, (_, v) => `src="${absolute(v, true, bases)}"`),
      )
      .replace(/<a\b[^>]*>/gi, (tag) =>
        tag.replace(/\bhref="([^"]*)"/i, (_, v) => `href="${absolute(v, false, bases)}"`),
      );
  }
  return lines.join('\n');
}

function hide() {
  // Compute first, so a failure leaves the files where they were.
  let rewritten = null;
  if (existsSync(EN) && !existsSync(EN_ASIDE)) {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    rewritten = toAbsoluteLinks(readFileSync(EN, 'utf8'), repoBases(pkg));
  }
  if (existsSync(RU)) renameSync(RU, RU_ASIDE);
  if (rewritten !== null) {
    renameSync(EN, EN_ASIDE);
    writeFileSync(EN, rewritten);
  }
}

function show() {
  if (existsSync(RU_ASIDE)) renameSync(RU_ASIDE, RU);
  if (existsSync(EN_ASIDE)) renameSync(EN_ASIDE, EN);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const step = process.argv[2];
  if (step === 'hide') hide();
  else if (step === 'show') show();
  else {
    console.error('usage: npm-readme.mjs hide|show');
    process.exit(2);
  }
}
