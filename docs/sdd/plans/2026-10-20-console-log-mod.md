# console-log — implementation plan

**Goal:** у корені репозиторію `dmytro-rudenko/console-log` лежить робочий Claude Code мод `console-log`:
- панель поруч із чатом із вкладками фонових Bash/Monitor-задач і останніми 200 рядками виводу вибраної;
- життєвий цикл ✓/✗, керування лише `ctrl+→` / `ctrl+←`, команда `/console-log`;
- README з установкою.

**Spec:** docs/sdd/specs/2026-10-20-console-log-mod.md
**Prototype:** docs/sdd/proto/console-log-pane/decision.md (код: `docs/sdd/proto/console-log-pane/v2-final/register.tsx`)
**Verification:** з кореня worktree:
- `claude plugin validate .` → остання рядок `✔ Validation passed` (warning про `author` неприйнятний — author заданий);
- `claude plugin test .` → усі тести pass, 0 failed;
- type-check (див. Global constraints) → без виводу.

## Context

Людина не бачить вивід фонових задач Claude Code. Spike і прототип довели, що мод-панель із `tail -n 200` по `tasks/<id>.output`, статусом із `prompt.submit` (`task-notification`) і вкладками працює. Прототип підписано (варіант A). Цей план переносить його в чистий, протестований плагін.

## Waves
| Wave | Tasks | Why together |
|---|---|---|
| 1 | 1, 2, 3, 7 | disjoint: маніфести+контракт / notification.ts / sanitize.ts / README.md |
| 2 | 4, 5 | обидва читають `types/index.d.ts` з Task 1; файли не перетинаються |
| 3 | 6 | `hooks/register.tsx` споживає все з Tasks 2–5 |
| 4 | 8 | smoke у живій сесії потребує готового мода |

Серіалізовано: Task 6 після 2–5 — бо імпортує їхні експорти; Task 8 після 6 — бо вантажить мод цілком.

## Global constraints

- Корінь worktree: `/home/pc/projects/console-log/.claude/worktrees/console-log-mod`, гілка `feat/console-log-mod`. Корінь репо = корінь плагіна.
- **Жодних коментарів у коді**, окрім обмежень, яких код не показує (правило користувача; не наслідувати прототип).
- Модуль — ES module без Node/DOM; все зовнішнє — через `$`. JSX компілюється проти глобального `h`; елементи — `const { Box, Text, Button } = $.ui.resolve(e)`.
- Правила `claude plugin validate`: `$` передається лише у функції, оголошені на верхньому рівні файлу (function declaration); ідентифікатор `on` не можна перевизначати (жодного `const on = …`); `$` завжди `$.noun.method(...)`.
- Плагін-ідентифікатор і id панелі: `console-log`. Заголовок панелі: `Background output`. `columns: 100`.
- Константи: `LINES = 200`, `LINE_MAX = 500`, `POLL_MS = 1000`, `TAIL_TIMEOUT_MS = 2000`, `DROP_COMPLETED_MS = 10000`, `MAX_TASKS = 20`, `LABEL_MAX = 22`.
- Палітра: рамки `gray`, заголовки `cyan` + `bold`, підписи `dimColor`; `◐` `yellow` (running), `✓` `green` (completed), `✗` `red` (failed), `■` `gray` (інше); корінь `backgroundColor="black"`.
- Розміри — лише з `e.props.bodyColumns` (W) і `e.props.scroll.bodyRows` (R), ніколи з `e.viewport`.
- Type-check (немає `.claude-plugin/types`, поки engine не вантажив мод):
  ```bash
  T=$(ls -t /tmp/claude-1000/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts | head -1)
  S=$(mktemp -d); cat > $S/tsconfig.json <<EOF
  { "compilerOptions": { "target": "es2023", "lib": ["es2023"], "types": [], "module": "esnext", "moduleResolution": "bundler", "strict": true, "noUncheckedIndexedAccess": true, "noEmit": true, "skipLibCheck": true, "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment" },
    "include": ["$T", "$PWD/hooks", "$PWD/types"] }
  EOF
  npx -y -p typescript@5.6.3 tsc -p $S; rm -rf $S
  ```
  Очікувано: без виводу. Тести (`*.test.ts(x)`) імпортують `claude-code/testing` — він оголошений у тому ж `claude-code.d.ts`.
- Тести: `import { expect, mock, test } from 'claude-code/testing'`; запуск `claude plugin test .`. Для перевірки, що тест падає, достатньо запустити до появи модуля, який він імпортує (помилка імпорту = fail).
- Коміти: Conventional Commits, без `Co-Authored-By` і без «Generated with Claude Code».

---

### Task 1: маніфести, контракт стану, tsconfig

**Writes:** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `types/index.d.ts`, `tsconfig.json`, `.gitignore`
**Reads:** docs/sdd/specs/2026-10-20-console-log-mod.md §3.1–3.2
**Depends on:** —
**Interfaces:**
- Produces: типи `ConsoleTask`, `Board`, `TaskNotification` з `../types`; `PluginState['console-log']` з ключами `tasks`, `selected`, `lines`, `pathMissing`, `readFailed`, `dismissed`, `hasCtrlArrows`.

