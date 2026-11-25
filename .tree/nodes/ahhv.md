---
id: ahhv
title: Worktree для любого CLI
parent: "7997"
order: 130
status: done
done_when: "treeyard open <id> --worktree работает для Claude Code, Codex, OpenCode и Antigravity: treeyard сам заводит git worktree с веткой узла (имя с id узла) и запускает в нём сессию, команды treeyard из неё пишут основное дерево; коммиты ветки узла видны в узле и в treeyard diff без хука и без --add; queue и open нескольких узлов заводят worktree сами, одна сессия остаётся в основной папке; worktree и ветка видны в узле (show, TUI); подготовка из настроек проекта — команда setup и копия неотслеживаемых файлов по .worktreeinclude; убрать worktree treeyard не даёт, пока в нём незакоммиченные правки или невлитые коммиты; справка и docs/reference на обоих языках; тесты; живьём на пробных узлах Codex и OpenCode в своих worktree"
for:
  - .#8cbz
  - .#axz8
commits:
  - af4e884954dd779ff08614c275dcaf44795fb20d
  - a010ba8845c9e9b5d3a604ab7d3890b38d37b302
  - ed5aea36bc8ea4423f4eed7438ff68ac8a72e62f
sessions:
  - brain: claude
    id: 43ed171f-a434-4b2c-b59f-405ac5c19bd4
    name: Treeyard · Worktree для любого CLI
    started: 2026-11-23T23:06:47+03:00
    opened: 2026-11-23T23:06:47+03:00
    mode: background
created: 2026-11-23
updated: 2026-11-25T20:15:36+03:00
closed: 2026-11-25
---

Человек 23.11: добавить реализацию worktree, посмотреть https://github.com/exit-0-run/treeyard. Сейчас --worktree только у Claude Code (флаг его CLI), сессии Codex, OpenCode и Antigravity правят одну папку. exit-0-run сам пишет: до ~5 агентов на одной машине хватает обычных worktree — их и берём, а у него идеи: подготовка (setup, copy по .worktreeinclude, teardown), «не терять работу» (Claude Code #46444: уборка worktree стёрла 10 дней незакоммиченного), хук WorktreeCreate у Claude Code — его worktree можно завести через treeyard.

## Журнал

