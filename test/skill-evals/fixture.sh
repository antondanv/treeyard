#!/bin/bash
# The fixture of test/skill-evals/treeyard.json: two throwaway projects with treeyard trees,
# tipcalc (an app, the agent's working folder) and money (the library it rounds with, a bug
# in round2), plus a TREEYARD_HOME of their own. The skill is copied where Claude Code
# (.claude/skills) and Codex (.agents/skills) find project skills.
#
# usage: test/skill-evals/fixture.sh <empty folder outside any repository>
# scripts/skill-evals.mjs builds it, runs every scenario on the models you name and prints the
# rules they break. By hand, run an agent in <folder>/tipcalc with a clean environment:
#   env -i HOME="$HOME" USER="$USER" PATH="$PATH" TREEYARD_HOME=<folder>/home \
#     claude -p "<query>" --model haiku --add-dir <folder>/money --output-format stream-json --verbose
set -euo pipefail
N=$(mkdir -p "$1" && cd "$1" && pwd)
SKILL=$(cd "$(dirname "$0")/../../skills/treeyard" && pwd)
rm -rf "$N/tipcalc" "$N/money" "$N/home"
mkdir -p "$N/tipcalc/bin" "$N/tipcalc/src" "$N/tipcalc/test" "$N/money/src" "$N/money/test" "$N/home"
export TREEYARD_HOME="$N/home"
unset TREEYARD_NODE TREEYARD_PROJECT TREEYARD_AS
printf '{"lang":"ru","notes":"%s","confirm":true}\n' "$N/tipcalc" >"$N/home/settings.json"

# ── money: the library with a rounding bug ──
cd "$N/money"
cat >package.json <<'EOF'
{ "name": "money", "version": "1.2.0", "type": "module", "scripts": { "test": "node --test" } }
EOF
cat >src/round.js <<'EOF'
/** Rounds a sum to cents. */
export function round2(x) {
  return Math.floor(x * 100) / 100;
}
EOF
cat >test/round.test.js <<'EOF'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { round2 } from '../src/round.js';

test('round2 keeps two digits', () => {
  assert.equal(round2(1.234), 1.23);
  assert.equal(round2(2), 2);
});
EOF
cat >AGENTS.md <<'EOF'
# money

Маленькая библиотека денег для моих утилит: округление до копеек.

- Тесты: `npm test` (node --test), без зависимостей.
- Любая правка `round2` — с тестом на граничные значения (x.xx5).
- Коммиты по смыслу, Conventional Commits; push — только по просьбе.
EOF
treeyard import --from-json - >/dev/null <<'EOF'
{
  "title": "money",
  "template": "directions",
  "goal": "Деньги в моих утилитах считаются без ошибок округления",
  "nodes": [
    { "title": "round2 и тесты", "status": "done", "done_when": "round2 округляет до копеек, npm test зелёный" },
    { "title": "Деление суммы на части без потери копеек", "status": "idea" }
  ]
}
EOF
treeyard pointer >/dev/null

# ── tipcalc: the app ──
cd "$N/tipcalc"
cat >package.json <<'EOF'
{
  "name": "tipcalc",
  "version": "0.3.0",
  "type": "module",
  "bin": { "tip": "bin/tip.js" },
  "scripts": { "test": "node --test" }
}
EOF
cat >src/tip.js <<'EOF'
import { round2 } from '../../money/src/round.js';

/** Tip, total and each person's share for a bill. */
export function calc(amount, percent = 15, split = 1) {
  const tip = round2((amount * percent) / 100);
  const total = round2(amount + tip);
  return { tip, total, each: round2(total / split) };
}
EOF
cat >bin/tip.js <<'EOF'
#!/usr/bin/env node
import { calc } from '../src/tip.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const amount = Number(args[0]);
if (!Number.isFinite(amount)) {
  console.error('usage: tip <amount> [--percent 15] [--split 1]');
  process.exit(2);
}
const split = opt('--split', 1);
const { tip, total, each } = calc(amount, opt('--percent', 15), split);
console.log(`tip ${tip.toFixed(2)} · total ${total.toFixed(2)}${split > 1 ? ` · each ${each.toFixed(2)}` : ''}`);
EOF
chmod +x bin/tip.js
cat >test/tip.test.js <<'EOF'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calc } from '../src/tip.js';

test('15% by default', () => {
  assert.deepEqual(calc(100), { tip: 15, total: 115, each: 115 });
});

test('split between friends', () => {
  assert.equal(calc(90, 10, 3).each, 33);
});
EOF
cat >README.md <<'EOF'
# tipcalc

`tip 100` — чаевые и итог. `tip 90 --percent 10 --split 3` — поделить на троих.
EOF
cat >AGENTS.md <<'EOF'
# tipcalc

Утилита для кафе: чаевые, итог и доля каждого. Округление — из соседней библиотеки
`../money` (у неё свои правила и своё дерево).

- Запуск: `node bin/tip.js 100 --percent 10 --split 3`
- Тесты: `npm test` (node --test), без зависимостей.
- Коммиты по смыслу, Conventional Commits; push — только по просьбе.
EOF
treeyard import --from-json - >/dev/null <<'EOF'
{
  "title": "tipcalc",
  "template": "directions",
  "goal": "Друзья в кафе делят счёт за 10 секунд, без калькулятора и споров",
  "nodes": [
    {
      "title": "Веха 1: делим счёт в кафе с друзьями",
      "done_when": "три раза поделили настоящий счёт через tip, без споров",
      "children": [
        { "title": "Делёж на N человек", "status": "done", "done_when": "tip 90 --split 3 печатает долю каждого" },
        { "title": "Флаг --version", "done_when": "node bin/tip.js --version печатает версию из package.json; тест в test/" },
        { "title": "Чаевые по умолчанию из настройки", "done_when": "TIP_PERCENT=10 tip 100 считает 10%; без переменной — 15%; тест" },
        { "title": "Показать друзьям в кафе", "who": "human", "done_when": "три счёта поделены через tip" }
      ]
    },
    {
      "title": "Округление",
      "children": [
        { "title": "Копейки округляются правильно", "done_when": "tip 10.05 --percent 10 печатает tip 1.01 (сейчас 1.00); тест" },
        { "title": "Сейчас вывод всегда без валюты и непонятно, рубли это или доллары: хорошо бы показывать символ валюты, а сам символ брать из локали системы или из флага --currency", "status": "idea" }
      ]
    },
    {
      "title": "Опубликовать в npm", "status": "waiting",
      "waiting": "нет доступа к npm-аккаунту", "until": "человек заведёт аккаунт и даст токен"
    },
    { "title": "Идеи", "status": "idea", "children": [ { "title": "История расчётов", "status": "idea" } ] }
  ]
}
EOF
treeyard pointer >/dev/null

# Skills where each CLI finds them in a project; git with a test author.
for p in tipcalc money; do
  cd "$N/$p"
  mkdir -p .claude/skills .agents/skills
  cp -R "$SKILL" .claude/skills/treeyard
  cp -R "$SKILL" .agents/skills/treeyard
  git init -q -b main
  git config user.name "QA Tester"
  git config user.email qa@example.invalid
  git add -A
  git commit -qm "chore: initial project with its tree"
done
echo "$N"
