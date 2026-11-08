---
id: 7jsc
title: "add: несколько подузлов из JSON"
parent: s3sb
order: 70
status: done
who: agent
done_when: treeyard add --parent X --from-json - заводит массив узлов с title, done_when, note, who, status, needs, children и печатает их id; ошибка — без частичной записи; help, docs RU/EN; тесты
commits:
  - 9f02ff54d9bc1f38a082f43df0c61f6404304c44
created: 2026-11-08
updated: 2026-11-08T17:21:28+03:00
closed: 2026-11-08
---

Разбор 08.11: шесть add подряд и затем set needs; цепочки log×3 → add×3.

## Журнал

- 2026-11-08 12:19 · агент · завёл узел
- 2026-11-08 14:18 · агент · привязан коммит 9f02ff54d9bc1f38a082f43df0c61f6404304c44
- 2026-11-08 14:18 · агент · Сделано: add --parent <id> --from-json <файл|-> — массив узлов (title, done_when, note, who, status, check, waiting, until, needs, key, children), печатает id; key — ссылки needs внутри пачки; --status/--who — по умолчанию; ошибка — ни одного узла. help, docs RU/EN, «Команды дерева». Тесты: test/add-batch.test.ts.
- 2026-11-08 14:18 · агент · к работе → на проверке
- 2026-11-08 17:21 · ты · на проверке → готово
