---
id: k5ts
title: Скиллы ставятся сами
parent: 9xem
order: 40
status: review
who: agent
done_when: "В папке с деревом основные скиллы treeyard доступны агенту в любой сессии без ручного treeyard skills install: ставятся при init и запуске treeyard, обновляются с новой версией, выключаются настройкой; treeyard status показывает, где они стоят; проверено в Claude Code, Codex и Antigravity"
commits:
  - ac0244debfd43ffd4cfddf156ca0274f1c812ca0
sessions:
  - brain: claude
    id: 18444b4d-51e6-4d39-bd8e-af4ed9916f7a
    name: Treeyard · Скиллы ставятся сами
    started: 2026-11-22T12:22:59+03:00
    opened: 2026-11-22T12:22:59+03:00
    mode: pane
    pane: claude-6df1d0e4
created: 2026-11-08
updated: 2026-11-22T12:46:38+03:00
---

Человек 08.11.2026: есть дерево в проекте — есть и основные скиллы, автоматически. Куда ставить — в личные папки CLI или в папку проекта — решить в узле.

## Журнал

- 2026-11-08 12:20 · агент · завёл узел
- 2026-11-08 12:45 · агент · Из проверки скилла treeyard 08.11: без установки в ~ скилл берётся из папки проекта — Claude Code 2.1.319 читает .claude/skills/<имя>/SKILL.md, Codex 0.166 — .agents/skills/<имя>/SKILL.md (в бинаре Codex есть только .agents/skills). Так скилл и проверялся на копии дерева: оба CLI подхватили его сами.
- 2026-11-08 13:34 · агент · У скилла treeyard теперь есть папка references/ (other-projects.md, tree-order.md): ставить нужно папку скилла целиком, а не один SKILL.md, как installSkill делает для treeyard-init.
- 2026-11-08 21:15 · агент · Из узла «treeyard status: сводка по проекту» (коммит 549084e): treeyard status уже показывает скиллы treeyard и treeyard-init по CLI — стоит, устарел (файл отличается от поставленного с версией), не стоит, нет CLI — и где стоят: дом CLI (~/.claude/skills, ~/.codex/skills, ~/.gemini/config/skills) и папка проекта (.claude/skills; .agents/skills — Codex и Antigravity, проверено по строкам бинарей codex 0.166 и agy 1.5.3). treeyard skills install теперь ставит оба скилла папками целиком (с references/), свежие копии не трогает, копии в проекте обновляет, но не заводит — src/agents/skills.ts. Автоустановка при init и запуске, обновление с версией и настройка — за этим узлом.
- 2026-11-22 12:22 · claude · новая сессия в панели (do)
- 2026-11-22 12:22 · claude · к работе → в работе
- 2026-11-22 12:45 · агент · привязан коммит ac0244debfd43ffd4cfddf156ca0274f1c812ca0
- 2026-11-22 12:46 · агент · картинка добавлена: 001.png — Настройки (,), 100×30: строка «Скиллы в CLI» — ставить сами / вручную
- 2026-11-22 12:46 · агент · Решение: скиллы ставятся в личные папки CLI (~/.claude/skills, ~/.codex/skills, ~/.gemini/config/skills), не в проект: в репозитории нет копий, которые надо коммитить и держать в версии, а treeyard-init нужен и там, где дерева ещё нет. Копии, которые проект уже держит (.claude/skills, .agents/skills), обновляются, но не заводятся. Сделано (ac0244d): autoInstallSkills (src/agents/skills.ts) на init, запуске treeyard и любой команде в папке с деревом; status, skills и config ничего не пишут; ставит все три скилла папкой, подменяет атомарно; ссылку и папку без прав на запись не трогает; Antigravity — только по его папкам в ~/.gemini; о записи говорит строкой (в TUI — подсказкой); проверка стоит 0,7 мс. Настройка skills: treeyard config skills off|on, строка «Скиллы в CLI» в «,»; TREEYARD_SKILLS=off — на один запуск, в тестах. treeyard status и skills показывают, где стоят, и строку «ставятся и обновляются сами… / сами не ставятся». Справочник ru/en. Доказательства: npm test 720/720 (test/skills-auto.test.ts: init ставит во все три CLI, любая команда обновляет устаревший, status не пишет, skills off не ставит, ссылка цела, Gemini CLI ≠ Antigravity), typecheck, lint, build. Живая проверка на этой машине (скиллы в резерве): убрал 9 папок → treeyard init во временной папке → «скиллы treeyard 0.1.1 — в Claude Code, Codex, Antigravity», копии побайтно как в резерве. В папке с одним .tree/ обычные сессии: Claude Code 2.1.330 — init.skills [treeyard, treeyard-coordinate, treeyard-init], цитирует правило 2; Codex 0.170 — три скилла из ~/.codex/skills/…/SKILL.md, правило 2; Antigravity 1.5.14 — три скилла из ~/.gemini/config/skills/…, правило 2. Устаревшая копия в ~/.claude: status — «устарел», treeyard show — «в Claude Code», копия снова как выпущенная; в TUI (tmux, отдельный сокет) — подсказка «скиллы treeyard 0.1.1 — в Codex…». Снимок настроек — 001.png. Осталось: ничего.
- 2026-11-22 12:46 · агент · в работе → на проверке
