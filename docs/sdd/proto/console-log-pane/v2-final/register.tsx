import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BgTask, Variant } from '../types'

const PANE = 'bg-tail'
const LINES = 200
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const tasks = atom({ plugin: 'bg-tail', key: 'tasks' } as const, [] as BgTask[])
const selected = atom({ plugin: 'bg-tail', key: 'selected' } as const, -1)
const lines = atom({ plugin: 'bg-tail', key: 'lines' } as const, [] as string[])
const offset = atom({ plugin: 'bg-tail', key: 'offset' } as const, 0)
const variant = atom({ plugin: 'bg-tail', key: 'variant' } as const, 'a' as Variant)

let busy = false
let room = 20
let ticking = false

function tick($: EngineInterface) {
  if (ticking) return
  ticking = true
  $.clock.every(1000, () => refresh($))
}

async function refresh($: EngineInterface) {
  if (busy) return
  const task = (await read($, tasks))[await read($, selected)]
  if (!task) return
  busy = true
  try {
    const { stdout } = await $.process.run(['tail', '-n', String(LINES), task.path], { timeoutMs: 2000 })
    const next = stdout.replace(ANSI, '').split('\n')
    if (next.at(-1) === '') next.pop()
    await update($, lines, () => next.map(l => l.slice(0, 500)))
  } catch {
  } finally {
    busy = false
  }
}

async function leave($: EngineInterface) {
  await $.ui.close({ id: PANE })
  await $.ui.open({ id: PANE, title: 'Background output', columns: 100 })
}

async function drop($: EngineInterface, id: string) {
  const list = await read($, tasks)
  const keepId = list[await read($, selected)]?.id
  const rest = list.filter(t => t.id !== id)
  if (rest.length === list.length) return
  await update($, tasks, () => rest)
  if (rest.length === 0) {
    await update($, selected, () => -1)
    await update($, lines, () => [])
    await $.ui.close({ id: PANE })
    return
  }
  const at = rest.findIndex(t => t.id === keepId)
  await update($, selected, () => (at >= 0 ? at : Math.min(rest.length - 1, list.findIndex(t => t.id === id))))
  await refresh($)
}

async function select($: EngineInterface, i: number) {
  const list = await read($, tasks)
  const prev = list[await read($, selected)]
  const target = list[i]
  if (target?.status && target.status !== 'completed') {
    await update($, tasks, l => l.map(t => (t.id === target.id ? { ...t, viewed: true } : t)))
  }
  if (prev && prev.id !== target?.id && prev.viewed) {
    await update($, selected, () => i)
    await drop($, prev.id)
    return
  }
  await update($, selected, () => i)
  await update($, offset, () => 0)
  await refresh($)
}

function mark(t: BgTask): { glyph: string; color: string } {
  if (!t.status) return { glyph: '◐', color: 'yellow' }
  if (t.status === 'completed') return { glyph: '✓', color: 'green' }
  if (t.status === 'failed') return { glyph: '✗', color: 'red' }
  return { glyph: '■', color: 'gray' }
}

function label(t: BgTask, n: number) {
  const c = (t.label ?? t.command).replace(/\s+/g, ' ').trim()
  return c.length > n ? `${c.slice(0, n - 1)}…` : c
}

