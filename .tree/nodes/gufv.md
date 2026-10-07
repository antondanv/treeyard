---
id: gufv
title: Режим запуска «просто открыть» (--start chat) у Codex, Antigravity и OpenCode шлёт инструкции treeyard первым сообщением — в панели стена текста, хотя режим обещает без первого сообщения (у Claude это системный промпт)
parent: 5w6w
order: 210
status: todo
done_when: "treeyard open <id> --brain codex|antigravity|opencode --start chat: в панели нет первого сообщения — инструкции уходят как системные (или, где слота нет, это сказано в README)"
needs:
  - ../Brainyard#rsen
created: 2026-10-06
updated: 2026-10-07T09:59:01+03:00
---

Откуда: Treeyard › «Сделать видео с Motion Design с красивой презентацией работы триярда» (6vy3)

## Журнал

- 2026-10-06 17:16 · агент · завёл узел
- 2026-10-07 09:49 · агент · идея → к работе
- 2026-10-07 09:49 · агент · Разбор: подтвердилось — в режиме chat Treeyard шлёт только system; Brainyard у Claude кладёт его в --append-system-prompt, а у Codex, Antigravity и OpenCode склеивает с prompt в первое сообщение (open.ts:182, 202, 227). Правка в Brainyard: у Codex, возможно, -c developer_instructions, у OpenCode — OPENCODE_CONFIG_CONTENT (как в ask), у Antigravity слота не нашли. Узел там заведён.
- 2026-10-07 09:59 · агент · ждёт: Brainyard › «Режим chat у Codex, Antigravity и OpenCode: system не первым сообщением — Codex через developer_instructions, OpenCode через OPENCODE_CONFIG_CONTENT; у Antigravity — выяснить, есть ли слот» (rsen)
