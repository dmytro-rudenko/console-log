---
branch: worktree-subagents
spec: docs/sdd/specs/2026-10-22-subagent-transcripts.md
plan: -
status: in-progress
started: 2026-10-22
---

## Goal
Панель console-log показує текст сесій субагентів (поряд із фоновими Bash/Monitor задачами) і дає перемикатися між ними.
Готово, коли субагенти з'являються як вкладки, їхній транскрипт видно в панелі, а перемикання працює тими самими клавішами.

## Now
Shaping, architectural. Дизайн погоджено (3 секції): підхід A — хук `agent.spawn` + опитування `$.agent.list()`, текст вибраного агента з `$.session.messages({ agentId })` → `agentLines()` у `hooks/transcript.ts`; `kind: 'agent'` у тому ж Board; усі субагенти; ✓ зникає за 10 с; текст + тули + 3 рядки результату; `syncAgents()` у tasks.ts; версія 0.2.0.
Прототип підписано: варіант A (`docs/sdd/proto/subagent-tab/decision.md`).
Spec написано й закомічено, draft PR відкрито. Чекаємо, поки користувач перегляне spec.
Далі: після схвалення — leonard (план).
Не чіпати: фільтр `e.agentId !== undefined` для Bash/Monitor у tool.call.

## Timeline

### 2026-10-22
- 13:30 ✎ Shaping: класифіковано architectural; знайдено API рушія для транскриптів агентів (session.messages agentId, ui.view)
- 13:40 ✎ Дизайн погоджено: agent.spawn + poll agent.list, session.messages → agentLines (текст, тули, 3 рядки результату), ✓ зникає за 10 с
- 13:48 ▶ start · worktree-subagents @ bf82a4f
- 13:49 ✎ Прототип підписано: варіант A (log) — текст, → Tool: arg, 3 рядки результату; B і C відкинуто
- 13:49 ● 5191347 docs(proto): subagent transcript tab prototype, variant A chosen
- 13:50 ✎ Spec написано: OutLine з tone замість кольору з префікса; syncAgents, agentLines, версія 0.2.0