function age(t: BgTask, now: number) {
  const s = Math.max(0, Math.round((now - t.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function statusText(t: BgTask) {
  if (!t.status) return 'running'
  return t.exitCode !== undefined ? `${t.status} · exit ${t.exitCode}` : t.status
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'console-log',
      description: 'Open the background output pane',
    })
    $.ui.status(undefined)
    const now = await $.clock.now()
    await update($, tasks, l => l.map(t => ({ ...t, kind: t.kind ?? 'shell', startedAt: t.startedAt ?? now })))
    for (const t of await read($, tasks)) if (t.status === 'completed') await drop($, t.id)
    if ((await read($, tasks)).some(t => !t.status)) tick($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const id = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]
      const status = /<status>([^<]+)<\/status>/.exec(e.text)?.[1]
      const code = /exit code (-?\d+)/.exec(e.text)?.[1]
      if (id && status) {
        const at = await read($, selected)
        await update($, tasks, l =>
          l.map((t, i) =>
            t.id === id
              ? { ...t, status, exitCode: code ? Number(code) : undefined, viewed: status !== 'completed' && i === at }
              : t,
          ),
        )
        await refresh($)
        if (status === 'completed') $.clock.after(10000, () => drop($, id))
      }
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool !== 'Bash' && e.tool !== 'Monitor') return ran
    if (ran.deny !== undefined || ran.isError) return ran
    const r = ran.result as { backgroundTaskId?: string; taskId?: string }
    const id = e.tool === 'Bash' ? r.backgroundTaskId : r.taskId
    if (!id) return ran

    const found = await $.process.run([
      'sh', '-c', 'ls -t /tmp/claude-"$(id -u)"/*/*/tasks/"$1".output 2>/dev/null | head -1', '_', id,
    ])
    const path = found.stdout.trim()
    if (!path) return ran

    const command = e.tool === 'Bash' ? e.command : `monitor: ${e.description}`
    const taskLabel = e.description?.trim() || undefined
    const startedAt = await $.clock.now()
    const list = await update($, tasks, l =>
      [...l, { id, kind: e.tool === 'Bash' ? 'shell' : 'monitor', command, label: taskLabel, path, startedAt } as BgTask].slice(-20),
    )
    await select($, list.length - 1)
    void $.ui.open({ id: PANE, title: 'Background output', columns: 100 })
    tick($)
    return ran
  })

  on('command.run', { command: 'console-log' }, async $ => {
    await update($, variant, () => 'a')
    await $.ui.open({ id: PANE, title: 'Background output', columns: 100 })
    return { text: 'Background output pane opened.' }
  })

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const list = await read($, tasks)
    const at = await read($, selected)
    if (e.element === 'exit' && e.origin.kind === 'person') {
      if (at === list.length - 1 && list.length > 1) return {}
      void leave($)
      return {}
    }
    const id = e.element?.startsWith('tab-') ? e.element.slice(4) : undefined
    if (id) {
      const i = list.findIndex(t => t.id === id)
      if (i >= 0 && i !== at) await select($, i)
    }
    return next(e)
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, tasks)
    const at = await read($, selected)
    const task = list[at]
    const body = await read($, lines)
    const off = await read($, offset)
    const v = await read($, variant)
    const now = await $.clock.now()
    const cols = Math.max(20, e.viewport?.columns ?? 80)
    const rows = Math.max(6, e.viewport?.rows ?? 24)

    const slice = (n: number) => {
      room = Math.max(1, n)
      return body.slice(Math.max(0, body.length - room - off), body.length - off)
    }
    const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))
    const top = (title: string, right: string, color: string, w: number) => (
      <Box flexDirection="row">
        <Text color={color}>╭─ </Text>
        <Text color={color} bold>{title}</Text>
        <Text color="subtle">{` ${'─'.repeat(Math.max(1, w - title.length - right.length - 7))} `}</Text>
        <Text dimColor>{right}</Text>
        <Text color="subtle"> ─╮</Text>
      </Box>
    )
    const bottom = (w: number, hint = '') => (
      <Box flexDirection="row">
        <Text color="subtle">{`╰─${hint ? ' ' : ''}`}</Text>
        <Text dimColor>{hint}</Text>
        <Text color="subtle">{`${hint ? ' ' : ''}${'─'.repeat(Math.max(1, w - hint.length - (hint ? 5 : 3)))}╯`}</Text>
      </Box>
    )
    const row = (w: number, child: unknown, key?: string) => (
      <Box flexDirection="row" key={key}>
        <Text color="subtle">│ </Text>
        <Box width={w - 4}>{child as never}</Box>
        <Text color="subtle"> │</Text>
      </Box>
    )
    const empty = <Text dimColor>No background tasks yet.</Text>
    const scrollTag = off > 0 ? `↑ ${off}` : 'following'

    if (v === 'a') {
      const W = Math.max(30, e.props.bodyColumns)
      const R = Math.max(8, e.props.scroll.bodyRows)
      const inner = W - 4
      const cut = (x: string, n: number) => (x.length > n ? `${x.slice(0, Math.max(0, n - 1))}…` : x.padEnd(n))
      const topLine = (title: string, right: string) => {
        const r = right ? ` ${right} ` : ' '
        const k = Math.max(1, W - 4 - title.length - r.length - 2)
        return (
          <Text wrap="truncate">
            <Text color="gray">╭─ </Text>
            <Text color="cyan" bold>{title}</Text>
            <Text color="gray">{` ${'─'.repeat(k)}`}</Text>
            <Text dimColor>{r}</Text>
            <Text color="gray">─╮</Text>
          </Text>
        )
      }
      const bottomLine = (hint: string) => {
        const hh = hint ? ` ${cut(hint, Math.max(0, W - 8)).trimEnd()} ` : ''
        return (
          <Text wrap="truncate">
            <Text color="gray">╰─</Text>
            <Text dimColor>{hh}</Text>
            <Text color="gray">{`${'─'.repeat(Math.max(1, W - 3 - hh.length))}╯`}</Text>
          </Text>
        )
      }
      const bodyLine = (text: string, key: string) => (
        <Text key={key} wrap="truncate">
          <Text color="gray">│ </Text>
          <Text>{cut(text, inner)}</Text>
          <Text color="gray"> │</Text>
        </Text>
      )

      const widths = list.map(t => 2 + label(t, 22).length + 1 + age(t, now).length + 3)
      let lo = Math.max(0, at)
      let hi = lo
      let used = widths[lo] ?? 0
      const budget = inner - 7
      while (true) {
        const canL = lo > 0 && used + (widths[lo - 1] ?? 0) <= budget
        const canR = hi < list.length - 1 && used + (widths[hi + 1] ?? 0) <= budget
        if (!canL && !canR) break
        if (canR) { hi += 1; used += widths[hi] ?? 0 }
        if (canL && lo > 0 && used + (widths[lo - 1] ?? 0) <= budget) { lo -= 1; used += widths[lo] ?? 0 }
      }
      const shown = list.slice(lo, hi + 1)
      const tabs = (
        <Box flexDirection="row" width={inner} overflow="hidden">
          <Button key="exit" plain label=" " onPress={() => undefined} />
          {lo > 0 && <Text dimColor>{`‹${lo} `}</Text>}
          {shown.map((t, j) => {
            const i = lo + j
            const m = mark(t)
            const isOn = i === at
            return (
              <Button
                key={`tab-${t.id}`}
                plain
                autoFocus={i === 0 ? true : undefined}
                onPress={() => undefined}
              >
                <Text color={m.color}>{m.glyph} </Text>
                <Text color={isOn ? 'cyan' : undefined} bold={isOn} underline={isOn} dimColor={!isOn}>
                  {label(t, 22)}
                </Text>
                <Text dimColor>{` ${age(t, now)}   `}</Text>
              </Button>
            )
          })}
          {hi < list.length - 1 && <Text dimColor>{`${list.length - 1 - hi}›`}</Text>}
        </Box>
      )
      const focused = e.props.isFocused
      const hint = focused ? 'ctrl+→ next · ctrl+← back' : 'ctrl+→ focus'
      const out = task ? slice(R - 5) : []
      while (task && out.length < R - 5) out.push('')
      return (
        <Box flexDirection="column" width={W} height={R} backgroundColor="black">
          {topLine('BACKGROUND', `${list.length} ${list.length === 1 ? 'task' : 'tasks'}`)}
          <Box flexDirection="row">
            <Text color="gray">│ </Text>
            {list.length ? tabs : <Box width={inner}><Text dimColor>No background tasks yet.</Text></Box>}
            <Text color="gray"> │</Text>
          </Box>
          {bottomLine(hint)}
          {task && topLine('OUTPUT', statusText(task))}
          {task && out.map((l, i) => bodyLine(l, `o${i}`))}
          {task && bottomLine(task.command)}
        </Box>
      )
    }

    if (v === 'b') {
      const side = Math.min(28, Math.max(18, Math.floor(cols * 0.3)))
      const main = cols - side
      const out = task ? slice(rows - 2) : []
      const height = Math.max(list.length, out.length, 1)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            {top('TASKS', String(list.length), 'claude', side)}
            {top('OUTPUT', task ? `${statusText(task)} · ${scrollTag}` : '', task ? mark(task).color : 'subtle', main)}
          </Box>
          {Array.from({ length: height }, (_, i) => {
            const t = list[i]
            const m = t ? mark(t) : undefined
            const isOn = i === at
            return (
              <Box flexDirection="row" key={`r${i}`}>
                {row(
                  side,
                  t && m ? (
                    <Button key={`side-${t.id}`} onPress={() => select($, i)}>
                      <Text color={m.color}>{m.glyph} </Text>
                      <Text color={isOn ? 'claude' : 'text'} bold={isOn} inverse={isOn}>{fit(label(t, side - 12), side - 12)}</Text>
                      <Text dimColor>{` ${age(t, now).padStart(5)}`}</Text>
                    </Button>
                  ) : (
                    <Text> </Text>
                  ),
                )}
                {row(main, <Text wrap="truncate">{fit(out[i] ?? '', main - 4)}</Text>)}
              </Box>
            )
          })}
          <Box flexDirection="row">
            {bottom(side)}
            {bottom(main, task ? label(task, Math.max(10, main - 12)) : '')}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {list.length === 0 && empty}
          {list.map((t, i) => {
            const m = mark(t)
            const isOn = i === at
            return (
              <Button key={`chip-${t.id}`} onPress={() => select($, i)}>
                <Text color={m.color}>{m.glyph}</Text>
                <Text color={isOn ? 'inverseText' : 'inactive'} backgroundColor={isOn ? 'claude' : undefined} bold={isOn}>
                  {` ${label(t, 16)} `}
                </Text>
                <Text color="subtle">{i < list.length - 1 ? ' │ ' : ''}</Text>
              </Button>
            )
          })}
        </Box>
        <Text color="subtle">{'─'.repeat(cols)}</Text>
        {task && slice(rows - 4).map((l, i) => <Text key={`c${i}`} wrap="truncate">{l || ' '}</Text>)}
        {task && (
          <Box flexDirection="row">
            <Text color={mark(task).color}>{`${mark(task).glyph} ${statusText(task)}`}</Text>
            <Text dimColor>{`  ·  ${age(task, now)}  ·  ${scrollTag}  ·  click a tab or /bg-tail next`}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
