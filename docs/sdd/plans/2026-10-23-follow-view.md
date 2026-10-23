# console-log: панель без вкладок, що йде за найновішою задачею — implementation plan

**Goal:** У панелі console-log немає рядка вкладок. Вона показує агента, якого відкрили в нижньому списку Claude Code (`e.props.view.agentId`). Якщо такого немає, показує найновішу задачу, що працює, а якщо працюючих немає — останню завершену. Кожна завершена задача зникає через 10 с, і коли не лишається нічого, панель закривається сама. Версія `0.3.0`.
**Spec:** docs/sdd/specs/2026-10-23-follow-view.md
**Prototype:** — (немає; поведінку перевіряємо смоуком)
**Verification:** `claude plugin test .` → останній рядок `Ran N tests across 7 files.`, `0 fail`; `npx -y -p typescript tsc -p . --noEmit` → exit 0 без виводу; `claude plugin validate .` → `✔ Validation passed` (попередження про README/LICENSE/icon каталогу ігноруємо).

## Waves
| Wave | Tasks | Why together |
|---|---|---|
| 0 | 0 | alone: acceptance tests, червоні до хвилі 2 |
| 1 | 1, 2, 4 | файли не перетинаються: `tasks.ts`/`types` проти `layout.ts` проти `README.md`/`plugin.json` |
| 2 | 3 | alone: `register.tsx` споживає Task 1 і Task 2; `pane.test.tsx` спільний з Task 0 |

Що серіалізовано і чому:
- Task 3 іде після Task 0, бо обидві пишуть `hooks/pane.test.tsx`.
- Task 3 іде після Task 1 і Task 2, бо використовує їхні `pick`, `sweep`, `headLine`, `taskLabel`.
- Після хвилі 1 `tsc` і `pane.test.tsx` червоні: `register.tsx` ще імпортує видалені `selectTask`, `tabWindow` тощо. Зелене все стає наприкінці хвилі 2.

## Global constraints
- Stack: модуль хуків Claude Code, TypeScript + JSX (`h`), без DOM/Node. Тести: `claude plugin test .` (`import { expect, mock, test } from 'claude-code/testing'`). Виклики рушія мокаються через `on('<noun.method>', () => ({ value: … }))`.
- Підготовка типів (раз на worktree, у gitignore): `cp -r /home/pc/.claude/dev-mods/af08d6e1-b747-45ed-9d37-f215b12f9188/bg-tail/.claude-plugin/types .claude-plugin/types`.
- Коментарі: нуль, крім обмежень, яких не видно з коду. Існуючий коментар над `stop` про TaskStop лишається.
- Пауза перед прибиранням завершеної задачі: `DROP_COMPLETED_MS = 10000` для `completed`, `failed`, `killed`, `expired`.
- `view` у стані — рядок: `''` означає `main`, інакше це `agentId` агента, відкритого внизу.
- Тексти UI англійською: `TRANSCRIPT`, `OUTPUT`, `in view`, `N running`, `No background tasks yet.`

---

### Task 0: acceptance tests

**Writes:** `hooks/pane.test.tsx` (лише дописати в кінець; існуючі тести не чіпати)
**Covers:** spec §6 `hooks/pane.test.tsx`:
- «два старти → тіло показує output другого, рядків вкладок і `BACKGROUND` немає»;
- «другий завершився → показ переходить на перший»;
- «усе завершилось + 10 с → панель закрита»;
- «рендер із `view: { agentId }` → `TRANSCRIPT` і `in view` з транскриптом цього агента навіть після його завершення і 10 с»;
- «рендер із `view: {}` → автослідування й закриття»;
- плюс §3.1 «невідомий агент → синтетичний агент».

- [x] **Step 1: write the acceptance tests.** Дописати в кінець `hooks/pane.test.tsx`. Файл уже визначає `PANE`, `ok`, `note`, `agentSetup`, `SPAWN`, `TRANSCRIPT_FIXTURE` та імпортує `expect, mock, test`, `AgentStatus`.

