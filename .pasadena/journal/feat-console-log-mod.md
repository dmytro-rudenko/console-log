---
branch: feat/console-log-mod
spec: docs/sdd/specs/2026-10-20-console-log-mod.md
plan: docs/sdd/plans/2026-10-20-console-log-mod.md
status: in-progress
started: 2026-10-20
---

## Goal
Постійний Claude Code мод `console-log`: панель поруч із чатом з останніми 200 рядками виводу фонових Bash-задач, з живим оновленням.
Готово, коли мод встановлюється з цього репозиторію, показує вивід задачі наживо, прокручується до кінця і зупиняє опитування після завершення задачі.

## Now
1. Building: хвиля 1/4 закрита — Tasks 1,2,3,7 (4c8e082 1e438c5 9cc76ed a381212), 12 тестів зелені в harness.
2. Ruling: `claude plugin test .` неможливий до Task 6 (немає register.tsx) — тести хвиль 1–2 у тимчасовому harness із заглушкою register.tsx. Для Task 6: нормалізувати пробіли в command ДО sanitize (sanitize склеює переноси рядків).
3. Далі: хвиля 2 — Tasks 4 (hooks/tasks.ts) і 5 (hooks/layout.ts) паралельно, перевірка тим самим harness.

## Timeline

### 2026-10-20
- 17:06 ✎ Spike: панель мода з tail -200 по tasks/<id>.output працює; починаємо shaping постійного мода console-log
- 17:35 ▶ start · feat/console-log-mod @ 764cf63
- 17:49 ✎ Прототип підписано: варіант A; розмір з bodyColumns/bodyRows, HUD-палітра, лише ctrl+→/ctrl+←, вихід у промпт через exit-кнопку + close/open, ✓ зникає за 10 с, ✗ до перегляду
- 17:49 ● a6e2340 docs(proto): console-log pane prototype and decision
- 17:51 ● 975d84e docs(spec): console-log background output pane
- 17:51 ✎ Специфікацію написано й закомічено: docs/sdd/specs/2026-10-20-console-log-mod.md
- 17:51 ● 67a04bb chore(journal): point at console-log spec
- 17:53 ● 4890214 docs(proto): console-log pane prototype and decision
- 17:53 ● 09c1362 docs(spec): console-log background output pane
- 17:53 ● 2a5ac26 chore(journal): start console-log mod journal
- 17:54 ✎ Публічний репо створено, draft PR #1; скріншоти прибрано з історії до пушу; у спеку додано повну sanitize після security review
- 17:54 ● d76c646 chore(journal): shaping done, draft PR open
- 18:01 ✎ План схвалено: 8 задач у 4 хвилях; чисті модулі (notification/sanitize/tasks/layout) окремо від register.tsx — prompt.submit не тестується kit-ом, тому логіка винесена в чисті функції
- 18:02 ● ce4ded3 docs(plan): console-log implementation plan
- 18:11 ● 4c8e082 chore(plugin): manifests, marketplace and state contract
- 18:11 ● 1e438c5 feat(notification): parse background task notifications
- 18:11 ● 9cc76ed feat(sanitize): strip terminal control sequences from output
- 18:11 ● a381212 docs(readme): install, keys and behaviour
- 18:11 ✎ Хвиля 1: exit code лише з кінця <summary>; sanitize прибирає й nF/Fp/Fs escapes (\x1b(B); обрізаний escape на межі шматка лишає друковний хвіст — прийнято
- 18:11 ● cb6d218 chore(plan): close wave 1
