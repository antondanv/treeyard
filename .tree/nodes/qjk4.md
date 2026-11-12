---
id: qjk4
title: Полный экспорт в show --json
parent: y5ss
order: 10
status: done
done_when: treeyard show --json --all отдаёт у каждого узла описание, журнал, историю статусов (кто, когда, из какого в какой), картинки (файл, путь, подпись, дата), created/updated/closed и порядок среди соседей; в корне — version формата JSON; тесты; справка и docs RU/EN
commits:
  - 8a8d67d6044504524de61895d09bbca784129014
sessions:
  - brain: claude
    id: dd87aa88-ecb4-4bb1-87f6-cbeef9c63937
    name: Treeyard · Полный экспорт в show --json
    started: 2026-11-12T09:42:16+03:00
    opened: 2026-11-12T09:42:16+03:00
    mode: pane
    pane: claude-27828db9
created: 2026-11-11
updated: 2026-11-12T09:56:14+03:00
closed: 2026-11-12
---

Сейчас в show --json нет журнала, описания и дат — без них вебу пришлось бы разбирать markdown самому.

## Журнал

- 2026-11-11 11:37 · агент · завёл узел
- 2026-11-12 09:42 · claude · новая сессия в панели (do)
- 2026-11-12 09:42 · claude · к работе → в работе
- 2026-11-12 09:52 · агент · привязан коммит 8a8d67d6044504524de61895d09bbca784129014
- 2026-11-12 09:52 · агент · show --json --all — полный экспорт для программ (src/cli/print.ts fullTreeJson; разбор смен статуса — statusSteps в src/model/history.ts). В корне version: 1, title, goal, created, summary, nodes; у каждого узла — поля короткой формы и parent, position (место среди соседей того же статуса: order в файлах значим только внутри группы), created/updated/closed, note, journal [{at, who, text}], history [{at, who, from, to, comment}] ключами статусов на любом языке, images [{file, path, note, added}]; дети — по статусам в порядке по умолчанию, личная настройка не влияет (тест в priorities). --under <id> — ветка с version; без --all --json прежний. Справка RU/EN, docs/reference(.ru).md. Проверка: typecheck, npm test 551/551, lint, build; treeyard show --json --all по этому дереву — 167/167 узлов с note, journal, history, images, created, updated, position, closed у 102/102 закрытых. Осталось: файлы дерева ветки «Данные для Treeyard Web» (y5ss и дети, этот узел тоже) не в git — заведены другой сессией, коммит дерева за человеком; show <id> --json --all пока даёт прежний сырой узел — полный узел есть через --under <id>.
- 2026-11-12 09:52 · агент · в работе → на проверке
- 2026-11-12 09:56 · ты · на проверке → готово