```tsx
const twoJobs = (on: On) => {
  mock.env(on, { HOME: '/home/nobody' })
  const closed: string[] = []
  let n = 0
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('prompt.submit', (_, e) => e)
  on('process.run', (_, e) =>
    e.argv[0] === 'tail' ? ok(e.argv.at(-1) === '/tmp/j1.output' ? 'from one\n' : 'from two\n') : ok(`/tmp/${e.argv.at(-1)}.output\n`),
  )
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `j${++n}` } }))
  return closed
}

const viewing = (agentId?: string) => ({ ...PANE, props: { ...PANE.props, view: agentId ? { agentId } : {} }, surface: 'terminal' as const })

test('the pane shows the newest running task and has no tab row', async ($, on) => {
  const clock = mock.clock(on)
  twoJobs(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'one', description: 'job one', run_in_background: true })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'two', description: 'job two', run_in_background: true })
  await clock.settle()

  const ui = await $.ui.mount(viewing())
  expect(await ui.find({ type: 'Text', text: /from two/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /job two/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /from one/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /BACKGROUND/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /job one/ })).toBeUndefined()
  await ui.unmount()
})

test('when the newest task ends the pane follows the next running one', async ($, on) => {
  const clock = mock.clock(on)
  twoJobs(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'one', description: 'job one', run_in_background: true })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'two', description: 'job two', run_in_background: true })
  await clock.settle()
  await $.prompt.submit({ text: note('j2', 'completed', 'Background command "two" completed (exit code 0)'), origin: { kind: 'task-notification' }, wait: false })
  await clock.advance(1500)

  const ui = await $.ui.mount(viewing())
  expect(await ui.find({ type: 'Text', text: /from one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /job one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  await ui.unmount()
})

test('when every task has ended the pane closes 10 seconds later, failures included', async ($, on) => {
  const clock = mock.clock(on)
  const closed = twoJobs(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'one', description: 'job one', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'two', description: 'job two', run_in_background: true })
  await clock.settle()
  const origin = { kind: 'task-notification' } as const
  await $.prompt.submit({ text: note('j1', 'failed', 'Background command "one" failed with exit code 1'), origin, wait: false })
  await $.prompt.submit({ text: note('j2', 'failed', 'Background command "two" failed with exit code 2'), origin, wait: false })
  await clock.settle()
  await clock.advance(5000)
  expect(closed).toEqual([])
  await clock.advance(6000)
  expect(closed).toContain('console-log')
})

test('an agent opened below takes the pane until the view goes back to main', async ($, on) => {
  const clock = mock.clock(on)
  let status: AgentStatus = 'running'
  const closed: string[] = []
  agentSetup(on, () => [{ id: 'ag1', status }], () => TRANSCRIPT_FIXTURE)
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b7' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, prompt: 'Find the refresh token', description: 'explore auth', subagentType: 'Explore' })
  await clock.settle()
  await $.tool.call({ tool: 'Bash', command: 'sleep 60', description: 'nap', run_in_background: true })
  await clock.settle()

  let ui = await $.ui.mount(viewing())
  expect(await ui.find({ type: 'Text', text: /nap/ })).toBeDefined()
  await ui.unmount()

  ui = await $.ui.mount(viewing('ag1'))
  expect(await ui.find({ type: 'Text', text: /TRANSCRIPT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /in view/ })).toBeDefined()
  await ui.unmount()
  await clock.settle()

  status = 'completed'
  await clock.advance(12000)
  expect(closed).toEqual([])
  ui = await $.ui.mount(viewing('ag1'))
  expect(await ui.find({ type: 'Text', text: /Explore·explore auth/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ Find the refresh token/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✓/ })).toBeDefined()
  await ui.unmount()

  ui = await $.ui.mount(viewing())
  await ui.unmount()
  await clock.advance(1500)
  ui = await $.ui.mount(viewing())
  expect(await ui.find({ type: 'Text', text: /nap/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /OUTPUT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore·explore auth/ })).toBeUndefined()
  await ui.unmount()
})

test('an agent the pane never tracked still shows its transcript when opened below', async ($, on) => {
  const clock = mock.clock(on)
  agentSetup(on, () => [], () => TRANSCRIPT_FIXTURE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()

  let ui = await $.ui.mount(viewing('ag1'))
  await ui.unmount()
  await clock.settle()
  ui = await $.ui.mount(viewing('ag1'))
  expect(await ui.find({ type: 'Text', text: /in view/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ Find the refresh token/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No background tasks yet\./ })).toBeUndefined()
  await ui.unmount()
})
```

- [x] **Step 2: run them, watch them fail.** `claude plugin test .`. Усі п'ять нових тестів мають бути `(fail)`, бо поведінки ще немає: є `BACKGROUND`, немає `2 running` і `in view`, панель не закривається на `✗`. Решта тестів `(pass)`.

---

### Task 1: модель, `pick` і `sweep`

**Writes:** `types/index.d.ts`, `hooks/tasks.ts`, `hooks/tasks.test.ts`
**Reads:** `docs/sdd/specs/2026-10-23-follow-view.md` §3.1, §3.3
**Depends on:** Task 0
**Interfaces:**
- Produces:
  - `Board = { tasks: ConsoleTask[] }`;
  - `ConsoleTask.endedAt?: number`; поля `viewed` і `Board.selected` прибрано;
  - `addTask(board, task)`;
  - `applyNotification(board, n, now)`;
  - `expireTasks(board, now, graceMs)`;
  - `syncAgents(board, infos, now)`;
  - `hasRunning(board)`;
  - `unseenAgents(board, infos)`;
  - `pick(board, view: string): ConsoleTask | undefined`;
  - `sweep(board, now, view: string, graceMs): Board`;
  - стан `view: string`.
  - Прибрано `selectTask`, `dropTask`, а також стан `selected` і `hasCtrlArrows`.
- Consumes: —

