---
id: ahhv
title: Worktree для любого CLI
parent: "7997"
order: 130
status: todo
done_when: "treeyard open <id> --worktree работает для Claude Code, Codex, OpenCode и Antigravity: treeyard сам заводит git worktree с веткой узла и запускает в нём сессию, команды treeyard из неё пишут основное дерево; worktree и ветка видны в узле (show, TUI); подготовка из настроек проекта — команда setup и копия неотслеживаемых файлов по .worktreeinclude; убрать worktree treeyard не даёт, пока в нём незакоммиченные правки или несмёрженные коммиты; справка и docs/reference на обоих языках; тесты; живьём на пробных узлах Codex и OpenCode в своих worktree"
for:
  - .#8cbz
created: 2026-11-23
updated: 2026-11-23T16:26:13+03:00
---

Человек 23.11: добавить реализацию worktree, посмотреть https://github.com/exit-0-run/treeyard. Сейчас --worktree только у Claude Code (флаг его CLI), сессии Codex, OpenCode и Antigravity правят одну папку. exit-0-run сам пишет: до ~5 агентов на одной машине хватает обычных worktree — их и берём, а у него идеи: подготовка (setup, copy по .worktreeinclude, teardown), «не терять работу» (Claude Code #46444: уборка worktree стёрла 10 дней незакоммиченного), хук WorktreeCreate у Claude Code — его worktree можно завести через treeyard.

## Журнал

- 2026-11-23 16:25 · агент · завёл узел
- 2026-11-23 16:26 · агент · нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)
