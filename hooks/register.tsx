import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Board, ConsoleTask } from '../types'
import { age, bottomParts, fit, mark, paneHint, statusText, tabLabel, tabWidth, tabWindow, topParts } from './layout'
import { parseTaskNotification } from './notification'
import { sanitize } from './sanitize'
import { addTask, applyNotification, dropTask, expireTasks, hasRunning, selectTask } from './tasks'

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
const selected = atom({ plugin: 'console-log', key: 'selected' } as const, -1)
const lines = atom({ plugin: 'console-log', key: 'lines' } as const, [] as string[])
const pathMissing = atom({ plugin: 'console-log', key: 'pathMissing' } as const, false)
const readFailed = atom({ plugin: 'console-log', key: 'readFailed' } as const, false)
const dismissed = atom({ plugin: 'console-log', key: 'dismissed' } as const, false)
const hasCtrlArrows = atom({ plugin: 'console-log', key: 'hasCtrlArrows' } as const, false)

let timer: Timer | undefined
let busy = false
let pending = false
let chain: Promise<unknown> = Promise.resolve()

async function board($: EngineInterface): Promise<Board> {
  return { tasks: await read($, tasks), selected: await read($, selected) }
}

async function save($: EngineInterface, b: Board) {
  await update($, tasks, () => b.tasks)
  await update($, selected, () => b.selected)
}

function mutate($: EngineInterface, fn: (b: Board) => Board): Promise<Board> {
  const run = chain.then(async () => {
    const before = await board($)
    const after = fn(before)
    if (after !== before) await save($, after)
    return after
  })
  chain = run.catch(() => undefined)
  return run
}

async function load($: EngineInterface) {
  const task = (await read($, tasks))[await read($, selected)]
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
    await update($, lines, () => next.map(l => sanitize(l).slice(0, LINE_MAX)))
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

async function poll($: EngineInterface) {
  const now = await $.clock.now()
  const b = await mutate($, x => expireTasks(x, now, EXPIRE_GRACE_MS))
  if (!hasRunning(b)) {
    await refresh($)
    timer?.cancel()
    timer = undefined
    if (hasRunning(await board($))) tick($)
    return
  }
  await refresh($)
}

function tick($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
}

async function openPane($: EngineInterface) {
  if (await read($, dismissed)) return
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

async function leave($: EngineInterface) {
  await $.ui.close({ id: PANE })
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

async function drop($: EngineInterface, id: string): Promise<Board> {
  const b = await mutate($, x => dropTask(x, id))
  if (b.tasks.length === 0) {
    await update($, lines, () => [])
    await $.ui.close({ id: PANE })
    return b
  }
  await refresh($)
  return b
}

// TaskStop ends a task without a <task-notification>, so this is the only signal that it is gone
async function stop($: EngineInterface, id: string) {
  const b = await mutate($, x => applyNotification(x, { id, status: 'killed' }))
  if (!b.tasks.some(x => x.id === id)) return
  await refresh($)
  $.clock.after(DROP_COMPLETED_MS, () => void drop($, id).catch(() => undefined))
}

async function exit($: EngineInterface) {
  const b = await board($)
  const task = b.tasks[b.selected]
  if (task?.viewed && (await drop($, task.id)).tasks.length === 0) return
  await leave($)
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

async function track($: EngineInterface, seed: Omit<ConsoleTask, 'path' | 'startedAt' | 'deadline'>, timeoutMs: number | undefined) {
  tick($)
  const startedAt = await $.clock.now()
  const deadline = timeoutMs === undefined ? undefined : startedAt + timeoutMs
  await mutate($, b => addTask(b, { ...seed, startedAt, deadline }))
  const path = await findOutput($, seed.id).catch(() => undefined)
  if (path) await mutate($, b => ({ ...b, tasks: b.tasks.map(x => (x.id === seed.id ? { ...x, path } : x)) }))
  await refresh($)
  await openPane($)
}

function monitorTimeout(result: number | undefined, input: number | undefined, persistent: boolean | undefined): number | undefined {
  if (persistent || result === 0) return undefined
  if (result !== undefined && result > 0) return result
  return Math.min(input && input > 0 ? input : MONITOR_DEFAULT_MS, MONITOR_MAX_MS)
}

async function readCtrlArrows($: EngineInterface): Promise<boolean> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return false
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
    const b = await mutate($, x => x.tasks.reduce((acc, t) => (t.status === 'completed' ? dropTask(acc, t.id) : acc), x))
    const bound = await readCtrlArrows($)
    await update($, hasCtrlArrows, () => bound)
    if (hasRunning(b)) tick($)
    return next(e)
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

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const n = parseTaskNotification(e.text)
      const b = n ? await mutate($, x => applyNotification(x, n)) : undefined
      if (n && b?.tasks.some(x => x.id === n.id)) {
        await refresh($)
        if (n.status === 'completed') $.clock.after(DROP_COMPLETED_MS, () => void drop($, n.id).catch(() => undefined))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const b = await board($)
    if (e.element === 'exit') {
      if (e.origin.kind !== 'person') return next(e)
      // ui.focus carries no direction; with one task both ctrl+arrows land on exit, so leaving is the only way out
      if (b.tasks.length > 1 && b.selected === b.tasks.length - 1) return {}
      void exit($).catch(() => undefined)
      return {}
    }
    const id = e.element?.startsWith('tab-') ? e.element.slice(4) : undefined
    const i = id ? b.tasks.findIndex(x => x.id === id) : -1
    if (i >= 0 && i !== b.selected) {
      await mutate($, x => {
        const j = x.tasks.findIndex(t => t.id === id)
        return j >= 0 ? selectTask(x, j) : x
      })
      void refresh($).catch(() => undefined)
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
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    void refresh($).catch(() => undefined)
    return { text: 'Background output pane opened.' }
  }).catch(() => ({ text: 'console-log: could not open the pane.' }))

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