- [x] **Step 1: write the failing test.** Повністю замінити `hooks/tasks.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

import type { Board, ConsoleTask } from '../types'
import { addTask, applyNotification, expireTasks, hasRunning, MAX_TASKS, pick, sweep, syncAgents, unseenAgents } from './tasks'

const t = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id, kind: 'shell', command: id, startedAt: 0, ...extra })
const ag = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => t(id, { kind: 'agent', ...extra })
const b = (...tasks: ConsoleTask[]): Board => ({ tasks })

test('addTask appends, replaces a task with the same id and keeps the last 20', async () => {
  let x = b()
  for (let i = 0; i < MAX_TASKS + 2; i++) x = addTask(x, t(`b${i}`))
  expect(x.tasks.length).toBe(MAX_TASKS)
  expect(x.tasks[0]?.id).toBe('b2')
  const again = addTask(b(t('a', { status: 'completed', endedAt: 5 }), t('c')), t('a', { startedAt: 9 }))
  expect(again.tasks.map(y => [y.id, y.status, y.endedAt])).toEqual([['c', undefined, undefined], ['a', undefined, undefined]])
})

test('applyNotification sets status, exit code and endedAt once', async () => {
  const x = b(t('a'), t('c'))
  const failed = applyNotification(x, { id: 'a', status: 'failed', exitCode: 1 }, 700)
  expect(failed.tasks[0]).toEqual({ ...t('a'), status: 'failed', exitCode: 1, endedAt: 700 })
  expect(applyNotification(failed, { id: 'a', status: 'failed', exitCode: 1 }, 900).tasks[0]?.endedAt).toBe(700)
  expect(applyNotification(x, { id: 'zz', status: 'failed' }, 1)).toBe(x)
})

test('expireTasks marks running tasks past deadline plus grace as expired and stamps endedAt', async () => {
  const x = b(t('a', { deadline: 1000 }), t('b', { deadline: 9000 }), t('c'), t('d', { deadline: 1000, status: 'failed', endedAt: 3 }))
  const next = expireTasks(x, 7000, 5000)
  expect(next.tasks.map(y => [y.status, y.endedAt])).toEqual([['expired', 7000], [undefined, undefined], [undefined, undefined], ['failed', 3]])
  expect(expireTasks(x, 6000, 5000)).toBe(x)
})

test('hasRunning is true while any task has no status', async () => {
  expect(hasRunning(b(t('a', { status: 'completed' }), t('b')))).toBe(true)
  expect(hasRunning(b(t('a', { status: 'failed' })))).toBe(false)
})

test('syncAgents gives an agent its final status and endedAt from the list', async () => {
  const after = syncAgents(b(ag('a'), ag('b'), ag('c')), [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'killed' }], 400)
  expect(after.tasks.map(x => [x.status, x.endedAt])).toEqual([['completed', 400], ['failed', 400], ['killed', 400]])
})

test('syncAgents marks an agent the list no longer has as killed', async () => {
  expect(syncAgents(b(ag('a')), [], 50).tasks[0]).toEqual({ ...ag('a'), status: 'killed', endedAt: 50 })
})

test('syncAgents leaves pending, running, waiting and idle agents, shells and finished agents alone', async () => {
  const x = b(ag('a'), ag('b'), ag('c'), ag('p'), t('s'), ag('d', { status: 'failed', endedAt: 1 }))
  const infos = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'waiting' },
    { id: 'c', status: 'idle' },
    { id: 'p', status: 'pending' },
    { id: 'd', status: 'completed' },
  ]
  expect(syncAgents(x, infos, 9)).toBe(x)
})

test('unseenAgents keeps live subagents the board lacks and skips teammates and finished ones', async () => {
  const infos = [
    { id: 'known', status: 'running', type: 'Explore' },
    { id: 'new', status: 'running', type: 'general-purpose' },
    { id: 'wait', status: 'pending', type: 'Explore' },
    { id: 'done', status: 'completed', type: 'Explore' },
    { id: 'mate', status: 'running', type: 'teammate' },
    { id: 'named', status: 'idle', type: 'Explore', teammateId: 'bob@crew' },
  ]
  expect(unseenAgents(b(ag('known')), infos).map(i => i.id)).toEqual(['new', 'wait'])
})

test('pick prefers the newest running task, the later one on a tie', async () => {
  expect(pick(b(t('a', { startedAt: 5 }), t('c', { startedAt: 9 }), t('d', { startedAt: 7 })), '')?.id).toBe('c')
  expect(pick(b(t('a', { startedAt: 5 }), t('c', { startedAt: 5 })), '')?.id).toBe('c')
})

test('pick prefers a running task over a newer finished one, then the last finished', async () => {
  expect(pick(b(t('a', { startedAt: 1 }), t('c', { startedAt: 9, status: 'completed', endedAt: 10 })), '')?.id).toBe('a')
  expect(pick(b(t('a', { status: 'failed', endedAt: 20 }), t('c', { startedAt: 9, status: 'completed', endedAt: 10 })), '')?.id).toBe('a')
  expect(pick(b(), '')).toBeUndefined()
})

test('pick gives the agent in view priority, known or not', async () => {
  expect(pick(b(ag('x', { startedAt: 1, status: 'completed', endedAt: 2 }), t('s', { startedAt: 9 })), 'x')?.id).toBe('x')
  expect(pick(b(t('s')), 'ghost')).toEqual({ id: 'ghost', kind: 'agent', command: 'agent', label: 'agent', startedAt: 0 })
})

test('sweep drops a finished task once its grace has passed, never a running one or the one in view', async () => {
  const x = b(t('run'), t('old', { status: 'completed', endedAt: 0 }), t('new', { status: 'failed', endedAt: 5000 }), ag('v', { status: 'killed', endedAt: 0 }))
  expect(sweep(x, 10000, 'v', 10000).tasks.map(y => y.id)).toEqual(['run', 'new', 'v'])
  expect(sweep(x, 15000, '', 10000).tasks.map(y => y.id)).toEqual(['run'])
  expect(sweep(x, 9999, 'v', 10000)).toBe(x)
})
```

- [x] **Step 2: run it, watch it fail.** `claude plugin test hooks/tasks.test.ts`. Очікувано: помилка імпорту, бо `pick`/`sweep` не експортовані.

- [x] **Step 3: implement.** Повністю замінити `types/index.d.ts`:

