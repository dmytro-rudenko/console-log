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

async function select($: EngineInterface, i: number) {
  await update($, selected, () => i)
  await update($, offset, () => 0)
  await refresh($)
}

function mark(t: BgTask): { glyph: string; color: string } {
  if (!t.status) return { glyph: '●', color: 'claude' }
  if (t.status === 'completed') return { glyph: '✓', color: 'success' }
  if (t.status === 'failed') return { glyph: '✗', color: 'error' }
  return { glyph: '■', color: 'inactive' }
}

function label(t: BgTask, n: number) {
  const c = t.command.replace(/\s+/g, ' ').trim()
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
      name: 'bg-tail',
      description: 'Background output pane: next | variant a|b|c',
    })
    const now = await $.clock.now()
    await update($, tasks, l => l.map(t => ({ ...t, kind: t.kind ?? 'shell', startedAt: t.startedAt ?? now })))
    if ((await read($, tasks)).some(t => !t.status)) tick($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const id = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]
      const status = /<status>([^<]+)<\/status>/.exec(e.text)?.[1]
      const code = /exit code (\d+)/.exec(e.text)?.[1]
      if (id && status) {
        await update($, tasks, l =>
          l.map(t => (t.id === id ? { ...t, status, exitCode: code ? Number(code) : undefined } : t)),
        )
        await refresh($)
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
    const startedAt = await $.clock.now()
    const list = await update($, tasks, l =>
      [...l, { id, kind: e.tool === 'Bash' ? 'shell' : 'monitor', command, path, startedAt } as BgTask].slice(-20),
    )
    await select($, list.length - 1)
    void $.ui.open({ id: PANE, title: 'Background output' })
    tick($)
    return ran
  })

  on('command.run', { command: 'bg-tail' }, async ($, e) => {
    const [verb, arg] = (e.args ?? '').trim().split(/\s+/)
    if (verb === 'variant' && (arg === 'a' || arg === 'b' || arg === 'c')) {
      await update($, variant, () => arg)
    }
    const list = await read($, tasks)
    if (verb === 'next' && list.length > 0) {
      await select($, ((await read($, selected)) + 1) % list.length)
    }
    await $.ui.open({ id: PANE, title: 'Background output' })
    return { text: `Background output: variant ${await read($, variant)}.` }
  })

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const total = (await read($, lines)).length
    await update($, offset, o => Math.min(Math.max(0, total - room), Math.max(0, o - e.by)))
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
      const tabs = (
        <Box flexDirection="row">
          {list.map((t, i) => {
            const m = mark(t)
            const isOn = i === at
            return (
              <Button key={`tab-${t.id}`} onPress={() => select($, i)}>
                <Text color={m.color}>{m.glyph} </Text>
                <Text color={isOn ? 'claude' : 'inactive'} bold={isOn} underline={isOn}>{label(t, 18)}</Text>
                <Text dimColor>{` ${age(t, now)}   `}</Text>
              </Button>
            )
          })}
        </Box>
      )
      return (
        <Box flexDirection="column">
          {top('BACKGROUND', `${list.length} tasks`, 'claude', cols)}
          {row(cols, list.length ? tabs : empty)}
          {bottom(cols)}
          {task && top('OUTPUT', `${statusText(task)} · ${scrollTag}`, mark(task).color, cols)}
          {task && slice(rows - 7).map((l, i) => row(cols, <Text wrap="truncate">{fit(l, cols - 4)}</Text>, `l${i}`))}
          {task && bottom(cols, label(task, Math.max(10, cols - 12)))}
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
