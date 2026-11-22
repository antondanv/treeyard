---
id: ecqh
title: Падение без мусора в терминале
parent: 9xem
order: 80
status: review
who: agent
done_when: "При необработанной ошибке, SIGTERM и SIGHUP treeyard возвращает терминал: выключает мышь и фокус, включает перенос строк, уходит с альтернативного экрана, отдаёт обычный ввод; ошибка с версией treeyard пишется в файл, человек видит путь к нему и куда сообщить; проверено тестом и вживую; typecheck, тесты, lint и build проходят"
commits:
  - 24f71f49d341d211fc63f1e710306c4733adb6d0
sessions:
  - brain: claude
    id: 16e53526-cefb-435d-ba16-720e0ffb128c
    name: Treeyard · Падение без мусора в терминале
    started: 2026-11-22T13:25:37+03:00
    opened: 2026-11-22T13:25:37+03:00
    mode: pane
    pane: claude-feec13a2
created: 2026-11-16
updated: 2026-11-22T13:38:33+03:00
---

Человек 16.11.2026 — в релиз 0.2.0. Сейчас режимы мыши, фокуса и переноса возвращаются только в finally (src/tui/run.tsx), обработчиков uncaughtException/SIGTERM/SIGHUP нет, лога падения нет.

## Журнал

- 2026-11-16 00:42 · агент · завёл узел
- 2026-11-22 13:25 · claude · новая сессия в панели (do)
- 2026-11-22 13:25 · claude · к работе → в работе
- 2026-11-22 13:38 · агент · привязан коммит 24f71f49d341d211fc63f1e710306c4733adb6d0
- 2026-11-22 13:38 · агент · Терминал возвращается при падении (src/crash.ts; TUI держит терминал через holdTerminal в src/tui/run.tsx и init.tsx; guardCrashes в run() в src/cli/commands.ts). uncaughtException/unhandledRejection, SIGTERM, SIGHUP (и SIGINT от kill): Ink размонтируется, мышь (1000/1002/1006), фокус (1004) и bracketed paste выключены, альтернативный экран → обычный, перенос (?7h) и курсор включены, raw mode снят; сигнал → код 128+n. Ошибка → ~/.treeyard/crashes/<время>-<pid>.log (версия treeyard, node, ОС, команда, cwd, стек с cause; хранятся последние 20), в терминале: «✗ treeyard 0.1.1 упал: …», путь к файлу и https://github.com/antondanv/treeyard/issues. EPIPE — тихий выход 0 без лога. uninstall --settings забирает и журналы падений; справочник на двух языках — раздел «Если treeyard упал». Проверки: test/crash.test.ts (9) и test/crash-tmux.test.ts (SIGTERM/SIGHUP/ошибка в настоящем tmux: флаги alternate/mouse/sgr/wrap/cursor 1 1 1 0 0 → 0 0 0 1 1, exit 143/129/1, stty icanon, в сыром выводе каждый режим выключен после последнего включения; без обработчиков тест падает: 0 1 1 0 1). Вживую: dist на копии дерева в tmux на отдельном сокете, английский интерфейс — то же самое, после сообщения терминалу приходит только ?25h; show --all | head -1 → exit 0, лога нет. typecheck, lint, build — ок; npm test — 82 файла, 745 тестов прошли. Осталось: ничего; EPIPE заодно закрыт и для узла «Тихий выход на EPIPE».
- 2026-11-22 13:38 · агент · в работе → на проверке
