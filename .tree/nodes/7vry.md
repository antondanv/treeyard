---
id: 7vry
title: Модели и лимиты CLI
parent: 5byq
order: 280
status: done
done_when: "команды treeyard models [brain] [--json] и treeyard limits [brain] [--json] показывают модели с уровнями effort и локальные окна лимитов CLI через Brainyard без сетевых вызовов (offline: true); тесты, справка на обоих языках и упоминание в скилле координатора"
commits:
  - 1568a61296bebfdef508e1a3af1eef89e5930172
sessions:
  - brain: antigravity
    id: e2078e34-32a1-436b-9733-8d47c2055f8b
    name: Treeyard · Модели и лимиты CLI
    started: 2026-11-25T19:21:09+03:00
    opened: 2026-11-25T19:21:09+03:00
    mode: pane
    pane: agy-b7cba941
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/7vry
created: 2026-11-25
updated: 2026-11-25T20:10:26+03:00
closed: 2026-11-25
---

Человек 25.11 (пункт 2): координатору нужно выбирать CLI, --model и --effort по доступным моделям и свободным лимитам без ручных вызовов Brainyard через node -e.

## Журнал

- 2026-11-25 12:25 · агент · завёл узел
- 2026-11-25 19:21 · antigravity · новая сессия в панели (do) в worktree treeyard/7vry
- 2026-11-25 19:21 · antigravity · к работе → в работе
- 2026-11-25 19:21 · ты · разрешение подтверждено: доверие к папке — «1. Yes, I trust this folder»
- 2026-11-25 19:36 · antigravity · привязан коммит 1568a61296bebfdef508e1a3af1eef89e5930172
- 2026-11-25 19:36 · antigravity · Реализованы команды treeyard models [brain] [--json] и treeyard limits [brain] [--json] без сетевых вызовов (offline: true). Показывают модели с уровнями effort, отметкой defaultEffort, локальные окна лимитов с источником, возрастом и сбросом; справка на RU/EN, переводы в en.ts, упоминание в skills/treeyard-coordinate/SKILL.md; 50 целевых тестов зелёные, typecheck, lint и build без ошибок.
- 2026-11-25 19:36 · antigravity · в работе → на проверке
- 2026-11-25 19:42 · ты · Принято (координатор): 1568a61 на main; npm run typecheck, npm test 1067/1067, lint, build — чисто; живая проверка treeyard models antigravity и treeyard limits (offline: true) показала модели с effort и локальные окна лимитов без сетевых вызовов. Панель усыплена через treeyard sleep. Осталось: ничего.
- 2026-11-25 19:55 · агент · Ревью 25.11: treeyard limits показывает просроченные окна как текущие. Живьём 19:54: Claude Code seven_day 100% · сброс в 19:00 (resetsAt 1795622400 = 25.11 19:00, уже прошло), Codex primary 11% · сброс в 14:02 (снимок 9 ч назад). Координатор по такой таблице обойдёт Claude, хотя лимит уже сбросился. Надо: окно с resetsAt в прошлом — «сброшено в …» и 0% (или явно «устарело»), в --json — признак; тест в test/models-limits.test.ts.
- 2026-11-25 20:09 · агент · Находка ревью 25.11 исправлена в «Просроченные окна в limits» (6c2832f, 4b0a78d на main).
- 2026-11-25 20:10 · ты · на проверке → готово
