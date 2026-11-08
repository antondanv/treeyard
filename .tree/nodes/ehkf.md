---
id: ehkf
title: "show --only: нужная часть узла"
parent: s3sb
order: 90
status: review
who: agent
done_when: treeyard show <id> --only sessions,commits,history,journal выводит только эти части; help, docs RU/EN; тесты
commits:
  - cf8d79651723ae106a8d91ffdeac55f4eb0470f5
created: 2026-11-08
updated: 2026-11-08T14:18:05+03:00
---

Разбор 08.11: grep -A4 '^сессии:', sed '/коммиты/,/журнал/p', grep "→ готово|на проверке →".

## Журнал

- 2026-11-08 12:19 · агент · завёл узел
- 2026-11-08 12:19 · ты · идея → к работе
- 2026-11-08 14:18 · агент · привязан коммит cf8d79651723ae106a8d91ffdeac55f4eb0470f5
- 2026-11-08 14:18 · агент · Сделано: show <id> --only header,criterion,commits,children,sessions,note,journal,history (и по-русски); пустая часть пишет «—»; history — смены статуса из журнала; с --json только эти поля. help, docs RU/EN, «Команды дерева». Тесты: test/show.test.ts.
- 2026-11-08 14:18 · агент · к работе → на проверке
