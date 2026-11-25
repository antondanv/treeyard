---
id: qwmr
title: Пробное слияние веток узлов
parent: 5byq
order: 150
status: done
done_when: проверка конфликтов делает пробное слияние (git merge-tree --write-tree, без checkout) и сигналит только при реальном столкновении изменений (с учётом незакоммиченных правок), без шума на правках в разных местах одного файла; тесты и документация
commits:
  - fc90853871e2b58e3c6463a8a4ef9eab7071e034
sessions:
  - brain: antigravity
    id: 4a06773a-4c3f-4fb5-8314-d10fffd05e9e
    name: Treeyard · Пробное слияние веток узлов
    started: 2026-11-24T14:57:56+03:00
    opened: 2026-11-24T14:57:56+03:00
    mode: pane
    pane: agy-7eb7496a
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/qwmr
created: 2026-11-24
updated: 2026-11-25T12:30:12+03:00
closed: 2026-11-25
---

Сейчас «правят один файл» — по спискам файлов. Пробное слияние (git merge-tree --write-tree, без checkout) отличило бы настоящий конфликт текста от правок в разных местах файла и убрало шум от общих файлов вроде словаря переводов и справочника.

## Журнал

- 2026-11-24 12:14 · агент · завёл узел
- 2026-11-24 14:34 · ты · идея → к работе
- 2026-11-24 14:57 · antigravity · новая сессия в панели (do) в worktree treeyard/qwmr
- 2026-11-24 14:57 · antigravity · к работе → в работе
- 2026-11-24 15:06 · antigravity · привязан коммит fc90853871e2b58e3c6463a8a4ef9eab7071e034
- 2026-11-24 15:06 · antigravity · Пробное слияние веток узлов без checkout: worktreeTree и trialMergeConflicts в src/worktree.ts (снимок незакоммиченных/новых/удалённых файлов через временный GIT_INDEX_FILE, git merge-tree --write-tree --name-only --no-messages -z --merge-base=<base>), интеграция в findOverlaps (src/agents/overlap.ts) с исключением .tree/ и запасным сравнением хэшей при недоступном merge-tree или кастомном ReadFiles; 5 новых тестов в test/overlap.test.ts; обновлена docs/architecture.md. Проверки: npm run typecheck — ok; test/overlap.test.ts — 20/20; полный прогон VITEST_MAX_WORKERS=3 npm test — 96/99 с TREEYARD_AS=antigravity + оставшиеся 3/3 (18/18) с env -u TREEYARD_AS (итого 99/99, 954/954); npm run lint (biome check, 230 файлов) — ok; npm run build — ok. Осталось: ничего.
- 2026-11-24 15:06 · antigravity · в работе → на проверке
- 2026-11-24 15:09 · ты · Принято (координатор): fc90853 на main; npm run typecheck, npm test 963/963, lint, build — чисто; критерий выполнен (пробное слияние git merge-tree --write-tree с временным индексом для незакоммиченных правок без checkout, без шума на разных участках файла, тесты и docs/architecture.md). Панель усыплена. Осталось: ничего.
- 2026-11-25 12:30 · ты · на проверке → готово
