---
branch: worktree-subagents
spec: docs/sdd/specs/2026-10-22-subagent-transcripts.md
plan: docs/sdd/plans/2026-10-22-subagent-transcripts.md
status: in-progress
started: 2026-10-22
---

## Goal
Панель console-log показує текст сесій субагентів (поряд із фоновими Bash/Monitor задачами) і дає перемикатися між ними.
Готово, коли субагенти з'являються як вкладки, їхній транскрипт видно в панелі, а перемикання працює тими самими клавішами.

## Now
Building (wolowitz), PR #4. Хвилі 0–2 закриті (`3d18eda`, `0a53f2e`, `606f983`, `6b542ec`, `2e29350`): 50 pass, 4 acceptance-тести червоні навмисно, tsc 0.
Далі: хвиля 3 — задача 4, `hooks/register.tsx` + `types/index.d.ts` (lines: OutLine[]); має зробити всі 4 acceptance-тести зеленими: `claude plugin test .` → 0 fail. Потім Finish: whole-branch review, security-review, журнал, gh pr ready.
Типи рушія для tsc скопійовано в `.claude-plugin/types` (gitignored).
Не чіпати: фільтр `e.agentId !== undefined` для Bash/Monitor у tool.call.

## Timeline

### 2026-10-22
- 13:30 ✎ Shaping: класифіковано architectural; знайдено API рушія для транскриптів агентів (session.messages agentId, ui.view)
- 13:40 ✎ Дизайн погоджено: agent.spawn + poll agent.list, session.messages → agentLines (текст, тули, 3 рядки результату), ✓ зникає за 10 с
- 13:48 ▶ start · worktree-subagents @ bf82a4f
- 13:49 ✎ Прототип підписано: варіант A (log) — текст, → Tool: arg, 3 рядки результату; B і C відкинуто
- 13:49 ● 5191347 docs(proto): subagent transcript tab prototype, variant A chosen
- 13:50 ✎ Spec написано: OutLine з tone замість кольору з префікса; syncAgents, agentLines, версія 0.2.0
- 13:50 ● 95ca492 docs(spec): subagent transcripts in the console-log pane
- 14:00 ● cd254be docs(plan): subagent transcripts implementation plan
- 14:00 ✎ План схвалено: 6 задач, 4 хвилі; agent.spawn без .catch, щоб не спавнити двічі
- 14:07 ● 3d18eda test(console-log): acceptance tests for subagent transcript tabs
- 14:08 ✎ Хвиля 0: acceptance-тести червоні з правильної причини; мок session.messages прив'язано до agentId
- 14:08 ● b08e212 chore(plan): close wave 0
- 14:08 ● 0a53f2e feat(types): agent task kind and toned output lines
- 14:08 ✎ Хвиля 1: типи agent/OutLine додано, lines лишено string[] до хвилі 3 — tsc зелений
- 14:08 ● 3b9bbed chore(plan): close wave 1
- 14:13 ● 606f983 feat(console-log): render an agent transcript as toned lines
- 14:13 ● 6b542ec feat(console-log): sync agent tab status from the agent list
- 14:13 ● 2e29350 chore(release): 0.2.0 with subagent transcripts documented
- 14:14 ✎ Хвиля 2: agentLines/syncAgents/0.2.0; аргумент тулу — лише перший рядок; агент поза списком = killed (рішення spec)