- [x] **Step 1: write** `.claude-plugin/plugin.json`:
```json
{
  "name": "console-log",
  "version": "0.1.0",
  "description": "Live pane beside the chat with the last 200 lines of background Bash and Monitor tasks",
  "author": { "name": "dmytro-rudenko" },
  "repository": "https://github.com/dmytro-rudenko/console-log",
  "license": "MIT",
  "types": "./types/index.d.ts"
}
```
- [x] **Step 2: write** `.claude-plugin/marketplace.json`:
```json
{
  "name": "console-log",
  "owner": { "name": "dmytro-rudenko" },
  "plugins": [{ "name": "console-log", "source": "./" }]
}
```
- [x] **Step 3: write** `hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`
- [x] **Step 4: write** `types/index.d.ts`:
```ts
export type ConsoleTask = {
  id: string
  kind: 'shell' | 'monitor'
  command: string
  label?: string
  path?: string
  startedAt: number
  status?: string
  exitCode?: number
  viewed?: boolean
}

export type Board = { tasks: ConsoleTask[]; selected: number }

export type TaskNotification = { id: string; status: string; exitCode?: number }

declare module 'claude-code' {
  interface PluginState {
    'console-log': {
      tasks: ConsoleTask[]
      selected: number
      lines: string[]
      pathMissing: boolean
      readFailed: boolean
      dismissed: boolean
      hasCtrlArrows: boolean
    }
  }
}
```
- [x] **Step 5: write** `tsconfig.json` (для редактора після того, як engine покладе типи):
```json
{
  "extends": "./.claude-plugin/types/tsconfig.json",
  "compilerOptions": { "jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment" },
  "include": [".claude-plugin/types", "hooks", "types"]
}
```
- [x] **Step 6: write** `.gitignore`:
```
.claude-plugin/types/
node_modules/
*.log
```
- [x] **Step 7: run** `claude plugin validate .` — очікувано помилка лише про відсутній `hooks/register.tsx` (модуль з'явиться в Task 6). JSON-файли мають читатися без помилок.
- [x] **Step 8: commit** `chore(plugin): manifests, marketplace and state contract`

### Task 2: `parseTaskNotification`

**Writes:** `hooks/notification.ts`, `hooks/notification.test.ts`
**Reads:** —
**Depends on:** —
**Interfaces:**
- Produces: `parseTaskNotification(text: string): { id: string; status: string; exitCode?: number } | undefined` (тип повернення оголошено локально, структурно сумісний із `TaskNotification` Task 1).

- [x] **Step 1: write the failing test** `hooks/notification.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import { parseTaskNotification } from './notification'

const note = (id: string, status: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/claude-1000/p/s/tasks/${id}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

test('completed with exit code 0', async () => {
  expect(parseTaskNotification(note('b1', 'completed', 'Background command "lint" completed (exit code 0)'))).toEqual({ id: 'b1', status: 'completed', exitCode: 0 })
})

test('failed with exit code 1 and 3', async () => {
  expect(parseTaskNotification(note('b2', 'failed', 'Background command "jest" failed with exit code 1'))).toEqual({ id: 'b2', status: 'failed', exitCode: 1 })
  expect(parseTaskNotification(note('b3', 'failed', 'Background command "x" failed with exit code 3'))).toEqual({ id: 'b3', status: 'failed', exitCode: 3 })
})

test('negative exit code', async () => {
  expect(parseTaskNotification(note('b4', 'completed', 'Background command "vite" completed (exit code -1)'))).toEqual({ id: 'b4', status: 'completed', exitCode: -1 })
})

test('monitor stream end has no exit code', async () => {
  expect(parseTaskNotification(note('m1', 'completed', 'Monitor "ticks" stream ended'))).toEqual({ id: 'm1', status: 'completed' })
})

test('text that is not a notification', async () => {
  expect(parseTaskNotification('run the tests please')).toBeUndefined()
  expect(parseTaskNotification('<task-id>x</task-id> without status')).toBeUndefined()
})
```
- [x] **Step 2: run it, watch it fail** — `claude plugin test .` → fail: модуль `./notification` не знайдено.
- [x] **Step 3: implement** `hooks/notification.ts`:
```ts
export function parseTaskNotification(text: string): { id: string; status: string; exitCode?: number } | undefined {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim()
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim()
  if (!id || !status) return undefined
  const code = /exit code (-?\d+)/.exec(text)?.[1]
  return code === undefined ? { id, status } : { id, status, exitCode: Number(code) }
}
```
- [x] **Step 4: run it, watch it pass** — `claude plugin test .` → 5 тестів notification pass.
- [x] **Step 5: commit** `feat(notification): parse background task notifications`

### Task 3: `sanitize`

**Writes:** `hooks/sanitize.ts`, `hooks/sanitize.test.ts`
**Reads:** —
**Depends on:** —
**Interfaces:**
- Produces: `sanitize(text: string): string` — видаляє CSI, OSC (BEL/ST), DCS/SOS/PM/APC, решту `ESC x`, 8-бітні C1, потім усі C0 і DEL, окрім `\t`.

- [x] **Step 1: write the failing test** `hooks/sanitize.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import { sanitize } from './sanitize'

test('drops colour and cursor CSI', async () => {
  expect(sanitize('\x1b[41m FAIL \x1b[0m spec.ts')).toBe(' FAIL  spec.ts')
  expect(sanitize('a\x1b[2K\x1b[1Gb')).toBe('ab')
})

test('drops OSC terminated by BEL and by ST', async () => {
  expect(sanitize('\x1b]8;;https://x.test\x07link\x1b]8;;\x07')).toBe('link')
  expect(sanitize('\x1b]0;title\x1b\\text')).toBe('text')
  expect(sanitize('\x1b]52;c;aGVsbG8=\x07ok')).toBe('ok')
})

test('drops DCS, 8-bit CSI and stray controls', async () => {
  expect(sanitize('\x1bPq#0;2;0;0;0\x1b\\after')).toBe('after')
  expect(sanitize('\x9b31mred')).toBe('red')
  expect(sanitize('progress 10%\rprogress 20%\x07')).toBe('progress 10%progress 20%')
})

test('keeps tab and unicode', async () => {
  expect(sanitize('✓\tтести пройшли ◐')).toBe('✓\tтести пройшли ◐')
})
```
- [x] **Step 2: run it, watch it fail** — `claude plugin test .` → fail: модуль `./sanitize` не знайдено.
- [x] **Step 3: implement** `hooks/sanitize.ts`:
```ts
const SEQUENCES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-_]|\x9b[0-?]*[ -/]*[@-~]|[\x80-\x9f]/g
const CONTROLS = /[\x00-\x08\x0a-\x1f\x7f]/g

export function sanitize(text: string): string {
  return text.replace(SEQUENCES, '').replace(CONTROLS, '')
}
```
- [x] **Step 4: run it, watch it pass** — `claude plugin test .` → 4 тести sanitize pass.
- [x] **Step 5: commit** `feat(sanitize): strip terminal control sequences from output`

### Task 4: чисті переходи стану `tasks.ts`

**Writes:** `hooks/tasks.ts`, `hooks/tasks.test.ts`
**Reads:** `types/index.d.ts`
**Depends on:** Task 1
**Interfaces:**
- Consumes: `ConsoleTask`, `Board`, `TaskNotification` (Task 1).
- Produces: `MAX_TASKS`, `addTask(board, task)`, `applyNotification(board, n)`, `dropTask(board, id)`, `selectTask(board, i)`, `hasRunning(board)` — усі повертають новий `Board`/`boolean`, вхід не мутують.

- [x] **Step 1: write the failing test** `hooks/tasks.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import type { Board, ConsoleTask } from '../types'
import { addTask, applyNotification, dropTask, hasRunning, MAX_TASKS, selectTask } from './tasks'

const t = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id, kind: 'shell', command: id, startedAt: 0, ...extra })
const empty: Board = { tasks: [], selected: -1 }

test('addTask appends, selects the new task and keeps the last 20', async () => {
  let b = empty
  for (let i = 0; i < MAX_TASKS + 2; i++) b = addTask(b, t(`b${i}`))
  expect(b.tasks.length).toBe(MAX_TASKS)
  expect(b.tasks[0]?.id).toBe('b2')
  expect(b.selected).toBe(MAX_TASKS - 1)
})

test('applyNotification marks viewed only for the selected non-completed task', async () => {
  const b = addTask(addTask(empty, t('a')), t('b'))
  const failedSelected = applyNotification(b, { id: 'b', status: 'failed', exitCode: 1 })
  expect(failedSelected.tasks[1]).toEqual({ ...t('b'), status: 'failed', exitCode: 1, viewed: true })
  const failedOther = applyNotification(b, { id: 'a', status: 'failed', exitCode: 2 })
  expect(failedOther.tasks[0]?.viewed).toBe(false)
  const done = applyNotification(b, { id: 'b', status: 'completed', exitCode: 0 })
  expect(done.tasks[1]?.viewed).toBe(false)
  expect(applyNotification(b, { id: 'zz', status: 'failed' })).toBe(b)
})

test('selectTask marks a finished target viewed and drops the viewed task it leaves', async () => {
  let b: Board = { tasks: [t('a', { status: 'failed', exitCode: 1 }), t('b'), t('c')], selected: 2 }
  b = selectTask(b, 0)
  expect(b.selected).toBe(0)
  expect(b.tasks[0]?.viewed).toBe(true)
  b = selectTask(b, 1)
  expect(b.tasks.map(x => x.id)).toEqual(['b', 'c'])
  expect(b.selected).toBe(0)
})

test('dropTask keeps the selection by id and closes to -1 when empty', async () => {
  const b: Board = { tasks: [t('a'), t('b'), t('c')], selected: 2 }
  expect(dropTask(b, 'a')).toEqual({ tasks: [t('b'), t('c')], selected: 1 })
  expect(dropTask(b, 'c')).toEqual({ tasks: [t('a'), t('b')], selected: 1 })
  expect(dropTask({ tasks: [t('a')], selected: 0 }, 'a')).toEqual({ tasks: [], selected: -1 })
})

test('hasRunning is true while any task has no status', async () => {
  expect(hasRunning({ tasks: [t('a', { status: 'completed' }), t('b')], selected: 0 })).toBe(true)
  expect(hasRunning({ tasks: [t('a', { status: 'failed' })], selected: 0 })).toBe(false)
})
```
- [x] **Step 2: run it, watch it fail** — `claude plugin test .` → fail: модуль `./tasks` не знайдено.
- [x] **Step 3: implement** `hooks/tasks.ts`:
```ts
import type { Board, ConsoleTask, TaskNotification } from '../types'

export const MAX_TASKS = 20

export function addTask(board: Board, task: ConsoleTask): Board {
  const tasks = [...board.tasks.filter(x => x.id !== task.id), task].slice(-MAX_TASKS)
  return { tasks, selected: tasks.length - 1 }
}

export function applyNotification(board: Board, n: TaskNotification): Board {
  const at = board.tasks.findIndex(x => x.id === n.id)
  if (at < 0) return board
  const tasks = board.tasks.map((x, i) =>
    i === at
      ? { ...x, status: n.status, exitCode: n.exitCode, viewed: n.status !== 'completed' && i === board.selected }
      : x,
  )
  return { ...board, tasks }
}

export function dropTask(board: Board, id: string): Board {
  const at = board.tasks.findIndex(x => x.id === id)
  if (at < 0) return board
  const keep = board.tasks[board.selected]?.id
  const tasks = board.tasks.filter(x => x.id !== id)
  if (tasks.length === 0) return { tasks, selected: -1 }
  const kept = tasks.findIndex(x => x.id === keep)
  return { tasks, selected: kept >= 0 ? kept : Math.min(at, tasks.length - 1) }
}

export function selectTask(board: Board, i: number): Board {
  const target = board.tasks[i]
  if (!target || i === board.selected) return board
  const prev = board.tasks[board.selected]
  const tasks = board.tasks.map((x, j) => (j === i && x.status && x.status !== 'completed' ? { ...x, viewed: true } : x))
  const next = { tasks, selected: i }
  return prev?.viewed ? dropTask(next, prev.id) : next
}

export function hasRunning(board: Board): boolean {
  return board.tasks.some(x => !x.status)
}
```
  Примітка до тесту `applyNotification`: `toEqual` з `{ ..., exitCode: 1, viewed: true }` — порівняння структурне; `exitCode: undefined` у `completed` без коду теж допустиме.
- [x] **Step 4: run it, watch it pass** — `claude plugin test .` → 5 тестів tasks pass.
- [x] **Step 5: commit** `feat(tasks): pure board transitions for the task lifecycle`

### Task 5: чисті функції верстки `layout.ts`

**Writes:** `hooks/layout.ts`, `hooks/layout.test.ts`
**Reads:** `types/index.d.ts`, `docs/sdd/proto/console-log-pane/v2-final/register.tsx` (функції `mark`, `label`, `age`, `statusText`, блок `if (v === 'a')`)
**Depends on:** Task 1
**Interfaces:**
- Consumes: `ConsoleTask` (Task 1).
- Produces: `LABEL_MAX`, `fit(text, width)`, `topParts(title, right, width) → { fill, right }`, `bottomParts(hint, width) → { hint, fill }`, `age(startedAt, now)`, `mark(task) → { glyph, color }`, `statusText(task)`, `tabLabel(task)`, `tabWidth(task, now)`, `tabWindow(widths, selected, budget) → { lo, hi }`, `paneHint(focused, hasCtrlArrows)`.
  Інваріант: `'╭─ ' + title + fill + right + '─╮'` має довжину рівно `width`; `'╰─' + hint + fill` — рівно `width` (fill закінчується на `╯`).

- [x] **Step 1: write the failing test** `hooks/layout.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import type { ConsoleTask } from '../types'
import { age, bottomParts, fit, mark, paneHint, statusText, tabLabel, tabWindow, topParts } from './layout'

const t = (extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id: 'b1', kind: 'shell', command: 'pnpm   exec jest --selectProjects db --runInBand', startedAt: 0, ...extra })

test('frame lines are exactly the pane width', async () => {
  for (const width of [40, 100, 137]) {
    for (const [title, right] of [['BACKGROUND', '3 tasks'], ['OUTPUT', 'failed · exit 1'], ['OUTPUT', '']] as const) {
      const p = topParts(title, right, width)
      expect(`╭─ ${title}${p.fill}${p.right}─╮`.length).toBe(width)
    }
    for (const hint of ['ctrl+→ focus', '', 'x'.repeat(300)]) {
      const p = bottomParts(hint, width)
      expect(`╰─${p.hint}${p.fill}`.length).toBe(width)
    }
  }
})

test('fit pads and truncates with an ellipsis', async () => {
  expect(fit('abc', 5)).toBe('abc  ')
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(fit('abc', 0)).toBe('')
})

test('age formats seconds and minutes', async () => {
  expect(age(0, 12_400)).toBe('12s')
  expect(age(0, 65_000)).toBe('1m05s')
})

test('status marks and text', async () => {
  expect(mark(t())).toEqual({ glyph: '◐', color: 'yellow' })
  expect(mark(t({ status: 'completed' }))).toEqual({ glyph: '✓', color: 'green' })
  expect(mark(t({ status: 'failed' }))).toEqual({ glyph: '✗', color: 'red' })
  expect(mark(t({ status: 'killed' }))).toEqual({ glyph: '■', color: 'gray' })
  expect(statusText(t())).toBe('running')
  expect(statusText(t({ status: 'failed', exitCode: 1 }))).toBe('failed · exit 1')
  expect(statusText(t({ status: 'completed' }))).toBe('completed')
})

test('tab label prefers the description and caps at 22 chars', async () => {
  expect(tabLabel(t({ label: 'jest db tests' }))).toBe('jest db tests')
  expect(tabLabel(t())).toBe('pnpm exec jest --sele…')
})

test('tab window keeps the selected tab inside the budget', async () => {
  expect(tabWindow([10, 10, 10], 1, 100)).toEqual({ lo: 0, hi: 2 })
  const w = tabWindow([10, 10, 10, 10, 10], 4, 25)
  expect(w.hi).toBe(4)
  expect(w.lo).toBe(3)
  expect(tabWindow([], -1, 50)).toEqual({ lo: 0, hi: -1 })
})

test('pane hint depends on focus and on the ctrl+arrow binding', async () => {
  expect(paneHint(true, false)).toBe('ctrl+→ next · ctrl+← back')
  expect(paneHint(false, true)).toBe('ctrl+→ focus')
  expect(paneHint(false, false)).toBe('ctrl+x tab focus')
})
```
- [x] **Step 2: run it, watch it fail** — `claude plugin test .` → fail: модуль `./layout` не знайдено.
- [x] **Step 3: implement** `hooks/layout.ts`:
```ts
import type { ConsoleTask } from '../types'

export const LABEL_MAX = 22

export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width)
}

export function topParts(title: string, right: string, width: number): { fill: string; right: string } {
  const r = right ? ` ${right} ` : ' '
  const n = Math.max(1, width - 6 - title.length - r.length)
  return { fill: ` ${'─'.repeat(n)}`, right: r }
}

export function bottomParts(hint: string, width: number): { hint: string; fill: string } {
  const h = hint ? ` ${fit(hint, Math.max(0, width - 8)).trimEnd()} ` : ''
  return { hint: h, fill: `${'─'.repeat(Math.max(1, width - 3 - h.length))}╯` }
}

export function age(startedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export function mark(task: ConsoleTask): { glyph: string; color: string } {
  if (!task.status) return { glyph: '◐', color: 'yellow' }
  if (task.status === 'completed') return { glyph: '✓', color: 'green' }
  if (task.status === 'failed') return { glyph: '✗', color: 'red' }
  return { glyph: '■', color: 'gray' }
}

export function statusText(task: ConsoleTask): string {
  if (!task.status) return 'running'
  return task.exitCode === undefined ? task.status : `${task.status} · exit ${task.exitCode}`
}

export function tabLabel(task: ConsoleTask): string {
  const text = (task.label ?? task.command).replace(/\s+/g, ' ').trim()
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text
}

export function tabWidth(task: ConsoleTask, now: number): number {
  return 2 + tabLabel(task).length + 1 + age(task.startedAt, now).length + 3
}

export function tabWindow(widths: readonly number[], selected: number, budget: number): { lo: number; hi: number } {
  if (selected < 0 || widths.length === 0) return { lo: 0, hi: -1 }
  let lo = selected
  let hi = selected
  let used = widths[selected] ?? 0
  for (;;) {
    const right = hi < widths.length - 1 && used + (widths[hi + 1] ?? 0) <= budget
    if (right) {
      hi += 1
      used += widths[hi] ?? 0
    }
    const left = lo > 0 && used + (widths[lo - 1] ?? 0) <= budget
    if (left) {
      lo -= 1
      used += widths[lo] ?? 0
    }
    if (!right && !left) return { lo, hi }
  }
}

export function paneHint(focused: boolean, hasCtrlArrows: boolean): string {
  if (focused) return 'ctrl+→ next · ctrl+← back'
  return hasCtrlArrows ? 'ctrl+→ focus' : 'ctrl+x tab focus'
}
```
- [x] **Step 4: run it, watch it pass** — `claude plugin test .` → 7 тестів layout pass.
- [x] **Step 5: commit** `feat(layout): pure frame, tab and status helpers`

### Task 6: модуль хуків `register.tsx` і тест панелі

**Writes:** `hooks/register.tsx`, `hooks/pane.test.tsx`
**Reads:** `hooks/notification.ts`, `hooks/sanitize.ts`, `hooks/tasks.ts`, `hooks/layout.ts`, `types/index.d.ts`, `docs/sdd/proto/console-log-pane/v2-final/register.tsx`, `/tmp/claude-1000/bundled-skills/*/*/plugin-authoring/examples/pane.test.tsx`
**Depends on:** Tasks 1, 2, 3, 4, 5
**Interfaces:**
- Consumes: `parseTaskNotification` (Task 2); `sanitize` (Task 3); `addTask`, `applyNotification`, `dropTask`, `selectTask`, `hasRunning` (Task 4); `fit`, `topParts`, `bottomParts`, `age`, `mark`, `statusText`, `tabLabel`, `tabWidth`, `tabWindow`, `paneHint` (Task 5); типи з `../types` (Task 1).
- Produces: `export const register: Register`; slash-команда `console-log`; панель id `console-log`.

- [x] **Step 1: write the failing test** `hooks/pane.test.tsx`:
```tsx
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'console-log',
  component: 'Pane',
  requestId: 'console-log',
  props: {
    title: 'Background output',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a background Bash call becomes a tab with its live output', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('process.run', (_, e) =>
    e.argv[0] === 'tail'
      ? { value: { exitCode: 0, stdout: 'line 1\n\x1b[31mline 2\x1b[0m\nline 3\n', stderr: '' } }
      : { value: { exitCode: 0, stdout: '/tmp/claude-1000/p/S1/tasks/b1.output\n', stderr: '' } },
  )
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'pnpm exec jest', description: 'jest db tests', run_in_background: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const top = await ui.find({ type: 'Text', text: /BACKGROUND/ })
  expect(top?.text.length).toBe(100)
  expect((await ui.find({ type: 'Text', text: /jest db tests/ }))?.text).toContain('jest db tests')
  expect((await ui.find({ type: 'Text', text: /line 2/ }))?.text).not.toContain('\x1b')
  expect(await ui.find({ type: 'Text', text: /ctrl\+x tab focus/ })).toBeDefined()
  await ui.unmount()
})

test('an empty pane says so', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', () => { throw new Error('no file') })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No background tasks yet\./ })).toBeDefined()
  await ui.unmount()
})
```
  Якщо назва події/форма відповіді engine-заглушки (`session.id`, `fs.read`, `process.run`, `env`) у `claude-code.d.ts` інша — виправити заглушку за типами (grep `'session.id'`, `'process.run'`, `export type Mock`), не змінюючи тверджень `expect`.
- [x] **Step 2: run it, watch it fail** — `claude plugin test .` → fail: `hooks/register.tsx` відсутній.
- [x] **Step 3: implement** `hooks/register.tsx`:
```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, ConsoleTask } from '../types'
import { age, bottomParts, fit, mark, paneHint, statusText, tabLabel, tabWidth, tabWindow, topParts } from './layout'
import { parseTaskNotification } from './notification'
import { sanitize } from './sanitize'
import { addTask, applyNotification, dropTask, hasRunning, selectTask } from './tasks'

const PANE = 'console-log'
const TITLE = 'Background output'
const COLUMNS = 100
const LINES = 200
const LINE_MAX = 500
const POLL_MS = 1000
const TAIL_TIMEOUT_MS = 2000
const DROP_COMPLETED_MS = 10000

const tasks = atom({ plugin: 'console-log', key: 'tasks' } as const, [] as ConsoleTask[])
const selected = atom({ plugin: 'console-log', key: 'selected' } as const, -1)
const lines = atom({ plugin: 'console-log', key: 'lines' } as const, [] as string[])
const pathMissing = atom({ plugin: 'console-log', key: 'pathMissing' } as const, false)
const readFailed = atom({ plugin: 'console-log', key: 'readFailed' } as const, false)
const dismissed = atom({ plugin: 'console-log', key: 'dismissed' } as const, false)
const hasCtrlArrows = atom({ plugin: 'console-log', key: 'hasCtrlArrows' } as const, false)

let timer: Timer | undefined
let busy = false

async function board($: EngineInterface): Promise<Board> {
  return { tasks: await read($, tasks), selected: await read($, selected) }
}

async function save($: EngineInterface, b: Board) {
  await update($, tasks, () => b.tasks)
  await update($, selected, () => b.selected)
}

async function refresh($: EngineInterface) {
  if (busy) return
  const task = (await read($, tasks))[await read($, selected)]
  if (!task?.path) {
    await update($, pathMissing, () => Boolean(task))
    await update($, lines, () => [])
    return
  }
  await update($, pathMissing, () => false)
  busy = true
  try {
    const { exitCode, stdout } = await $.process.run(['tail', '-n', String(LINES), task.path], { timeoutMs: TAIL_TIMEOUT_MS })
    if (exitCode !== 0) {
      await update($, readFailed, () => true)
      return
    }
    const next = stdout.split('\n')
    if (next.at(-1) === '') next.pop()
    await update($, readFailed, () => false)
    await update($, lines, () => next.map(l => sanitize(l).slice(0, LINE_MAX)))
  } catch {
    await update($, readFailed, () => true)
  } finally {
    busy = false
  }
}

async function poll($: EngineInterface) {
  if (!hasRunning(await board($))) {
    timer?.cancel()
    timer = undefined
    return
  }
  await refresh($)
}

function tick($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(POLL_MS, () => void poll($))
}

async function openPane($: EngineInterface) {
  if (await read($, dismissed)) return
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

async function leave($: EngineInterface) {
  await $.ui.close({ id: PANE })
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

async function drop($: EngineInterface, id: string) {
  const b = dropTask(await board($), id)
  await save($, b)
  if (b.tasks.length === 0) {
    await update($, lines, () => [])
    await $.ui.close({ id: PANE })
    return
  }
  await refresh($)
}

async function findOutput($: EngineInterface, id: string): Promise<string | undefined> {
  const session = await $.session.id()
  const scoped = await $.process.run([
    'sh', '-c', 'ls -t "${TMPDIR:-/tmp}"/claude-"$(id -u)"/*/"$1"/tasks/"$2".output 2>/dev/null | head -1', '_', session, id,
  ])
  const hit = scoped.stdout.trim()
  if (hit) return hit
  const wide = await $.process.run([
    'sh', '-c', 'ls -t "${TMPDIR:-/tmp}"/claude-"$(id -u)"/*/*/tasks/"$1".output 2>/dev/null | head -1', '_', id,
  ])
  return wide.stdout.trim() || undefined
}

async function readCtrlArrows($: EngineInterface): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (!home) return false
  try {
    const raw = JSON.parse(String(await $.fs.read(`${home}/.claude/keybindings.json`))) as {
      bindings?: { context?: string; bindings?: Record<string, unknown> }[]
    }
    return (raw.bindings ?? []).some(b => b.context === 'Chat' && b.bindings?.['ctrl+right'] === 'abovePrompt:focus')
  } catch {
    return false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'console-log', description: 'Open the background output pane' })
    $.ui.status(undefined)
    let b = await board($)
    for (const x of b.tasks) if (x.status === 'completed') b = dropTask(b, x.id)
    await save($, b)
    const bound = await readCtrlArrows($)
    await update($, hasCtrlArrows, () => bound)
    if (hasRunning(b)) tick($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Bash' && e.tool !== 'Monitor') return ran
    if (ran.deny !== undefined || ran.isError) return ran
    try {
      const r = ran.result as { backgroundTaskId?: string; backgroundOutputPath?: string; taskId?: string }
      const id = e.tool === 'Bash' ? r.backgroundTaskId : r.taskId
      if (!id) return ran
      const path = r.backgroundOutputPath ?? (await findOutput($, id))
      const command = sanitize(e.tool === 'Bash' ? e.command : `monitor: ${e.description}`)
      const described = e.tool === 'Bash' ? e.description?.trim() : undefined
      const task: ConsoleTask = {
        id,
        kind: e.tool === 'Bash' ? 'shell' : 'monitor',
        command,
        label: e.tool === 'Monitor' ? command : described ? sanitize(described) : undefined,
        path,
        startedAt: await $.clock.now(),
      }
      await save($, addTask(await board($), task))
      await refresh($)
      await openPane($)
      tick($)
    } catch {
      return ran
    }
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const n = parseTaskNotification(e.text)
      const b = await board($)
      if (n && b.tasks.some(x => x.id === n.id)) {
        await save($, applyNotification(b, n))
        await refresh($)
        if (n.status === 'completed') $.clock.after(DROP_COMPLETED_MS, () => void drop($, n.id))
      }
    }
    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const b = await board($)
    if (e.element === 'exit') {
      if (e.origin.kind !== 'person') return next(e)
      if (b.tasks.length > 1 && b.selected === b.tasks.length - 1) return {}
      void leave($)
      return {}
    }
    const id = e.element?.startsWith('tab-') ? e.element.slice(4) : undefined
    const i = id ? b.tasks.findIndex(x => x.id === id) : -1
    if (i >= 0 && i !== b.selected) {
      await save($, selectTask(b, i))
      await refresh($)
    }
    return next(e)
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async () => ({}))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') await update($, dismissed, () => true)
    return next(e)
  })

  on('command.run', { command: 'console-log' }, async $ => {
    await update($, dismissed, () => false)
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    return { text: 'Background output pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, tasks)
    const at = await read($, selected)
    const task = list[at]
    const body = await read($, lines)
    const missing = await read($, pathMissing)
    const failed = await read($, readFailed)
    const bound = await read($, hasCtrlArrows)
    const now = await $.clock.now()
    const W = Math.max(30, e.props.bodyColumns)
    const R = Math.max(8, e.props.scroll.bodyRows)
    const inner = W - 4

    const top = (title: string, right: string) => {
      const p = topParts(title, right, W)
      return (
        <Text wrap="truncate">
          <Text color="gray">╭─ </Text>
          <Text color="cyan" bold>{title}</Text>
          <Text color="gray">{p.fill}</Text>
          <Text dimColor>{p.right}</Text>
          <Text color="gray">─╮</Text>
        </Text>
      )
    }
    const bottom = (hint: string) => {
      const p = bottomParts(hint, W)
      return (
        <Text wrap="truncate">
          <Text color="gray">╰─</Text>
          <Text dimColor>{p.hint}</Text>
          <Text color="gray">{p.fill}</Text>
        </Text>
      )
    }
    const row = (text: string, key: string, dim = false) => (
      <Text key={key} wrap="truncate">
        <Text color="gray">│ </Text>
        <Text dimColor={dim}>{fit(text, inner)}</Text>
        <Text color="gray"> │</Text>
      </Text>
    )

    const win = tabWindow(list.map(x => tabWidth(x, now)), at, inner - 7)
    const shown = list.slice(win.lo, win.hi + 1)
    const tabs = (
      <Box flexDirection="row" width={inner} overflow="hidden">
        <Button key="exit" plain label=" " onPress={() => undefined} />
        {win.lo > 0 && <Text dimColor>{`‹${win.lo} `}</Text>}
        {shown.map((x, j) => {
          const i = win.lo + j
          const m = mark(x)
          const isOn = i === at
          return (
            <Button key={`tab-${x.id}`} plain autoFocus={i === 0 ? true : undefined} onPress={() => undefined}>
              <Text color={m.color}>{m.glyph} </Text>
              <Text color={isOn ? 'cyan' : undefined} bold={isOn} underline={isOn} dimColor={!isOn}>
                {tabLabel(x)}
              </Text>
              <Text dimColor>{` ${age(x.startedAt, now)}   `}</Text>
            </Button>
          )
        })}
        {win.hi < list.length - 1 && <Text dimColor>{`${list.length - 1 - win.hi}›`}</Text>}
      </Box>
    )

    const room = R - 5
    const out = missing ? ['output file not found'] : body.slice(-room)
    while (task && out.length < room) out.push('')
    const right = task ? `${statusText(task)}${failed ? ' · file unavailable' : ''}` : ''

    return (
      <Box flexDirection="column" width={W} height={R} backgroundColor="black">
        {top('BACKGROUND', `${list.length} ${list.length === 1 ? 'task' : 'tasks'}`)}
        <Box flexDirection="row">
          <Text color="gray">│ </Text>
          {list.length ? tabs : <Box width={inner}><Text dimColor>No background tasks yet.</Text></Box>}
          <Text color="gray"> │</Text>
        </Box>
        {bottom(paneHint(e.props.isFocused, bound))}
        {task && top('OUTPUT', right)}
        {task && out.map((l, i) => row(l, `o${i}`, missing))}
        {task && bottom(task.command)}
      </Box>
    )
  })
}
```
  Примітки для імплементера:
  - `Timer` імпортується з `'claude-code'` (`export type Timer = { cancel(): void }`). Якщо експорт має іншу назву — взяти `ReturnType<EngineInterface['clock']['every']>`.
  - Якщо `ui.close` хук вимагає матчер — `on('ui.close', { id: PANE }, …)`; тип вхідних `PaneCloseInput { id, origin: { kind: 'plugin'|'person'|'unload' } }`.
  - `claude plugin validate .` має пройти: якщо скаржиться на передачу `$` у стрілкові замикання (`() => void poll($)`), винести колбеки в top-level функції.
- [x] **Step 4: run it, watch it pass** — `claude plugin validate .` → `✔ Validation passed`; type-check з Global constraints → без виводу; `claude plugin test .` → усі тести (notification 5, sanitize 4, tasks 5, layout 7, pane 2) pass.
- [x] **Step 5: commit** `feat(console-log): pane with live output of background tasks`

### Task 7: README

**Writes:** `README.md`, `LICENSE`
**Reads:** docs/sdd/specs/2026-10-20-console-log-mod.md §3.5, §5
**Depends on:** —
**Interfaces:** —

- [x] **Step 1: write** `LICENSE` — стандартний текст MIT, `Copyright (c) 2026 dmytro-rudenko`.
- [x] **Step 2: write** `README.md` двома мовами (спочатку English, потім `## Українською` з тим самим змістом). Розділи й точний вміст:
  1. `# console-log` + один абзац: панель поруч із чатом з останніми 200 рядками кожної фонової Bash/Monitor-задачі, оновлення щосекунди.
  2. `## Install` — блок коду `/plugin install console-log --marketplace dmytro-rudenko/console-log` (з prompt'у; далі `y` і scope), і з shell: `claude plugin install console-log --marketplace dmytro-rudenko/console-log`.
  3. `## Keys` — пояснення, що плагін не може постачати клавіші, і блок для `~/.claude/keybindings.json` (злити з наявним масивом `bindings`):
     ```json
     {
       "$schema": "https://www.schemastore.org/claude-code-keybindings.json",
       "bindings": [
         { "context": "Chat", "bindings": { "ctrl+right": "abovePrompt:focus" } },
         { "context": "AbovePrompt", "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } },
         { "context": "Pane", "bindings": { "ctrl+right": "abovePrompt:next", "ctrl+left": "abovePrompt:previous" } }
       ]
     }
     ```
     Далі: `ctrl+→` з промпту — фокус на першу задачу; `ctrl+→` — наступна (на останній стоїть); `ctrl+←` — попередня, на першій — назад у промпт. Без фрагмента: `ctrl+x tab`, `←`/`→`, `esc`. Компроміс: `ctrl+→` у промпті більше не стрибає на слово (лишається `alt+→`).
  4. `## Behaviour` — `◐` running, `✓` зникає за 10 с, `✗`/`■` лишається до перегляду; без задач панель закривається; закрита хрестиком — до `/console-log`; панель збоку з терміналу ≥110 колонок.
  5. `## Limits` — лише фонові задачі, запущені після завантаження мода; ANSI-кольори вирізаються; рамку панелі (сірі рядки, `✕`) малює Claude Code.
- [x] **Step 3: run** `claude plugin validate .` — README не впливає; пропустити, якщо Task 6 ще не злитий.
- [x] **Step 4: commit** `docs(readme): install, keys and behaviour`

### Task 8: smoke у живій сесії

**Writes:** — (лише видаляє тимчасову копію в `~/.claude/dev-mods/…`, не файли репо)
**Reads:** весь плагін
**Depends on:** Tasks 6, 7
**Interfaces:** —

- [x] **Step 1:** видалити прототип із теки модів сесії, щоб `/console-log` не реєструвався двічі: `rm -rf /home/pc/.claude/dev-mods/<поточна session id>/bg-tail` (прототип збережено в `docs/sdd/proto/…/v2-final`).
- [x] **Step 2:** скопіювати плагін у теку модів сесії: `rsync -a --exclude .git --exclude docs --exclude .pasadena ./ /home/pc/.claude/dev-mods/<session id>/console-log/`; дочекатися reload (рядок `console-log: This mod … loaded`).
- [x] **Step 3:** запустити три фонові Bash (8 с успіх, 25 с `exit 1`, 2 хв довгий) і Monitor на 15 с — панель відкривається, 4 вкладки, лог оновлюється щосекунди, Monitor підписано `monitor: …`.
- [x] **Step 4:** людина перевіряє `ctrl+→` (перша задача), `ctrl+→` до останньої (стоїть), `ctrl+←` назад і на першій — вихід у промпт; ✓ зникає за 10 с; ✗ зникає після перегляду; без задач панель закривається; закрита `✕` не відкривається до `/console-log`.
- [x] **Step 5:** знахідки — окремими fix-комітами в Task 6/7 файлах; після проходу видалити тимчасову копію з dev-mods.

## Verification (end-to-end)

1. `claude plugin validate .` → `✔ Validation passed`.
2. Type-check з Global constraints → без виводу.
3. `claude plugin test .` → 23 тести pass.
4. Task 8 smoke пройдено людиною.
5. `git push` гілки; коментар у PR #1 після кожної хвилі.
