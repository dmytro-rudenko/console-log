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
const lines = atom({ plugin: 'console-log', key: 'lines' } as const, [] as OutLine[], { shape: 'out-lines' })
const pathMissing = atom({ plugin: 'console-log', key: 'pathMissing' } as const, false)
const readFailed = atom({ plugin: 'console-log', key: 'readFailed' } as const, false)
const dismissed = atom({ plugin: 'console-log', key: 'dismissed' } as const, false)

let timer: Timer | undefined
let busy = false
let pending = false
let chain: Promise<unknown> = Promise.resolve()
let lastBashInput: string | undefined
let viewing = ''

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
  const task = pick(await board($), viewing)
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
  const v = viewing
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

async function follow($: EngineInterface) {
  await update($, lines, () => [])
  await update($, readFailed, () => false)
  tick($)
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
    if (seen !== viewing) {
      viewing = seen
      // the engine refuses state writes while ui.render draws
      $.clock.after(0, () => void follow($).catch(() => undefined))
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