- 2026-11-23 16:25 · агент · завёл узел
- 2026-11-23 16:26 · агент · нужен для: Treeyard › «Мультиагентная проба на четырёх CLI» (8cbz)
- 2026-11-23 16:43 · агент · Человек 23.11 («выбирай как лучше»): узел вобрал «Своя git-ветка у узла, коммиты привязываются к узлу сами» из «Вехи 3» — ветка на узел без своей папки не работает (в одной папке одна ветка); при параллельной раздаче worktree включается сам, одна сессия — в основной папке. Вливание — merge-коммитом, см. «Слияние узла одной командой».
- 2026-11-23 16:43 · агент · нужен для: Treeyard › «PR из узла: описание — из узла, ссылка на issue» (axz8)
- 2026-11-23 23:06 · агент · нужен для: Treeyard › «Ранние конфликты между узлами» (bd7z)
- 2026-11-23 23:06 · агент · больше не нужен для: Treeyard › «Ранние конфликты между узлами» (bd7z)
- 2026-11-23 23:06 · claude · новая сессия в фоне (do)
- 2026-11-23 23:06 · claude · к работе → в работе
- 2026-11-23 23:31 · агент · привязан коммит af4e884954dd779ff08614c275dcaf44795fb20d
- 2026-11-23 23:31 · агент · привязан коммит a010ba8845c9e9b5d3a604ab7d3890b38d37b302
- 2026-11-23 23:32 · агент · Сделано, ветка worktree-jazzy-tinkering-conway (коммиты af4e884, a010ba8; не влита). treeyard сам заводит worktree для любого CLI: ветка treeyard/<id>, папка <проект>.worktrees/<id>, реестр в .tree/.local/worktrees.json; open --worktree и --no-worktree; open нескольких узлов и queue (parallel от 2) оставляют один узел в папке проекта, остальным заводят worktree (без git или без коммитов — тихо остаются вместе); узел с worktree дальше открывается в нём сам, у сессии в узле поле dir. Команды treeyard из такого worktree пишут основное дерево без --project (treeOfWorktree). Коммиты ветки видны в show (строка worktree и коммиты), show --json, карточке TUI, V и treeyard diff без хука и --add; после rm привязываются к узлу. Подготовка: ключ setup в tree.md (treeyard config setup "…") и копия неотслеживаемых файлов по .worktreeinclude. treeyard worktree [add|setup|rm|--json]; rm не убирает worktree с незакоммиченным, невлитыми коммитами или открытой панелью, ключа --force нет. Форма запуска в TUI: Worktree у любого мозга. Справка ru/en и docs/reference ru/en. Доказательства: npm run typecheck, lint, build чистые; npm test — 90 файлов, 815 тестов зелёные; новые test/worktree.test.ts (реальный git: ветка, копия, setup, коммиты в узле и diff, отказ rm, команды из worktree пишут main), worktree-launch.test.ts (cwd, env, dir у сессии, resume, wake, settlePending для 4 CLI, open нескольких, queue), worktree-tmux.test.ts (настоящий tmux на своём сокете, заглушки 4 CLI: первый узел в папке проекта, остальные в worktree), worktree-card.test.tsx. Живую проверку на настоящих Codex и OpenCode не делал (запрещено заданием). Сценарий: 1) копия проекта с деревом в git, два узла a и b закоммичены; echo .env > .worktreeinclude, создать неотслеживаемый .env, treeyard config setup "touch .ready"; 2) treeyard open a b --brain codex --pane --start do --yes — a в папке проекта, b в <копия>.worktrees/b: там есть .env и .ready, treeyard worktree показывает b; 3) в панели b попросить сделать коммит и treeyard log b "тест" — treeyard show b в основной папке показывает коммит и запись без --add, в копии .tree/ запись не появилась; treeyard diff b показывает коммит; 4) treeyard worktree rm b — отказ, пока в панели есть правки или ветка не влита; закрыть панель, git merge treeyard/b в основной папке, rm — убран, коммит остался у узла; 5) то же с --brain opencode и treeyard queue a b c --pane --brain opencode --parallel 2; 6) закрыть панели (tmux -L brainyard kill-session -t <имя>). Что проверить внимательно: песочница Codex может не пускать запись в основной .git и в основной .tree/ вне своей папки (узел про доступ Codex к treeyard и git). Что осталось координатору: (1) src/agents/send.ts — три cwd: dir (stop, open resume, startPane resume) заменить на sessionFolder(dir, ref) из src/worktree.ts, иначе send в уснувшую панель или фон из worktree продолжит не в той папке; (2) src/status.ts liveIn ищет живые сессии только в папке проекта и места запуска — worktreeDirs(project) надо добавить в dirs; (3) treeyard config из worktree читает копию ветки (configCommand берёт findProject, а не treeOfWorktree); (4) скилл treeyard-coordinate стоит дополнить: --worktree, --no-worktree, worktree rm и влив ветки (узел про слияние) — не трогал. Идеи не заводил: уже есть дети про порты и про слияние.
- 2026-11-23 23:32 · агент · в работе → на проверке
- 2026-11-23 23:37 · агент · привязан коммит ed5aea36bc8ea4423f4eed7438ff68ac8a72e62f
- 2026-11-23 23:39 · агент · Принято (координатор): ветка worktree-jazzy-tinkering-conway влита в main без конфликтов; доведено то, что сессия оставила координатору (ed5aea3): письма продолжают уснувшую и фоновую сессию в её worktree (sessionFolder в deliver.ts), treeyard status видит живые сессии в worktree узлов, treeyard config из worktree читает основное дерево; песочница Codex открывает .tree проекта (f8433f4, у «Доступа Codex»). npm run typecheck, lint — чисто; npm test 866/866 на main; build. Скилл treeyard-coordinate про --worktree и влив — в «Ответе на письмо». Живьём на Codex и OpenCode в своих worktree — в «Мультиагентной пробе».
- 2026-11-25 20:15 · ты · на проверке → готово
