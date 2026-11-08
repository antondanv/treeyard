---
id: q9vz
title: Скрипт разбора стенограмм
parent: h6kw
order: 70
status: todo
who: agent
done_when: scripts/usage-audit.mjs читает стенограммы Claude Code и Codex и выводит вызовы treeyard по командам, пайпы и циклы вокруг них, несуществующие команды, ошибки, ручные правки .tree/; строка в AGENTS.md; разбор раз в 2–3 недели
created: 2026-11-08
updated: 2026-11-08T12:20:05+03:00
---

Основа — скрипт разбора 08.11 (лежит в .tree/.local/evidence этого узла). Claude Code удаляет стенограммы примерно через 30 дней. Codex оборачивает вызовы в exec с JS: tools.exec_command({cmd:"…"}).

## Журнал

- 2026-11-08 12:20 · агент · завёл узел