```ts
export type ConsoleTask = {
  id: string
  kind: 'shell' | 'monitor' | 'agent'
  command: string
  label?: string
  path?: string
  startedAt: number
  endedAt?: number
  deadline?: number
  status?: string
  exitCode?: number
}

export type Board = { tasks: ConsoleTask[] }

export type TaskNotification = { id: string; status: string; exitCode?: number }

export type OutLine = { text: string; tone: 'text' | 'tool' | 'result' | 'error' | 'muted' }

declare module 'claude-code' {
  interface PluginState {
    'console-log': {
      tasks: ConsoleTask[]
      view: string
      lines: Shaped<OutLine[]>
      pathMissing: boolean
      readFailed: boolean
      dismissed: boolean
    }
  }
}
```

Повністю замінити `hooks/tasks.ts`:

```ts
import type { Board, ConsoleTask, TaskNotification } from '../types'

export const MAX_TASKS = 20

export function addTask(board: Board, task: ConsoleTask): Board {
  return { tasks: [...board.tasks.filter(x => x.id !== task.id), task].slice(-MAX_TASKS) }
}

export function applyNotification(board: Board, n: TaskNotification, now: number): Board {
  if (!board.tasks.some(x => x.id === n.id)) return board
  return { tasks: board.tasks.map(x => (x.id === n.id ? { ...x, status: n.status, exitCode: n.exitCode, endedAt: x.endedAt ?? now } : x)) }
}

export function hasRunning(board: Board): boolean {
  return board.tasks.some(x => !x.status)
}

export function expireTasks(board: Board, now: number, graceMs: number): Board {
  const late = (x: ConsoleTask) => !x.status && x.deadline !== undefined && x.deadline + graceMs < now
  if (!board.tasks.some(late)) return board
  return { tasks: board.tasks.map(x => (late(x) ? { ...x, status: 'expired', endedAt: now } : x)) }
}

const AGENT_FINAL = new Set(['completed', 'failed', 'killed'])

export function syncAgents(board: Board, infos: readonly { id: string; status: string }[], now: number): Board {
  let changed = false
  const tasks = board.tasks.map(x => {
    if (x.kind !== 'agent' || x.status) return x
    const info = infos.find(i => i.id === x.id)
    const status = !info ? 'killed' : AGENT_FINAL.has(info.status) ? info.status : undefined
    if (!status) return x
    changed = true
    return { ...x, status, endedAt: now }
  })
  return changed ? { tasks } : board
}

export function unseenAgents<T extends { id: string; status: string; type: string; teammateId?: string }>(
  board: Board,
  infos: readonly T[],
): T[] {
  return infos.filter(
    i => !i.teammateId && i.type !== 'teammate' && !AGENT_FINAL.has(i.status) && !board.tasks.some(x => x.id === i.id),
  )
}

export function pick(board: Board, view: string): ConsoleTask | undefined {
  if (view) return board.tasks.find(x => x.id === view) ?? { id: view, kind: 'agent', command: 'agent', label: 'agent', startedAt: 0 }
  let best: ConsoleTask | undefined
  for (const x of board.tasks) if (!x.status && (!best || x.startedAt >= best.startedAt)) best = x
  if (best) return best
  for (const x of board.tasks) if (!best || (x.endedAt ?? 0) >= (best.endedAt ?? 0)) best = x
  return best
}

export function sweep(board: Board, now: number, view: string, graceMs: number): Board {
  const tasks = board.tasks.filter(x => !x.status || x.id === view || (x.endedAt ?? 0) + graceMs > now)
  return tasks.length === board.tasks.length ? board : { tasks }
}
```

- [x] **Step 4: run it, watch it pass.** `claude plugin test hooks/tasks.test.ts`, очікувано `0 fail`.

---

### Task 2: заголовок замість вкладок у `layout.ts`

**Writes:** `hooks/layout.ts`, `hooks/layout.test.ts`
**Depends on:** Task 0
**Interfaces:**
- Produces:
  - `taskLabel(task): string`: `label ?? command` зі стиснутими пробілами, без обрізання;
  - `headLine(label, tail, width): string`: рядок рівно `width` символів; `label` обрізається через `fit`, `tail` ставиться в кінець і обрізається, лише якщо сам ширший за `width`.
- Прибрано: `LABEL_MAX`, `tabLabel`, `tabWidth`, `tabWindow`, `paneHint`. Без змін: `fit`, `topParts`, `bottomParts`, `age`, `mark`, `statusText`.
- Consumes: —

- [x] **Step 1: write the failing test.** У `hooks/layout.test.ts`:
  - замінити рядок імпорту на `import { age, bottomParts, fit, headLine, mark, statusText, taskLabel, topParts } from './layout'`;
  - видалити тести `'tab label prefers the description and caps at 22 chars'`, `'tab window keeps the selected tab inside the budget'`, `'pane hint depends on focus and on the ctrl+arrow binding'`;
  - у `'frame lines are exactly the pane width'` замінити `['BACKGROUND', '3 tasks']` на `['TRANSCRIPT', 'running · 3 running']`;
  - дописати в кінець:

```ts
test('task label prefers the description and collapses whitespace without capping', async () => {
  expect(taskLabel(t({ label: 'jest db tests' }))).toBe('jest db tests')
  expect(taskLabel(t())).toBe('pnpm exec jest --selectProjects db --runInBand')
})

test('head line is exactly the width and keeps the tail', async () => {
  for (const width of [20, 60, 96]) {
    const line = headLine('general-purpose·Verify shadow filter integrity', '   1m02s · in view', width)
    expect(line.length).toBe(width)
    expect(line.endsWith('1m02s · in view')).toBe(true)
  }
  expect(headLine('abc', '', 6)).toBe('abc   ')
  expect(headLine('abc', 'x'.repeat(10), 4)).toBe('xxx…')
})
```

