---
id: fyxp
title: Правила совместной работы
parent: 9xem
order: 100
status: review
done_when: "CONTRIBUTING.md и CONTRIBUTING.ru.md: как собрать и проверить проект (typecheck, test, lint, build), ветки и Conventional Commits, как оформить PR и issue, нести ли в PR правки .tree; шаблоны PR и issue в .github; README ссылается на правила"
commits:
  - 73d944b2d985df50383a682fc60e20f7e6ea6a4b
  - 6b9783a522cdcf2641afc013ccdc684c7a601f4b
sessions:
  - brain: claude
    id: e1b678f2-eac4-4bb1-85ff-5fafee0c109e
    name: Treeyard · Правила совместной работы
    started: 2026-11-26T00:53:02+03:00
    opened: 2026-11-26T00:53:02+03:00
    mode: pane
    pane: claude-23c33be9
    dir: /Users/antondanilov/Projects/Treeyard.worktrees/fyxp
created: 2026-11-16
updated: 2026-11-26T00:57:20+03:00
---

Человек 16.11.2026: в релиз 0.2.0 — правила совместной работы, оформление PR и т. д. Сейчас в репозитории нет ни CONTRIBUTING, ни шаблонов PR/issue.

## Журнал

- 2026-11-16 00:33 · агент · завёл узел
- 2026-11-26 00:53 · claude · новая сессия в панели (do) в worktree treeyard/fyxp
- 2026-11-26 00:53 · claude · к работе → в работе
- 2026-11-26 00:55 · claude · привязан коммит 73d944b2d985df50383a682fc60e20f7e6ea6a4b
- 2026-11-26 00:55 · claude · CONTRIBUTING.md и CONTRIBUTING.ru.md (одна структура, 9 разделов): с чего начать (мелочь — сразу PR, крупное — сначала issue), сборка и запуск (Node 22+, tmux — тесты без него пропускаются), проверки npm run typecheck && npm test && npm run lint && npm run build (как в CI: Ubuntu/macOS, Node 22/24), правила кода (t() и en.ts, шаблоны на двух языках, справочник на двух языках, проверка в TUI, Brainyard), ветки от main по смыслу и Conventional Commits с примерами из истории, rebase вместо merge main, без строк-подписей; как оформить PR и issue (с отчётом из ~/.treeyard/crashes/); дерево .tree/ — план мейнтейнера, коммитится отдельными chore(tree), в PR его правки не несут (конфликты, слияние на GitHub не запускает драйвер обзора), проверка git diff --stat main...HEAD -- .tree. Шаблоны: .github/pull_request_template.md, .github/ISSUE_TEMPLATE/bug_report.yml (Bug, label bug), feature_request.yml (Idea, label enhancement), config.yml (ссылки на справочник и правила). Доказательства: biome check . — Checked 253 files, no fixes; три YAML разбираются (yaml.parse: 6, 4 поля, 2 ссылки); все относительные ссылки в CONTRIBUTING существуют; упоминаний ассистентов и Co-Authored-By нет. npm test и build по заданию не гонял (менялись только документы). Осталось координатору: ссылка из README — в раздел Development / «Разработка» (перед лицензией) одной строкой: «How to send a change — CONTRIBUTING.md» / «Как прислать правку — CONTRIBUTING.ru.md»; можно ещё строку в «Documentation» / «Документация».
- 2026-11-26 00:55 · claude · в работе → на проверке
- 2026-11-26 00:57 · агент · привязан коммит 6b9783a522cdcf2641afc013ccdc684c7a601f4b
- 2026-11-26 00:57 · агент · Принято (координатор): влит в main; CONTRIBUTING.md и CONTRIBUTING.ru.md (одна структура: с чего начать, сборка, проверки, код, ветки и Conventional Commits, PR, issue, что делать с .tree/), шаблоны PR и issue в .github/; факты сверены (скрипты test:watch и format есть, CI — ubuntu и macos × Node 22 и 24). Ссылку на правила в разделе «Разработка» обоих README добавил координатор. test/docs и npm-readme — 16/16. Осталось: ничего.
