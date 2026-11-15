---
id: cs6g
title: Удаление treeyard целиком
parent: 9xem
order: 50
status: todo
who: agent
done_when: "Одна команда убирает всё, что treeyard поставил вне .tree: скиллы treeyard из домов CLI и из папки проекта, хук post-commit, по желанию — настройки; дерево .tree не трогает; справочник RU/EN описывает команду; typecheck, тесты, lint и build проходят"
created: 2026-11-16
updated: 2026-11-16T00:42:16+03:00
---

Человек 16.11.2026 — в релиз 0.2.0. Нужно, раз скиллы начнут ставиться сами (узел «Скиллы ставятся сами»): treeyard будет писать в ~/.claude/skills, ~/.codex/skills, .agents/skills. Сейчас убрать можно только хук — hook remove.

## Журнал

- 2026-11-16 00:42 · агент · завёл узел