- [x] **Step 2: run it, watch it fail.** `claude plugin test hooks/layout.test.ts`. Очікувано: помилка імпорту `headLine`/`taskLabel`.

- [x] **Step 3: implement.** У `hooks/layout.ts`:
  - видалити `LABEL_MAX`, `tabLabel`, `tabWidth`, `tabWindow`, `paneHint`;
  - дописати:

```ts
export function taskLabel(task: ConsoleTask): string {
  return (task.label ?? task.command).replace(/\s+/g, ' ').trim()
}

export function headLine(label: string, tail: string, width: number): string {
  if (tail.length >= width) return fit(tail, width)
  return `${fit(label, width - tail.length)}${tail}`
}
```

- [x] **Step 4: run it, watch it pass.** `claude plugin test hooks/layout.test.ts`, очікувано `0 fail`.

---

### Task 3: `register.tsx` іде за `view` і найновішою задачею

**Writes:** `hooks/register.tsx`, `hooks/pane.test.tsx`
**Reads:** `hooks/tasks.ts`, `hooks/layout.ts`, `types/index.d.ts`
**Depends on:** Task 0, Task 1, Task 2
**Interfaces:**
- Consumes: from Task 1, `addTask`, `applyNotification(b, n, now)`, `expireTasks`, `pick(b, view)`, `sweep(b, now, view, graceMs)`, `syncAgents(b, infos, now)` and `unseenAgents`; from Task 2, `headLine` and `taskLabel`; plus `age`, `bottomParts`, `fit`, `mark`, `statusText` and `topParts`.
- Produces: —
**Satisfies:** усі п'ять тестів Task 0, а також наявні тести `pane.test.tsx`.

- [ ] **Step 1: update the old tests that rely on tabs.** In `hooks/pane.test.tsx`, edit only these three tests:
  - `'a background Bash call becomes a tab with its live output'`: rename it to `'a background Bash call shows its live output'`. Replace `text: /BACKGROUND/` with `text: /OUTPUT/` (the `toBe(100)` length check on that line stays). Remove the line `expect(await ui.find({ type: 'Text', text: /ctrl\+x tab focus/ })).toBeDefined()`.
  - `'two tasks failing together both keep their status'`: replace `expect((await ui.findAll({ type: 'Text', text: /^✗/ })).length).toBe(2)` with two lines: `expect(await ui.find({ type: 'Text', text: /^✗/ })).toBeDefined()` and `expect(await ui.find({ type: 'Text', text: /0 running/ })).toBeDefined()`.
  - `'a shell the person backgrounds from bash mode becomes a tab'`: change `text: /1 task/` to `text: /1 running/`.

- [ ] **Step 2: run them, watch them fail.** Run `claude plugin test hooks/pane.test.tsx`. Expect `(fail)`: either `register.tsx` does not compile (removed imports), or `OUTPUT`/`running`/`in view` are missing.

- [ ] **Step 3: implement.** Replace `hooks/register.tsx` with:

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, ConsoleTask, OutLine } from '../types'
import { age, bottomParts, fit, headLine, mark, statusText, taskLabel, topParts } from './layout'
import { parseBashInput, parseTaskNotification, parseUserBackground } from './notification'
import { sanitize } from './sanitize'
import { addTask, applyNotification, expireTasks, pick, sweep, syncAgents, unseenAgents } from './tasks'
import { agentLines } from './transcript'

const PANE = 'console-log'
const TITLE = 'Background output'
const COLUMNS = 100
const LINES = 200
const LINE_MAX = 500
const POLL_MS = 1000
const TAIL_TIMEOUT_MS = 2000
const DROP_COMPLETED_MS = 10000
const FIND_TIMEOUT_MS = 1000
const MONITOR_DEFAULT_MS = 300000
const MONITOR_MAX_MS = 1800000
const EXPIRE_GRACE_MS = 5000

const tasks = atom({ plugin: 'console-log', key: 'tasks' } as const, [] as ConsoleTask[])
const view = atom({ plugin: 'console-log', key: 'view' } as const, '')
const lines = atom({ plugin: 'console-log', key: 'lines' } as const, [] as OutLine[], { shape: 'out-lines' })
const pathMissing = atom({ plugin: 'console-log', key: 'pathMissing' } as const, false)
const readFailed = atom({ plugin: 'console-log', key: 'readFailed' } as const, false)
const dismissed = atom({ plugin: 'console-log', key: 'dismissed' } as const, false)

let timer: Timer | undefined
let busy = false
let pending = false
let chain: Promise<unknown> = Promise.resolve()
let lastBashInput: string | undefined

async function board($: EngineInterface): Promise<Board> {
  return { tasks: await read($, tasks) }
}

function mutate($: EngineInterface, fn: (b: Board) => Board): Promise<Board> {
  const run = chain.then(async () => {
    const before = await board($)
    const after = fn(before)
    if (after !== before) await update($, tasks, () => after.tasks)
    return after
  })
  chain = run.catch(() => undefined)
  return run
}

