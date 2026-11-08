---
id: ehkf
title: "show --only: нужная часть узла"
parent: s3sb
order: 90
status: todo
who: agent
done_when: treeyard show <id> --only sessions,commits,history,journal выводит только эти части; help, docs RU/EN; тесты
created: 2026-11-08
updated: 2026-11-08T12:24:51+03:00
---

Разбор 08.11: grep -A4 '^сессии:', sed '/коммиты/,/журнал/p', grep "→ готово|на проверке →".

## Журнал

- 2026-11-08 12:19 · агент · завёл узел
- 2026-11-08 12:19 · ты · идея → к работе
