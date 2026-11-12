---
id: a4rb
title: Stdin из медленного пайпа
parent: y5ss
order: 30
status: idea
created: 2026-11-12
updated: 2026-11-12T14:55:31+03:00
---

add --from-json - и open --task - читают stdin через readFileSync(0): если пишущий ещё не успел записать (медленный пайп, программа-родитель), команда падает с «✗ EAGAIN: resource temporarily unavailable, read». Повтор: (sleep 1; echo '[{"title":"проба"}]') | treeyard add --from-json - --parent <id>. В rules --from - это уже решено потоковым чтением (textFrom в src/cli/commands.ts) — перевести на него и эти две команды, с тестом на поздний stdin как в test/root-doc.test.ts.

## Журнал

- 2026-11-12 14:55 · агент · завёл узел
