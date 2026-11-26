---
id: 4hme
title: Добавить needs, а не заменить
parent: 9xem
order: 180
status: done
done_when: treeyard set <id> needs+=<id> добавляет связь, needs-=<id> убирает одну, а needs=<id> по-прежнему задаёт список целиком и пишет, что было до него; справка и docs/reference на обоих языках; тест; typecheck, тесты, lint и build проходят
commits:
  - a939e17fccab15f3abf470cdae7fcb401546a762
sessions:
  - brain: claude
    id: 324f8a8c-481b-4828-b66d-6baaa28aa282
    name: Treeyard · Добавить needs, а не заменить
    started: 2026-11-26T00:12:29+03:00
    opened: 2026-11-26T00:12:29+03:00
    mode: pane
    pane: claude-0e8b40a8
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/4hme
  - brain: claude
    id: 27def1a9-9d04-437f-9620-f76af2cfbcf9
    name: Treeyard · Добавить needs, а не заменить
    started: 2026-11-26T09:03:58+03:00
    opened: 2026-11-26T09:03:58+03:00
    mode: pane
    pane: claude-9cc5303a
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/4hme
created: 2026-11-23
updated: 2026-11-26T10:27:51+03:00
closed: 2026-11-26
---

Откуда: Treeyard

## Журнал

- 2026-11-23 16:26 · агент · завёл узел
- 2026-11-23 16:47 · агент · идея → к работе
- 2026-11-26 00:12 · claude · новая сессия в панели (do) в worktree treeyard/4hme
- 2026-11-26 00:12 · claude · к работе → в работе
- 2026-11-26 00:13 · claude · привязан коммит a939e17fccab15f3abf470cdae7fcb401546a762
- 2026-11-26 00:14 · claude · treeyard set <id> needs+=<id> добавляет связь (уже есть — без изменений), needs-=<id> убирает одну (нет такой связи — ошибка, ничего не меняется), needs=<id> по-прежнему задаёт список целиком и печатает «needs было: …». Справка set (ru/en), docs/reference.md и reference.ru.md обновлены. Проверки: test/set-needs.test.ts — 2/2 (добавление, повтор, снятие, обратная связь neededBy, замена со строкой «было», отказы без записи); test/set-many.test.ts 4/4; test/i18n.test.ts 16/16; npm run typecheck и npm run lint чисто. Полный npm test и npm run build не запускались — координатору. Коммит a939e17.
- 2026-11-26 00:14 · claude · в работе → на проверке
- 2026-11-26 00:19 · агент · Принято (координатор): a939e17 влит в main; needs+= добавляет связь, needs-= убирает одну (нет такой — ошибка без изменений), needs= задаёт список и печатает «needs было: …»; справка и docs/reference на обоих языках; test/set-needs.test.ts. На main: typecheck, lint, build — чисто, npm test (--maxWorkers=2) 1093/1093, нагрузка не выше 4. Осталось: ничего.
- 2026-11-26 09:03 · claude · новая сессия в панели (do) в worktree treeyard/4hme
- 2026-11-26 10:27 · ты · на проверке → готово
