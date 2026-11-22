---
id: ufn3
title: treeyard status в скилле treeyard
parent: vkxh
order: 20
status: review
done_when: "Скилл treeyard называет treeyard status: в списке команд, как сверку настройки (скиллы, хук, указатель; у каждой проблемы — команда) и в разделе о git worktree — как источник основной папки для --project; контекст узла — строкой в «Командах дерева» на RU и EN, с тестом; typecheck, тесты, lint, build; прогон node scripts/skill-evals.mjs run haiku@low gpt-6-luna@low — таблица нарушений в журнале"
commits:
  - ace4c1ececee302679392a44dd897124ee6910ba
sessions:
  - brain: claude
    id: 80dc832e-49cd-414f-a714-9df4bace771b
    name: Treeyard · treeyard status в скилле treeyard
    started: 2026-11-22T11:00:12+03:00
    opened: 2026-11-22T11:00:12+03:00
    mode: pane
    pane: claude-1b5a0d94
created: 2026-11-08
updated: 2026-11-22T11:07:50+03:00
---

Скилл treeyard и контекст узла пока не упоминают treeyard status: агент в git worktree мог бы взять из него основную папку для --project, а при сомнениях в настройке (скиллы, хук, указатель) — свериться одной командой. Правка скилла — с прогоном test/skill-evals.

## Журнал

- 2026-11-08 21:15 · агент · завёл узел
- 2026-11-22 11:00 · claude · новая сессия в панели (do)
- 2026-11-22 11:00 · claude · идея → в работе
- 2026-11-22 11:03 · агент · привязан коммит ace4c1ececee302679392a44dd897124ee6910ba
- 2026-11-22 11:07 · агент · Сделано (коммит ace4c1e): скилл treeyard называет treeyard status — в «Read the tree» (папка и дерево, узлы, скиллы по CLI, указатель, git-хук, сессии; у каждой проблемы — команда; из git worktree — основное дерево и --project; запускать, когда настройка выглядит странно, вместо перебора файлов), в списке «Commands», в «Commits» вместо treeyard hook status; references/other-projects.md, раздел Git worktrees — status как источник основной папки для --project. Контекст узла: строка treeyard status в «Командах дерева» на RU и EN (src/agents/context.ts), тест в test/context-rules.test.ts. Проверки: typecheck ok; npm test — 75 файлов, 703 теста ok; lint ok; build ok; npm run dev -- context ufn3 — строка на месте после image. Прогон node scripts/skill-evals.mjs run haiku@low gpt-6-luna@low (6 запросов на модель): haiku@low — пайпы 4, id в ответе 2, чужой проект без узла 1, скилл не загружен 2, длинное название 1, ожидания 14/18; gpt-6-luna@low — нарушений нет, ожидания 17/18 (в fix-in-another-project нет нового коммита в tipcalc). Нарушения haiku — пайпы на --help и show, id, скилл до первого вызова; с status не связаны; status ни одна модель не вызвала — сценариев с worktree и сломанной настройкой нет (идея «Сценарий скилла из git worktree»). Осталось человеку: скилл в ~/.claude, ~/.codex, ~/.gemini устарел — treeyard skills install.
- 2026-11-22 11:07 · агент · в работе → на проверке
