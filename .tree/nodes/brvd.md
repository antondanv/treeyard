---
id: brvd
title: "README в npm: ссылки и картинки — в репозиторий (forNpm, как в Brainyard)"
parent: b2qk
order: 160
status: idea
created: 2026-10-06
updated: 2026-11-08T12:09:17+03:00
---

На npmjs.com относительные ссылки README (README.ru.md, docs/*.png, docs/practice.md, skills/…) никуда не ведут. В Brainyard это решает scripts/package-files.mjs (forNpm): в prepack переписывает ссылки на github.com/…/blob/v<версия> и raw.githubusercontent.com. Ещё: в package.json нет repository.

## Журнал

- 2026-10-06 21:25 · агент · завёл узел
