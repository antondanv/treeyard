---
id: usp3
title: Лицензия Apache 2.0
parent: 9xem
order: 280
status: done
done_when: LICENSE — канонический текст Apache 2.0, NOTICE с правообладателем уходит в npm; package.json license=Apache-2.0; README на обоих языках и CONTRIBUTING на обоих языках говорят Apache 2.0
commits:
  - 085c2fa848a9aca303c32f8a1bd956c5e43b7ecc
created: 2026-11-26
updated: 2026-11-26T10:27:51+03:00
closed: 2026-11-26
---

Просьба человека 26.11: сменить лицензию с MIT на Apache 2.0. Автор коммитов один — менять можно; уже вышедшие 0.1.x остаются под MIT.

## Журнал

- 2026-11-26 09:32 · агент · завёл узел
- 2026-11-26 09:32 · агент · привязан коммит 975da9442ff5f8fc8cfa286cbf72968cefdaabec
- 2026-11-26 09:32 · агент · LICENSE — канонический текст Apache 2.0 (11357 байт, как на apache.org), NOTICE «Treeyard / Copyright 2026 Anton Danilov» добавлен в files пакета; package.json и package-lock: license=Apache-2.0; бейдж и раздел «Лицензия» в README.md и README.ru.md, раздел лицензии в CONTRIBUTING на обоих языках. В заметки к выпуску не пишем — по слову человека 26.11 там только новые возможности. Автор всех коммитов один (git shortlog). Проверки: npm pack --dry-run — LICENSE 11.4kB и NOTICE в пакете; test/npm-readme 2/2. Осталось: ничего.
- 2026-11-26 09:32 · агент · к работе → на проверке
- 2026-11-26 09:33 · агент · привязан коммит 085c2fa848a9aca303c32f8a1bd956c5e43b7ecc
- 2026-11-26 09:33 · агент · убрана привязка коммита 975da9442ff5f8fc8cfa286cbf72968cefdaabec
- 2026-11-26 10:27 · ты · на проверке → готово
