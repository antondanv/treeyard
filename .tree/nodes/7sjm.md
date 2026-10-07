---
id: 7sjm
title: "treeyard log и show принимают --project: из worktree или другой папки — журнал и просмотр узла основного дерева"
parent: 8gtc
order: 330
status: todo
done_when: treeyard log <id> "…" --project <папка> и treeyard show [id] --project <папка> работают из другой папки (как diff --project); тест и строка в help
created: 2026-10-04
updated: 2026-10-07T09:47:28+03:00
---

Откуда: Brainyard › «Два пакета: @antondanv/brainyard (API) и @antondanv/brainyard-cli (CLI и веб)» (xq8s)

## Журнал

- 2026-10-04 16:33 · агент · завёл узел
- 2026-10-07 09:47 · агент · идея → к работе
- 2026-10-07 09:47 · агент · Разбор замечаний: подтвердилось — log и show отвечают «Unknown option '--project'» (logCommand и showCommand в cli/commands.ts парсят только свои ключи). Смысл --project как у diff (findProject(resolve(...))), не как у set. Объединён с 5tk8.
