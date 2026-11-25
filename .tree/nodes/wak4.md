---
id: wak4
title: Уборка worktree закрытых узлов
parent: 9xem
order: 220
status: done
done_when: treeyard worktree rm принимает несколько id (строка на узел; отказ у одного не мешает остальным; код 1, если хоть один отказал) и --done — убирает worktree всех закрытых узлов (готово или отказ), где всё закоммичено и влито, и пишет, что убрано, что оставлено и почему; --dry-run только показывает; treeyard set <id> status=done у узла с влитым и чистым worktree подсказывает treeyard worktree rm <id>; справка и docs/reference на обоих языках; тесты на настоящем git worktree; npm run typecheck, npm test, lint, build
commits:
  - 54f75d4c9f31f4f4e59a8fc19c6471abb167f255
sessions:
  - brain: antigravity
    id: pane:agy-ac70dad3
    name: Treeyard · Уборка worktree закрытых узлов
    started: 2026-11-25T20:16:30+03:00
    opened: 2026-11-25T20:16:30+03:00
    mode: pane
    pane: agy-ac70dad3
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/wak4
created: 2026-11-25
updated: 2026-11-25T20:53:20+03:00
closed: 2026-11-25
---

25.11: после закрытия 19 узлов их влитые и чистые worktree пришлось убирать по одному — treeyard worktree rm берёт только один id. Нужно: rm нескольких id сразу и/или rm --done (все worktree закрытых узлов, где всё закоммичено и влито); возможно, предлагать уборку при status=done.

## Журнал

- 2026-11-25 20:10 · агент · завёл узел
- 2026-11-25 20:15 · агент · идея → к работе
- 2026-11-25 20:16 · antigravity · новая сессия в панели (do) в worktree treeyard/wak4
- 2026-11-25 20:16 · antigravity · к работе → в работе
- 2026-11-25 20:17 · ты · разрешение подтверждено: доверие к папке — «1. Yes, I trust this folder»
- 2026-11-25 20:17 · агент · нужен для: Treeyard › «Свои значения лимитов» (v3ne)
- 2026-11-25 20:20 · агент · больше не нужен для: Treeyard › «Свои значения лимитов» (v3ne)
- 2026-11-25 20:36 · antigravity · привязан коммит 54f75d4c9f31f4f4e59a8fc19c6471abb167f255
- 2026-11-25 20:36 · antigravity · Добавил массовую уборку worktree: treeyard worktree rm теперь принимает несколько id (строка на узел, отказ у одного не мешает остальным, код 1 при любом отказе), --done (убирает чистые и влитые worktree всех закрытых узлов done/dropped, отчитывается что убрано, что оставлено и почему) и --dry-run (только показ). В treeyard set <id> status=done добавлена подсказка treeyard worktree rm <id> для узлов с влитым и чистым worktree. Обновлены справка, i18n и docs/reference на обоих языках; добавлены тесты на настоящем git worktree (test/worktree-rm.test.ts). Проверки: typecheck, lint (243 файла), build — чисто; test/worktree*.test.ts, i18n, cli-help, set-many — 52/52; полный npm test — 96/106 файлов сразу + все 10 упавших по таймауту под параллельной нагрузкой прошли при перезапуске (uninstall.test.ts с --testTimeout=60000 — 46.9s). Осталось: ничего.
- 2026-11-25 20:36 · antigravity · в работе → на проверке
- 2026-11-25 20:40 · агент · Принято (координатор): 54f75d4 влит в main; worktree rm принимает несколько id, --done и --dry-run, set status=done подсказывает уборку; на main: test/worktree-rm, worktree, i18n, cli-help — 48/48, typecheck, biome — чисто; живьём worktree rm --done --dry-run → «закрытых узлов с worktree нет». Замечание: три ветки rm (один id, несколько, --done) почти дублируют друг друга — при следующей правке свести в одну. Осталось: ничего.
- 2026-11-25 20:40 · агент · Сессия узла из-за одновременного запуска осталась без id (см. «Antigravity путает сессии при старте»); по заголовку её разговор в Antigravity — 146cfeaa. Панель усыплена с --force.
- 2026-11-25 20:53 · ты · на проверке → готово
