---
id: 7sjm
title: "treeyard log и show принимают --project: из worktree или другой папки — журнал и просмотр узла основного дерева"
parent: 8gtc
order: 330
status: done
done_when: treeyard log <id> "…" --project <папка> и treeyard show [id] --project <папка> работают из другой папки (как diff --project); тест и строка в help
commits:
  - 4e234dd4b77b86e6c9bd666b42a154ee804447ff
created: 2026-10-04
updated: 2026-10-07T16:20:35+03:00
closed: 2026-10-07
---

Откуда: Brainyard › «Два пакета: @antondanv/brainyard (API) и @antondanv/brainyard-cli (CLI и веб)» (xq8s)

## Журнал

- 2026-10-04 16:33 · агент · завёл узел
- 2026-10-07 09:47 · агент · идея → к работе
- 2026-10-07 09:47 · агент · Разбор замечаний: подтвердилось — log и show отвечают «Unknown option '--project'» (logCommand и showCommand в cli/commands.ts парсят только свои ключи). Смысл --project как у diff (findProject(resolve(...))), не как у set. Объединён с 5tk8.
- 2026-10-07 15:13 · агент · привязан коммит 4e234dd4b77b86e6c9bd666b42a154ee804447ff
- 2026-10-07 15:18 · агент · Сделано (4e234dd): log и show принимают --project <папка> — как diff, общий helper projectDir(); help и оба README; test/cli-project.test.ts. Проверка из другой папки: log 7sjm … --project ../main → «written», show --project показывает запись.
- 2026-10-07 15:18 · агент · к работе → на проверке
- 2026-10-07 16:20 · ты · на проверке → готово
