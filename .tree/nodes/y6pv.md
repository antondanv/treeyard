---
id: y6pv
title: Чистый npm-пакет
parent: 5w6w
order: 100
status: review
who: agent
done_when: "`npm pack --dry-run`: только dist, templates, skills, нужные картинки, README, LICENSE — без скриншотов-исходников и рабочих заметок"
check: npm pack --dry-run
created: 2026-10-02
updated: 2026-10-06T22:04:18+03:00
---

## Журнал

- 2026-10-06 22:04 · агент · npm pack --dry-run: 280 файлов, 438 КБ — dist, templates, skills, README.md, LICENSE. docs/ убран из files (картинки README грузятся с GitHub по полю repository), README.ru.md на время упаковки отодвигается (scripts/npm-readme.mjs).
- 2026-10-06 22:04 · агент · к работе → на проверке
