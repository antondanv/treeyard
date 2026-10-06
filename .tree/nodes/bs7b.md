---
id: bs7b
title: "Brainyard 0.2: BrainId включает opencode — подписи, выбор агента, панели, статус"
parent: q8r9
order: 20
status: done
who: agent
for:
  - ../Brainyard#5pax
created: 2026-10-04
updated: 2026-10-04T18:19:07+03:00
closed: 2026-10-04
---

Откуда: Brainyard › «OpenCode — четвёртый CLI: status, models, ask/run, open, sessions, панели, использование» (5pax)

В Brainyard 0.2 (ветка feat/opencode → release/0.2.0) BrainId = 'claude' | 'codex' | 'antigravity' | 'opencode', status() и sessions() отдают и OpenCode, PaneInfo.brain может быть 'opencode'. У Treeyard свой BrainId из трёх (src/model/types.ts), списки ['claude','codex','antigravity'] (src/tui/App.tsx, src/tui/init.tsx) и BRAIN_LABEL: после перехода на 0.2 упадёт typecheck там, где значения Brainyard кладутся в BrainId Treeyard, а подпись для opencode будет пустой. Нужно: принять opencode (подпись OpenCode, выбор агента, панели) или явно отсечь.

## Журнал

- 2026-10-04 17:37 · агент · завёл узел
- 2026-10-04 17:37 · агент · нужен для: Brainyard › «OpenCode — четвёртый CLI: status, models, ask/run, open, sessions, панели, использование» (5pax)
- 2026-10-04 17:57 · ты · к работе → готово. закрыт вместе с Brainyard › «OpenCode — четвёртый CLI: status, models, ask/run, open, sessions, панели, использование» (5pax)
- 2026-10-04 18:02 · агент · готово → ждёт: Treeyard ещё на Brainyard из ../Brainyard (старая раскладка, без OpenCode): BRAINS.opencode и BrainId с opencode ему недоступны
- 2026-10-04 18:19 · ты · ждёт → готово. закрыт вместе с Brainyard › «OpenCode — четвёртый CLI: status, models, ask/run, open, sessions, панели, использование» (5pax)
