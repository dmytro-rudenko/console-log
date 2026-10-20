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
1. Building (wolowitz). План docs/sdd/plans/2026-10-20-console-log-mod.md схвалено: 8 задач, хвилі 1:{1,2,3,7} 2:{4,5} 3:{6} 4:{8 smoke}.
2. Ще нічого не реалізовано.
3. Далі: хвиля 1. Перевірка кожної задачі — `claude plugin test .`; type-check командою з Global constraints. Зберегти: без коментарів у коді; скріншоти не комітити.

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
