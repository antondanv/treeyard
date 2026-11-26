---
id: zwwp
title: Доступ Codex к treeyard и git
parent: 5byq
order: 20
status: done
done_when: "treeyard один раз спрашивает, как запускать Codex из дерева, как для Antigravity: «песочница + treeyard и git» (workspace-write с network_access и .git проекта в writable_roots, остальное из config.toml) или «как в config.toml»; выбор — в treeyard config и настройках TUI; treeyard status для Codex без доступа подсказывает строки config.toml; справка и docs/reference на обоих языках; живьём на пробном узле Codex в панели сам делает treeyard send и git commit"
for:
  - .#8cbz
commits:
  - 8ba1ead422e4dfc395e4012210174ad1ed057482
  - 5b50999f4a37f72ef9ea7f29d208d084d93745a9
  - fe91a2ea4417e1eec4ae5b3b634ca4c6745eed98
  - 417404c702570bcae157b65c65223f781fc7c1ea
  - f8433f4a45252a5798a2a81ecc44c02dc105e9e8
sessions:
  - brain: claude
    id: 770b19fe-313c-4830-b76b-479d2d2a0ebe
    name: Treeyard · Доступ Codex к treeyard и git
    started: 2026-11-23T23:06:45+03:00
    opened: 2026-11-23T23:06:46+03:00
    mode: background
created: 2026-11-23
updated: 2026-11-24T12:56:31+03:00
closed: 2026-11-24
---

Проба 23.11 (codex sandbox, Codex 0.170): по умолчанию сокет tmux и .git — Operation not permitted; с -c sandbox_workspace_write.network_access=true tmux доступен; с writable_roots=[<проект>/.git] запись в .git проходит; ~/.treeyard из песочницы не пишется — ящик держать в папке проекта.

## Журнал

- 2026-11-23 16:23 · агент · завёл узел
- 2026-11-23 16:23 · агент · нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)
- 2026-11-23 16:26 · агент · больше не нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)
- 2026-11-23 16:26 · агент · нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)
- 2026-11-23 23:06 · claude · новая сессия в фоне (do)
- 2026-11-23 23:06 · claude · к работе → в работе
- 2026-11-23 23:25 · агент · привязан коммит 8ba1ead422e4dfc395e4012210174ad1ed057482
- 2026-11-23 23:25 · агент · привязан коммит 5b50999f4a37f72ef9ea7f29d208d084d93745a9
- 2026-11-23 23:27 · агент · привязан коммит fe91a2ea4417e1eec4ae5b3b634ca4c6745eed98
- 2026-11-23 23:31 · агент · Сценарий живой проверки Codex 0.170 (после слияния, временная копия дерева в git-репозитории, свой CODEX_HOME): 1) treeyard config codex_access ask → treeyard open <узел> --brain codex --pane --yes без терминала: код 2 и подсказка treeyard config codex_access sandbox|config. 2) treeyard config codex_access sandbox → treeyard status: строка «Codex  песочница + treeyard и git», проблемы codex-access нет. 3) treeyard open <узел> --brain codex --pane --task "выполни treeyard send <другой узел> «пинг», потом git commit --allow-empty -m probe и покажи вывод обеих команд": send проходит, коммит виден в git log, в журнале адресата письмо. 4) усыпить панель (x) и treeyard send <узел> "привет": панель просыпается с теми же флагами (в строке запуска codex … --sandbox workspace-write -c sandbox_workspace_write.network_access=true -c sandbox_workspace_write.writable_roots=[…/.git]). 5) treeyard config codex_access config при config.toml без sandbox_workspace_write: те же команды в сессии упираются в Operation not permitted, treeyard status называет строки; после добавления их в config.toml status без проблем по Codex.
- 2026-11-23 23:31 · агент · Treeyard один раз спрашивает, как запускать Codex: «песочница + treeyard и git» или «как в config.toml» (src/agents/access.ts, codex-config.ts, settings.ts, tui/App.tsx, tui/dialogs.tsx, cli/commands.ts). Спрашивает перед первым запуском, продолжением и пробуждением панели — в TUI (даже с confirm выкл), в treeyard open и init --agent; без терминала open останавливается с кодом 2 и подсказкой. Выбор — codex_access в settings.json, в «,» → «Права Codex» и treeyard config codex_access sandbox|config|ask; до выбора флагов нет. «Песочница» = --sandbox workspace-write, network_access=true и writable_roots с .git проекта (из worktree — .git основного репозитория) плюс свои roots из config.toml; подтверждения и модель — из config.toml; флаги идут через extraArgs Brainyard (его не правил) в новую сессию, resume, wake и treeyard send. treeyard status: строка «Codex» и проблема codex-access с командой treeyard config codex_access sandbox и недостающими строками для ~/.codex/config.toml, если Codex установлен или выбор сделан, config.toml не пускает к tmux/.git и выбрана не песочница. Справка (status, config), README и docs/reference — на двух языках. Проверки: typecheck, 810/810 тестов (новые: test/codex-config, codex-launch, codex-access), lint, build — зелёные. Проба политики через codex sandbox (0.170, без сессий и модели; временные репозиторий и tmux-сокет): без флагов git commit и tmux list-sessions — Operation not permitted; с флагами из sandboxArgs коммит прошёл ([main 9aeabfe]) и tmux ответил. Экраны диалога и status смотрел в 90×28 и 100×30, ru и en. Не сделано: живая проверка (сценарий — записью выше); идея «Песочница Codex в worktree узла» — в worktree .tree основной папки вне записываемых, добавить .tree проекта в writable_roots, когда cwd не папка проекта (узел завести из worktree не вышло — замечание pt37). Влияние на соседей: координатору теперь нужно, чтобы человек один раз выбрал codex_access, иначе treeyard open --brain codex без терминала остановится; при слиянии с «Worktree для любого CLI» сверить строки fullAccess(…, dir) и extraArgs: plan.extraArgs рядом с permissionMode в launch.ts и panes.ts. Коммиты ветки worktree-whimsical-percolating-widget: 8ba1ead, 5b50999, fe91a2e.
- 2026-11-23 23:31 · агент · в работе → на проверке
- 2026-11-23 23:33 · агент · привязан коммит 417404c702570bcae157b65c65223f781fc7c1ea
- 2026-11-23 23:34 · агент · Принято (координатор): ветка worktree-whimsical-percolating-widget влита в main (417404c, конфликт в send.ts — оставлен ящик писем, fullAccess(brain, dir) перенесён в deliver.ts); npm run typecheck, lint — чисто, npm test 826/826 на main, build. Только свои файлы, .tree/ не коммитился. Живая проверка (Codex в панели сам делает treeyard send и git commit) — в «Мультиагентной пробе на четырёх CLI»: нужен выбор человека codex_access.
- 2026-11-23 23:38 · агент · привязан коммит f8433f4a45252a5798a2a81ecc44c02dc105e9e8
- 2026-11-24 12:56 · ты · на проверке → готово
