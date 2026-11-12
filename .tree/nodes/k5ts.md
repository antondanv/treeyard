---
id: k5ts
title: Скиллы ставятся сами
parent: h6kw
order: 30
status: todo
who: agent
done_when: "В папке с деревом основные скиллы treeyard доступны агенту в любой сессии без ручного treeyard skills install: ставятся при init и запуске treeyard, обновляются с новой версией, выключаются настройкой; treeyard status показывает, где они стоят; проверено в Claude Code, Codex и Antigravity"
created: 2026-11-08
updated: 2026-11-08T21:15:52+03:00
---

Человек 08.11.2026: есть дерево в проекте — есть и основные скиллы, автоматически. Куда ставить — в личные папки CLI или в папку проекта — решить в узле.

## Журнал

- 2026-11-08 12:20 · агент · завёл узел
- 2026-11-08 12:45 · агент · Из проверки скилла treeyard 08.11: без установки в ~ скилл берётся из папки проекта — Claude Code 2.1.319 читает .claude/skills/<имя>/SKILL.md, Codex 0.166 — .agents/skills/<имя>/SKILL.md (в бинаре Codex есть только .agents/skills). Так скилл и проверялся на копии дерева: оба CLI подхватили его сами.
- 2026-11-08 13:34 · агент · У скилла treeyard теперь есть папка references/ (other-projects.md, tree-order.md): ставить нужно папку скилла целиком, а не один SKILL.md, как installSkill делает для treeyard-init.
- 2026-11-08 21:15 · агент · Из узла «treeyard status: сводка по проекту» (коммит 549084e): treeyard status уже показывает скиллы treeyard и treeyard-init по CLI — стоит, устарел (файл отличается от поставленного с версией), не стоит, нет CLI — и где стоят: дом CLI (~/.claude/skills, ~/.codex/skills, ~/.gemini/config/skills) и папка проекта (.claude/skills; .agents/skills — Codex и Antigravity, проверено по строкам бинарей codex 0.166 и agy 1.5.3). treeyard skills install теперь ставит оба скилла папками целиком (с references/), свежие копии не трогает, копии в проекте обновляет, но не заводит — src/agents/skills.ts. Автоустановка при init и запуске, обновление с версией и настройка — за этим узлом.
