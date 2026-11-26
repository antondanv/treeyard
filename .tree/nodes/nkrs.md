---
id: nkrs
title: Список проектов с деревьями
parent: y5ss
order: 10
status: done
done_when: "treeyard projects показывает папки с деревьями, где запускались команды treeyard или само дерево (TUI), свежие сверху: название, путь, когда видел; --json даёт path, title, goal, seen для Treeyard Web. Удалённые папки и копии дерева в git worktree в список не попадают; справочник — на двух языках"
commits:
  - a2b65c19ea8d814f9d7e4163a026ab60279d016b
sessions:
  - brain: claude
    id: 758f6eed-f743-47f0-815d-5ad557c95a93
    name: Treeyard · Список проектов с деревьями
    started: 2026-11-12T14:58:03+03:00
    opened: 2026-11-12T14:58:03+03:00
    mode: pane
    pane: claude-a08e1241
created: 2026-11-11
updated: 2026-11-12T15:06:04+03:00
closed: 2026-11-12
---

treeyard projects --json — папки с деревьями, которые видел treeyard, чтобы веб находил проекты сам, а не по ручному списку. По желанию.

## Журнал

- 2026-11-11 11:37 · агент · завёл узел
- 2026-11-12 14:58 · claude · новая сессия в панели (do)
- 2026-11-12 14:58 · claude · идея → в работе
- 2026-11-12 15:05 · агент · привязан коммит a2b65c19ea8d814f9d7e4163a026ab60279d016b
- 2026-11-12 15:05 · агент · treeyard projects: папки с деревьями, которые видел treeyard, свежие сверху (src/projects.ts, ~/.treeyard/projects.json). Запоминают: любая команда, которая находит дерево (projectDir, и --project), TUI (runTui) и init --template; не чаще раза в 10 мин; связанный git worktree не запоминается. Список — только папки, где .tree/tree.md ещё есть (удалённые остаются в файле: неподключённый диск вернётся). --json — [{path, title, goal|null, seen}]. Справочник EN/RU, архитектура, help. Проверки: typecheck, npm test 65 файлов / 591 тест, lint, build — чисто; test/projects.test.ts — 6 тестов. Живьём на временном TREEYARD_HOME: пустой → «ещё не видел ни одного дерева»; show/find/goal --project в Brainyard, Factoyard, Treeyard → три строки с названием, путём, «только что»; show в git worktree копии — не попал; init в папке gone, затем rm — в списке нет, в файле есть; TUI в копии дерева (tmux -L nkrs-check) — копия встала первой. Осталось: ничего; настоящий ~/.treeyard/projects.json наполнится сам по мере работы.
- 2026-11-12 15:05 · агент · в работе → на проверке
- 2026-11-12 15:06 · ты · на проверке → готово