async function load($: EngineInterface) {
  const task = pick(await board($), await read($, view))
  if (task?.kind === 'agent') {
    await update($, pathMissing, () => false)
    try {
      const found = await $.session.messages({ agentId: task.id })
      if ('deny' in found) {
        await update($, readFailed, () => true)
        return
      }
      const next = agentLines(found).map(l => ({ ...l, text: sanitize(l.text).slice(0, LINE_MAX) }))
      await update($, readFailed, () => false)
      await update($, lines, () => next)
    } catch {
      await update($, readFailed, () => true)
    }
    return
  }
  if (!task?.path) {
    await update($, pathMissing, () => Boolean(task))
    await update($, readFailed, () => false)
    await update($, lines, () => [])
    return
  }
  await update($, pathMissing, () => false)
  try {
    const { exitCode, stdout } = await $.process.run(['tail', '-n', String(LINES), task.path], { timeoutMs: TAIL_TIMEOUT_MS })
    if (exitCode !== 0) {
      await update($, readFailed, () => true)
      return
    }
    const next = stdout.split('\n')
    if (next.at(-1) === '') next.pop()
    await update($, readFailed, () => false)
    await update($, lines, () => next.map((l): OutLine => ({ text: sanitize(l).slice(0, LINE_MAX), tone: 'text' })))
  } catch {
    await update($, readFailed, () => true)
  }
}

async function refresh($: EngineInterface) {
  if (await read($, dismissed)) return
  if (busy) {
    pending = true
    return
  }
  busy = true
  try {
    await load($)
  } finally {
    busy = false
    if (pending) {
      pending = false
      await refresh($).catch(() => undefined)
    }
  }
}

async function syncAgentStatus($: EngineInterface) {
  if (!(await board($)).tasks.some(x => x.kind === 'agent' && !x.status)) return
  let infos: { id: string; status: string }[]
  try {
    infos = await $.agent.list()
  } catch {
    return
  }
  const now = await $.clock.now()
  await mutate($, b => syncAgents(b, infos, now))
}

async function poll($: EngineInterface) {
  await syncAgentStatus($)
  const now = await $.clock.now()
  const v = await read($, view)
  const b = await mutate($, x => sweep(expireTasks(x, now, EXPIRE_GRACE_MS), now, v, DROP_COMPLETED_MS))
  if (b.tasks.length > 0 || v) {
    await refresh($)
    return
  }
  timer?.cancel()
  timer = undefined
  await update($, lines, () => [])
  await $.ui.close({ id: PANE })
  if ((await board($)).tasks.length > 0) {
    tick($)
    await openPane($)
    await refresh($)
  }
}

function tick($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
}

