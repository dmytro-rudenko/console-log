---
branch: worktree-switcher
spec: docs/sdd/specs/2026-10-23-follow-view.md
plan: docs/sdd/plans/2026-10-23-follow-view.md
status: in-progress
started: 2026-10-23
---

## Goal
Панель console-log показує output агента, якого відкрито стандартним списком задач Claude Code під промптом (`e.props.view.agentId`), замість власного рядка вкладок над output.
Готово, коли перемикання агента внизу перемикає вміст панелі, а специфікацію узгоджено й реалізовано.

## Now
Специфікацію написано (docs/sdd/specs/2026-10-23-follow-view.md), draft PR відкрито. Без вкладок: автослідування найновішої працюючої задачі, агент з `e.props.view` має пріоритет, `sweep` через 10 с, панель закривається сама. Основне вікно утримати на main неможливо — прийнято. Хвилі 0 і 1 закриті (f330e40, ce6910a, 27325f7, 7001f55, фікси 6a6638d, 2fd37de). Хвиля 2 (Task 3, register.tsx) у роботі з рішенням A: view — змінна модуля, рендер відкладає refresh через clock.after(0), бо $.state.set заборонено в ui.render. Далі: `claude plugin test .` → 0 fail, tsc, рецензія хвилі 2, фінальна рецензія гілки й security-review.

## Timeline

### 2026-10-23
- 12:17 ✎ Shaping: класифіковано як architectural; API дає Pane лише view.agentId відкритого агента, не підсвічування у списку
- 12:17 ● 6b542ec feat(console-log): sync agent tab status from the agent list
- 12:17 ● 2e29350 chore(release): 0.2.0 with subagent transcripts documented
- 12:17 ● f51a4c6 chore(plan): close wave 2
- 12:17 ● 076840c feat(console-log): subagent tabs with live transcripts in the pane
- 12:17 ● 1e7d64e chore(plan): close wave 3
- 12:17 ● 06acb39 fix(console-log): guarded delayed drops and upgrade-safe pane lines
- 12:17 ● 1eeddda chore(journal): close subagent transcripts
- 12:17 ● 6ae4792 Merge pull request #4 from dmytro-rudenko/worktree-subagents
- 12:17 ● 1bc36a2 fix(console-log): tab for subagents already running when the mod loads
- 12:17 ● cf6f307 Merge pull request #5 from dmytro-rudenko/fix/adopt-running-subagents
- 12:46 ✎ Перевірено в бандлі 2.1.309: перемикання у списку задач внизу не проходить через хук ui.view; $.ui.view({}) з рендера відхиляється як not person-initiated
- 12:56 ✎ Специфікація follow-view: без вкладок, pick(board, view) + sweep(endedAt), процеси вручну не вибираються
- 12:56 ● c990608 docs(spec): console-log pane follows the newest task and the agent opened below
- 13:02 ● 6e32ebf docs(plan): console-log follow-view implementation plan
- 13:02 ✎ План: 5 задач у 3 хвилях; tsc і pane-тести зелені лише після хвилі 2
- 13:04 ● f330e40 test(console-log): acceptance tests for a pane that follows the newest task and the agent in view
- 13:06 ● ce6910a feat(console-log): pick the task to show and sweep finished ones by endedAt
- 13:06 ● 27325f7 feat(console-log): one head line instead of the tab row in the layout helpers
- 13:06 ● 7001f55 docs(console-log): describe the follow-the-newest pane and bump to 0.3.0
- 13:12 ● 6a6638d docs(console-log): say the pane shows one task and keeps the last finished one
- 13:13 ● 2fd37de fix(console-log): pin legacy tasks without endedAt and drop unused state
