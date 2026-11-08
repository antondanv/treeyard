---
id: edxd
title: "treeyard open для координатора: задание сверх контекста узла (--task); --model, --effort, --worktree — в справке"
parent: "7997"
order: 10
status: done
who: agent
done_when: 'treeyard open <id> --bg --task "…" --model … --effort … запускает сессию, где задание дописано к первому сообщению; --model, --effort и --worktree видны в treeyard help и docs/reference (RU/EN); в «Командах дерева» строка: раздавать узлы через treeyard open --bg, а не встроенным Agent; проверено на копии дерева'
created: 2026-11-06
updated: 2026-11-08T12:06:05+03:00
closed: 2026-11-08
---

Из логов 06.11.2026. Флаги --model, --effort и --worktree у open уже разбираются (src/cli/commands.ts, openCommand), но их нет ни в treeyard help, ни в docs/reference, поэтому координатор о них не знает. В k3w4 (Factoyard, 04–05.11) координатор писал каждому субагенту задание на 700+ знаков: «treeyard show <id>, treeyard show k3w4, прочитай DESIGN.md…». Это повторяет treeyard context и добавляет ограничения: «без платных вызовов», «не перезапускать завод», «рядом работает агент по боту».

## Журнал

- 2026-11-06 14:48 · агент · завёл узел
- 2026-11-06 14:55 · агент · идея → в работе
- 2026-11-06 15:02 · агент · open --task (текст или - из stdin) дописывается к первому сообщению абзацем «Задание к узлу:» (chat — становится первым сообщением); context --task показывает результат; --model/--effort/--worktree/--task в treeyard help (ru/en) и docs/reference (RU/EN); --worktree уходит в Brainyard, работает только в Claude Code, у остальных предупреждение; строка координатора в «Командах дерева» у корня и узлов с незакрытыми детьми. Проверки: typecheck, lint, build — 0; npm test 442 passed (test/coordinator.test.ts). Осталось: живой запуск не делал; при --start goal задание входит в условие /goal.
- 2026-11-06 15:02 · агент · в работе → на проверке
- 2026-11-08 12:06 · ты · на проверке → готово