async function openPane($: EngineInterface) {
  if (await read($, dismissed)) return
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

// TaskStop ends a task without a <task-notification>, so this is the only signal that it is gone
async function stop($: EngineInterface, id: string) {
  const now = await $.clock.now()
  const b = await mutate($, x => applyNotification(x, { id, status: 'killed' }, now))
  if (b.tasks.some(x => x.id === id)) await refresh($)
}

function clean(raw: string): string {
  return sanitize(raw.replace(/\s+/g, ' ').trim())
}

async function findOutput($: EngineInterface, id: string): Promise<string | undefined> {
  const session = await $.session.id()
  const scoped = await $.process.run(
    ['sh', '-c', 'ls -t "${TMPDIR:-/tmp}"/claude-"$(id -u)"/*/"$1"/tasks/"$2".output 2>/dev/null | head -1', '_', session, id],
    { timeoutMs: FIND_TIMEOUT_MS },
  )
  const hit = scoped.stdout.trim()
  if (hit) return hit
  const wide = await $.process.run(
    ['sh', '-c', 'ls -t "${TMPDIR:-/tmp}"/claude-"$(id -u)"/*/*/tasks/"$1".output 2>/dev/null | head -1', '_', id],
    { timeoutMs: FIND_TIMEOUT_MS },
  )
  return wide.stdout.trim() || undefined
}

async function track(
  $: EngineInterface,
  seed: Omit<ConsoleTask, 'path' | 'startedAt' | 'deadline'>,
  timeoutMs: number | undefined,
  known?: string,
) {
  const startedAt = await $.clock.now()
  const deadline = timeoutMs === undefined ? undefined : startedAt + timeoutMs
  await mutate($, b => addTask(b, { ...seed, startedAt, deadline }))
  await update($, lines, () => [])
  await update($, readFailed, () => false)
  tick($)
  const path = seed.kind === 'agent' ? undefined : (known ?? (await findOutput($, seed.id).catch(() => undefined)))
  if (path) await mutate($, b => ({ tasks: b.tasks.map(x => (x.id === seed.id ? { ...x, path } : x)) }))
  await refresh($)
  await openPane($)
}

function monitorTimeout(result: number | undefined, input: number | undefined, persistent: boolean | undefined): number | undefined {
  if (persistent || result === 0) return undefined
  if (result !== undefined && result > 0) return result
  return Math.min(input && input > 0 ? input : MONITOR_DEFAULT_MS, MONITOR_MAX_MS)
}

async function spawned($: EngineInterface, e: { subagentType: string; description: string }, id: string) {
  const type = clean(e.subagentType)
  const desc = clean(e.description) || type
  await track($, { id, kind: 'agent', command: `${type}: ${desc}`, label: `${type}·${desc}` }, undefined)
}

async function adoptAgents($: EngineInterface) {
  const infos = await $.agent.list()
  for (const i of unseenAgents(await board($), infos)) await spawned($, { subagentType: i.type, description: i.description }, i.id)
}

const TONE: Record<OutLine['tone'], { color?: string; dim?: boolean }> = {
  text: {},
  tool: { color: 'cyan' },
  result: { dim: true },
  error: { color: 'red' },
  muted: { dim: true },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'console-log', description: 'Open the background output pane' })
    if ((await board($)).tasks.length > 0) tick($)
    const r = await next(e)
    void adoptAgents($).catch(() => undefined)
    return r
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    if (e.tool === 'TaskStop') {
      const id = (ran.result as { task_id?: string }).task_id
      if (id) void stop($, id).catch(() => undefined)
      return ran
    }
    if (e.tool !== 'Bash' && e.tool !== 'Monitor') return ran
    if (e.agentId !== undefined) return ran
    const r = ran.result as {
      backgroundTaskId?: string
      backgroundEndsWithFinalResponse?: true
      taskId?: string
      timeoutMs?: number
      persistent?: boolean
    }
    if (r.backgroundEndsWithFinalResponse) return ran
    const id = e.tool === 'Bash' ? r.backgroundTaskId : r.taskId
    if (!id) return ran
    const command = clean(e.tool === 'Bash' ? e.command : `monitor: ${e.description}`)
    const described = e.tool === 'Bash' ? e.description?.trim() : undefined
    const seed = {
      id,
      kind: e.tool === 'Bash' ? 'shell' : 'monitor',
      command,
      label: e.tool === 'Monitor' ? command : described ? clean(described) : undefined,
    } as const
    const timeout = e.tool === 'Monitor' ? monitorTimeout(r.timeoutMs, e.timeout_ms, r.persistent) : undefined
    void track($, seed, timeout).catch(() => undefined)
    return ran
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId && !e.workflow && !e.isTeammate) void spawned($, e, r.agentId).catch(() => undefined)
    return r
  })

  on('session.append', async ($, e, next) => {
    if (e.agentId !== undefined || e.message.type !== 'user') return next(e)
    const text = e.message.content.map(c => (c.type === 'text' ? c.text : '')).join('\n')
    const input = parseBashInput(text)
    if (input) lastBashInput = input
    const bg = parseUserBackground(text)
    if (bg && !(await board($)).tasks.some(x => x.id === bg.id)) {
      const command = clean(lastBashInput ?? bg.id)
      lastBashInput = undefined
      void track($, { id: bg.id, kind: 'shell', command }, undefined, bg.path).catch(() => undefined)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const n = parseTaskNotification(e.text)
      if (n) {
        const now = await $.clock.now()
        const b = await mutate($, x => applyNotification(x, n, now))
        if (b.tasks.some(x => x.id === n.id)) await refresh($)
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async () => ({})).catch(() => ({}))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await update($, dismissed, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'console-log' }, async $ => {
    await update($, dismissed, () => false)
    await adoptAgents($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    void refresh($).catch(() => undefined)
    return { text: 'Background output pane opened.' }
  }).catch(() => ({ text: 'console-log: could not open the pane.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const seen = e.props.view.agentId ?? ''
    if (seen !== (await read($, view))) {
      await update($, view, () => seen)
      await update($, lines, () => [])
      await update($, readFailed, () => false)
      tick($)
      void refresh($).catch(() => undefined)
    }
    const list = await read($, tasks)
    const task = pick({ tasks: list }, seen)
    const body = await read($, lines)
    const missing = await read($, pathMissing)
    const failed = await read($, readFailed)
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
    const row = (line: OutLine, key: string) => (
      <Text key={key} wrap="truncate">
        <Text color="gray">│ </Text>
        <Text color={TONE[line.tone].color} dimColor={TONE[line.tone].dim}>{fit(line.text, inner)}</Text>
        <Text color="gray"> │</Text>
      </Text>
    )

    if (!task) {
      return (
        <Box flexDirection="column" width={W} height={R} backgroundColor="black">
          {top('OUTPUT', '')}
          <Box flexDirection="row">
            <Text color="gray">│ </Text>
            <Box width={inner}><Text dimColor>No background tasks yet.</Text></Box>
            <Text color="gray"> │</Text>
          </Box>
          {bottom('')}
        </Box>
      )
    }

    const isAgent = task.kind === 'agent'
    const running = list.filter(x => !x.status).length
    const right = `${statusText(task)}${failed ? (isAgent ? ' · transcript unavailable' : ' · file unavailable') : ''} · ${running} running`
    const known = list.some(x => x.id === task.id)
    const tail = `${known ? `   ${age(task.startedAt, now)}` : ''}${seen ? ' · in view' : ''}`
    const m = mark(task)
    const room = R - 3
    const out: OutLine[] = missing ? [{ text: 'output file not found', tone: 'muted' }] : body.slice(-room)
    while (out.length < room) out.push({ text: '', tone: 'text' })

    return (
      <Box flexDirection="column" width={W} height={R} backgroundColor="black">
        {top(isAgent ? 'TRANSCRIPT' : 'OUTPUT', right)}
        <Text wrap="truncate">
          <Text color="gray">│ </Text>
          <Text color={m.color}>{m.glyph} </Text>
          <Text color="cyan" bold>{headLine(taskLabel(task), tail, inner - 2)}</Text>
          <Text color="gray"> │</Text>
        </Text>
        {out.map((l, i) => row(l, `o${i}`))}
        {bottom(task.command)}
      </Box>
    )
  })
}
```

- [ ] **Step 4: run it, watch it pass.** Run `claude plugin test .` and expect `0 fail`: all of Task 0's tests plus every older test. Then `npx -y -p typescript tsc -p . --noEmit` should give exit 0 with no output.

---

### Task 4: README and version

**Writes:** `README.md`, `.claude-plugin/plugin.json`
**Depends on:** Task 0
**Interfaces:** none

- [x] **Step 1: version.** In `.claude-plugin/plugin.json`, change `"version": "0.2.1"` to `"version": "0.3.0"`.
- [x] **Step 2: English README.**
  - Delete the whole `## Keys` section, from its heading up to `## Behaviour`.
  - In the opening paragraph, replace `Each subagent gets a tab too, with its transcript.` with `Subagents show there too, with their transcripts.`
  - Replace the `## Behaviour` list with:

```markdown
- The pane shows one task at a time and follows the newest one that is still running, a background Bash or Monitor task or a subagent. When it ends, the pane moves to the next newest running task.
- Open a subagent in the task list under the prompt (the standard Claude Code list) and the pane shows that subagent, marked `in view`, until you go back to `main`. Claude Code also switches the main view to that subagent; a mod cannot keep the main view on the conversation.
- A subagent's body, framed `TRANSCRIPT`, shows the first line of its prompt (`▸`), its text, each tool call as `→ Tool: argument`, and up to three lines of each tool result (`… +N lines` for the rest, `✗` on an error, `…` while the tool runs). A shell or Monitor task is framed `OUTPUT`.
- The top line shows the task's status and how many tasks are running; the next line shows `◐` running, `✓` completed, `✗` failed or `■` another end state, then the task's label and age.
- A command you run with `!` and then send to the background shows there too.
- A Monitor that runs past its timeout shows `■` and `expired`. A subagent the session no longer lists shows `■` and `killed`.
- A finished task leaves 10 seconds after it ends. When no tasks are left, the pane closes.
- If you close the pane with its `✕`, it stays closed until you run `/console-log`.
- In the fullscreen layout, a pane the mod opens on its own docks beside the chat from 144 terminal columns. Below that, run `/console-log` once; after that the pane docks from 110 columns.
```

  - In `## Limits`:
    - replace `Subagents already running when the mod loads, or when you run `/console-log`, get a tab too.` with `Subagents already running when the mod loads, or when you run `/console-log`, show too.`;
    - replace `Workflow agents and teammates get no tab.` with `Workflow agents and teammates show only when you open them in the task list.`;
    - add:

```markdown
- Picking a background process in the task list opens Claude Code's own dialog; the pane does not follow it.
- While the pane is closed it does not see what you open in the task list; `/console-log` opens it on the agent in view.
```

- [x] **Step 3: Ukrainian README.** Under `## Українською`:
  - delete the whole `### Клавіші` section;
  - in the opening paragraph, replace the sentence about subagent tabs with `Субагенти теж показуються там, зі своїми транскриптами.`;
  - replace the `### Поведінка` list with:

```markdown
- Панель показує одну задачу й іде за найновішою, що ще працює: фоновою Bash чи Monitor або субагентом. Коли вона завершується, панель переходить до наступної найновішої.
- Відкрийте субагента в списку задач під промптом (стандартний список Claude Code), і панель показує його з позначкою `in view`, поки ви не повернетесь на `main`. Основне вікно Claude Code теж перемикає на цього субагента; мод не може втримати його на розмові.
- Тіло субагента в рамці `TRANSCRIPT` показує перший рядок промпту (`▸`), його текст, кожен виклик тула як `→ Tool: аргумент` і до трьох рядків результату (`… +N lines` для решти, `✗` на помилці, `…`, поки тул працює). Shell чи Monitor — у рамці `OUTPUT`.
- Верхній рядок показує статус задачі й скільки задач працює; наступний — `◐` працює, `✓` завершено, `✗` помилка, `■` інший кінець, далі назву й вік задачі.
- Команда, яку ви запустили через `!` і відправили у фон, теж показується.
- Monitor, що пережив свій timeout, показує `■` і `expired`. Субагент, якого сесія більше не має у списку, показує `■` і `killed`.
- Завершена задача зникає через 10 секунд після кінця. Коли задач не лишилось, панель закривається.
- Якщо закрити панель її `✕`, вона лишається закритою до `/console-log`.
- У fullscreen-розкладці панель, яку мод відкриває сам, стає поруч із чатом від 144 колонок терміналу. Вужче — один раз виконайте `/console-log`, після цього панель стає поруч від 110 колонок.
```

  - in `### Обмеження`, apply the same three changes as in English:
    - the sentence about running subagents at load → `Субагенти, що вже працюють, коли мод завантажується або коли ви виконуєте `/console-log`, теж показуються.`;
    - workflow/teammates → `Агенти воркфлоу й teammates показуються, лише коли ви відкриваєте їх у списку задач.`;
    - append the two lines:

```markdown
- Вибір фонового процесу в списку задач відкриває власний діалог Claude Code; панель за ним не йде.
- Поки панель закрита, вона не бачить, що ви відкриваєте в списку задач; `/console-log` відкриває її на агенті, який зараз відкритий.
```

- [x] **Step 4: check.** Run `grep -n -E "ctrl\+→|abovePrompt|keybindings|tab" README.md`. Expect no line about the tab row or the keys (the word `table` does not appear in the file).

---

## End-to-end verification (after wave 2)
1. `claude plugin test .` → `0 fail`.
2. `npx -y -p typescript tsc -p . --noEmit` → exit 0.
3. `claude plugin validate .` → `✔ Validation passed`.
4. Smoke test in a live Claude Code session with the mod loaded from the worktree:
   1. Start two background `general-purpose` agents a few seconds apart, plus a background `sleep 20; echo done`. The pane shows the newest one.
   2. Open the older agent in the list below. The pane shows `in view` and its transcript.
   3. Go back to `main`. The pane shows the newest running task again.
   4. Wait for everything to finish. The pane closes on its own about 10 s later.
