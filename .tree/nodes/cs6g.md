---
id: cs6g
title: Удаление treeyard целиком
parent: 9xem
order: 30
status: done
who: agent
done_when: "Одна команда убирает всё, что treeyard поставил вне .tree: скиллы treeyard из домов CLI и из папки проекта, хук post-commit, по желанию — настройки; дерево .tree не трогает; справочник RU/EN описывает команду; typecheck, тесты, lint и build проходят"
commits:
  - 012ed2b2283e11f1a137c3d1d8419471cd78e93e
sessions:
  - brain: claude
    id: 59cadda1-490c-48d5-a08e-339a47186a59
    name: Treeyard · Удаление treeyard целиком
    started: 2026-11-22T13:00:30+03:00
    opened: 2026-11-22T13:00:30+03:00
    mode: pane
    pane: claude-0b7b7ddf
created: 2026-11-16
updated: 2026-11-22T13:11:31+03:00
closed: 2026-11-22
---

Человек 16.11.2026 — в релиз 0.2.0. Нужно, раз скиллы начнут ставиться сами (узел «Скиллы ставятся сами»): treeyard будет писать в ~/.claude/skills, ~/.codex/skills, .agents/skills. Сейчас убрать можно только хук — hook remove.

## Журнал

- 2026-11-16 00:42 · агент · завёл узел
- 2026-11-22 13:00 · claude · новая сессия в панели (do)
- 2026-11-22 13:00 · claude · к работе → в работе
- 2026-11-22 13:07 · агент · привязан коммит 012ed2b2283e11f1a137c3d1d8419471cd78e93e
- 2026-11-22 13:08 · агент · Сделано (012ed2b): treeyard uninstall [--settings] [--dry-run] (src/uninstall.ts, команда в src/cli/commands.ts). Убирает скиллы treeyard, treeyard-init, treeyard-coordinate из ~/.claude/skills, ~/.codex/skills, ~/.gemini/config/skills (во всех трёх, стоит CLI или нет; ссылку убирает как ссылку, её цель и чужие скиллы не трогает) и копии в .claude/skills, .agents/skills текущего проекта; блок treeyard в post-commit — в репозитории текущей папки и во всех проектах из ~/.treeyard/projects.json (строки человека остаются, файл только из блока удаляется; хуки внутри репозитория — подсказка убрать строку самому); --settings — settings.json и projects.json в ~/.treeyard и пустую папку; --dry-run — только список. .tree/ и блок в AGENTS.md/CLAUDE.md не трогает; сама команда скиллы обратно не ставит (NO_AUTO_SKILLS) и в конце напоминает npm uninstall -g. Справочник ru/en: раздел «Удаление treeyard» / «Removing treeyard», строка в оглавлении и у команд скиллов; справка CLI ru/en. Доказательства: test/uninstall.test.ts (dry-run ничего не меняет; uninstall чистит три CLI, копию проекта, ссылку, хук здесь и в другом проекте, оставляет хук человека, дерево и настройки; --settings убирает ~/.treeyard; повтор — «убирать нечего»; --help); npm test 724/724 после правки cli-help, typecheck, lint, build — без ошибок. Живая проверка dist на временном HOME: init → hook install → uninstall --dry-run (9 скиллов + хук) → uninstall --settings (12 ✓, exit 0) → папки скиллов пусты, хука и ~/.treeyard нет, .tree/ на месте. Осталось: ничего.
- 2026-11-22 13:08 · агент · в работе → на проверке
- 2026-11-22 13:11 · ты · на проверке → готово
