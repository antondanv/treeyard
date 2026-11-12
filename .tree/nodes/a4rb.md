---
id: a4rb
title: Stdin из медленного пайпа
parent: y5ss
order: 30
status: review
done_when: "add --from-json -, import --from-json - и --task - (open, context) читают stdin потоком: (sleep 1; echo '[{\"title\":\"проба\"}]') | treeyard add --from-json - --parent <id> сажает узел без EAGAIN, так же context <id> --task -; тесты на поздний stdin для add и --task; readFileSync(0) в src/ не осталось; typecheck, test, lint, build зелёные"
commits:
  - 9e6a34336cebbebebf133358a74807aa8d3f6929
sessions:
  - brain: claude
    id: a991d31b-7d22-4df0-83d0-af5b649f30e8
    name: Treeyard · Stdin из медленного пайпа
    started: 2026-11-12T15:10:54+03:00
    opened: 2026-11-12T15:10:54+03:00
    mode: pane
    pane: claude-f8279855
created: 2026-11-12
updated: 2026-11-12T15:16:24+03:00
---

add --from-json - и open --task - читают stdin через readFileSync(0): если пишущий ещё не успел записать (медленный пайп, программа-родитель), команда падает с «✗ EAGAIN: resource temporarily unavailable, read». Повтор: (sleep 1; echo '[{"title":"проба"}]') | treeyard add --from-json - --parent <id>. В rules --from - это уже решено потоковым чтением (textFrom в src/cli/commands.ts) — перевести на него и эти две команды, с тестом на поздний stdin как в test/root-doc.test.ts.

## Журнал

- 2026-11-12 14:55 · агент · завёл узел
- 2026-11-12 15:10 · claude · новая сессия в панели (do)
- 2026-11-12 15:10 · claude · идея → в работе
- 2026-11-12 15:16 · агент · привязан коммит 9e6a34336cebbebebf133358a74807aa8d3f6929
- 2026-11-12 15:16 · агент · add --from-json -, import --from-json - и --task - (open, context) читают stdin потоком через textFrom, как rules --from (src/cli/commands.ts); withStdin переехал в test/helpers.ts, новые тесты на поздний stdin: test/add-batch.test.ts и test/coordinator.test.ts. Доказательства: до правки (sleep 1; echo '[{"title":"проба"}]') | treeyard add --from-json - --parent a4rb → «✗ EAGAIN», exit=1 (и у context --task -); после, на копии дерева через dist: add → «wrxa  проба», exit=0; context a4rb --task - → «Задание к узлу: задание из медленного пайпа», exit=0; import --from-json - --dry-run → exit=0. grep 'readFileSync(0,' src → пусто. typecheck, lint, build чистые; npm test — 65 файлов, 596/596. Попутно: идея «Импорт команд в тесте запускает CLI». Осталось: ничего.
- 2026-11-12 15:16 · агент · в работе → на проверке
