---
id: p3wa
title: "Нет справки по команде: treeyard add --help → «Unknown option '--help'», ключи видно только в общем treeyard help"
parent: 5w6w
order: 180
status: review
done_when: treeyard <команда> --help печатает ключи этой команды (ru и en), а не «Unknown option»
commits:
  - fb56010b4b552b6e1afd632bc421f0cd6f5483e8
created: 2026-10-04
updated: 2026-10-07T16:16:45+03:00
---

Откуда: Brainyard › «Веха 1: Treeyard 2 недели живёт на Brainyard 0.2 из npm» (qpjt)

## Журнал

- 2026-10-04 16:36 · агент · завёл узел
- 2026-10-07 09:47 · агент · идея → к работе
- 2026-10-07 09:47 · агент · Разбор: подтвердилось — add, set, log, show с --help: «Unknown option '--help'» (parse() в cli/commands.ts, strict). Для Вехи 2: без этого чужой человек не разберётся с ключами.
- 2026-10-07 15:13 · агент · привязан коммит fb56010b4b552b6e1afd632bc421f0cd6f5483e8
- 2026-10-07 15:18 · агент · Сделано (fb56010): <команда> --help, -h и treeyard help <команда> печатают строки этой команды из общей справки (одна копия текстов, ru и en) и строку «все команды — treeyard help»; test/cli-help.test.ts.
- 2026-10-07 15:18 · агент · к работе → на проверке
