import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ConsoleTask, Variant } from '../types'
import { age, bottomParts, fit, mark, statusText, tabLabel, tabWidth, tabWindow, topParts } from './layout'
import { sanitize } from './sanitize'

const PANE = 'subagent-proto'
const TITLE = 'Subagent prototype'
const COLUMNS = 100
const STEP_TICKS = 3
const RESULT_LINES = 3

const selected = atom({ plugin: 'subagent-proto', key: 'selected' } as const, 1)
const variant = atom({ plugin: 'subagent-proto', key: 'variant' } as const, 'a' as Variant)
const tick = atom({ plugin: 'subagent-proto', key: 'tick' } as const, 0)
const t0 = atom({ plugin: 'subagent-proto', key: 't0' } as const, 0)

type Use = { tool: string; input: Record<string, unknown>; text?: string; isError?: true }
type Msg = { role: 'user' | 'assistant'; text: string; toolUses: Use[] }
type Part = { t: string; color?: string; dim?: boolean; bold?: boolean }
type Line = Part[]

const say = (text: string, ...toolUses: Use[]): Msg => ({ role: 'assistant', text, toolUses })
const ask = (text: string): Msg => ({ role: 'user', text, toolUses: [] })
const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('\n')

const EXPLORE: Msg[] = [
  ask('Знайди, де в цьому репозиторії оновлюється refresh-токен і хто це викликає.\nПовідом шляхи з номерами рядків.\nНе редагуй файли.'),
  say('Шукаю, де визначено оновлення токена.', { tool: 'Grep', input: { pattern: 'refreshToken', path: 'src' }, text: 'src/auth/session.ts:88\nsrc/middleware/auth.ts:12\nsrc/api/client.ts:204\nsrc/api/client.test.ts:31\nsrc/auth/session.test.ts:14' }),
  say('', { tool: 'Read', input: { file_path: 'src/auth/session.ts' }, text: lines(120, i => `${i + 1}\t${i === 87 ? 'export async function refreshToken(s: Session) {' : '// …'}`) }),
  say('Знайшов: `refreshToken` у session.ts:88, викликається з middleware.\nПеревіряю middleware, щоб побачити умову виклику.', { tool: 'Read', input: { file_path: 'src/middleware/auth.ts', offset: 1, limit: 40 }, text: lines(40, i => `${i + 1}\t${i === 11 ? 'if (expired(token)) await refreshToken(session)' : '…'}`) }),
  say('', { tool: 'Bash', input: { command: 'git log --oneline -5 -- src/auth/session.ts', description: 'Recent changes to session.ts' }, text: 'a1b2c3d fix(auth): retry refresh once on 401\n9f8e7d6 feat(auth): sliding sessions' }),
  say('', { tool: 'mcp__linear__search_issues', input: { query: 'refresh token race' }, text: 'ENG-412 Refresh races when two tabs wake at once (open)' }),
  say('Є відома гонка: ENG-412. Дивлюся клієнт API — там третій виклик, і це дуже довгий рядок, який точно не поміститься в ширину панелі навіть на широкому терміналі, тож тут видно, як рядок обрізається.', { tool: 'Read', input: { file_path: 'src/api/client.ts', offset: 190, limit: 30 }, text: lines(30, i => `${190 + i}\t…`) }),
  say('', { tool: 'Grep', input: { pattern: 'refreshInFlight' }, text: 'No matches found' }),
  say('Підсумок:\n- `src/auth/session.ts:88` — визначення `refreshToken`\n- `src/middleware/auth.ts:12` — виклик при протермінованому токені\n- `src/api/client.ts:204` — повтор після 401\nЗахисту від паралельних оновлень немає (ENG-412).'),
]

const FIXER: Msg[] = [
  ask('Полагодь flaky тест session.test.ts і запусти його 20 разів.'),
  say('Запускаю тест, щоб відтворити.', { tool: 'Bash', input: { command: 'pnpm vitest run src/auth/session.test.ts --repeat 20' }, text: ' ✓ src/auth/session.test.ts (3) 412ms\n ✗ src/auth/session.test.ts > refresh > expires (attempt 7)\n   AssertionError: expected 1 to be 2\n Test Files  1 failed (1)\n      Tests  1 failed | 59 passed (60)' }),
  say('Тест залежить від реального часу. Підміню годинник.', { tool: 'Edit', input: { file_path: 'src/auth/session.test.ts', old_string: 'Date.now()', new_string: 'vi.now()' }, text: 'The file src/auth/session.test.ts has been updated successfully.' }),
  say('', { tool: 'Bash', input: { command: 'pnpm vitest run src/auth/session.test.ts --repeat 20' }, text: ' ✓ src/auth/session.test.ts (60) 2.1s\n Test Files  1 passed (1)\n      Tests  60 passed (60)' }),
  say('Готово: 60/60 проходять. Причина — `Date.now()` у тесті без фейкового годинника.'),
]

const PLANNER: Msg[] = [
  ask('Сплануй міграцію таблиці sessions на нову схему.'),
  say('Читаю поточну схему.', { tool: 'Read', input: { file_path: 'db/schema.sql' }, text: 'CREATE TABLE sessions (\n  id uuid primary key,\n  token text not null\n);' }),
  say('', { tool: 'Bash', input: { command: 'psql "$DATABASE_URL" -c "\\d sessions"' }, isError: true, text: 'Exit code 2\npsql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory\n\tIs the server running locally and accepting connections on that socket?' }),
  say('Без доступу до бази не можу перевірити реальну схему. Зупиняюсь.'),
]

const NESTED: Msg[] = [
  ask('Знайди всі виклики expired() у src.'),
  say('', { tool: 'Grep', input: { pattern: 'expired\\(', path: 'src' } }),
]

const SHELL = (n: number) => lines(Math.min(40, 8 + n), i => (i === 0 ? '  VITE v6.0.3  ready in 412 ms' : i === 1 ? '  ➜  Local:   http://localhost:5173/' : `${String(13 + Math.floor(i / 6)).padStart(2, '0')}:4${i % 10}:0${i % 6} [vite] hmr update /src/App.tsx`)).split('\n')

function exploreSteps(n: number): Msg[] {
  const shown = 1 + Math.min(EXPLORE.length - 1, Math.floor(n / STEP_TICKS))
  const out = EXPLORE.slice(0, shown)
  const last = out.at(-1)
  if (shown < EXPLORE.length && last && n % STEP_TICKS === STEP_TICKS - 1 && last.toolUses.length)
    out[out.length - 1] = { ...last, toolUses: last.toolUses.map(u => ({ ...u, text: undefined, isError: undefined })) }
  return out
}

function board(n: number, start: number): { task: ConsoleTask; msgs?: Msg[]; out?: string[] }[] {
  const exploreDone = Math.floor(n / STEP_TICKS) >= EXPLORE.length - 1
  return [
    { task: { id: 'b1', kind: 'shell', command: 'pnpm dev', label: 'vite dev server', startedAt: start - 300000 }, out: SHELL(n) },
    { task: { id: 'a1', kind: 'agent', command: 'Explore: explore auth flow', label: 'Explore·explore auth flow', startedAt: start - 5000, status: exploreDone ? 'completed' : undefined }, msgs: exploreSteps(n) },
    { task: { id: 'a2', kind: 'agent', command: 'general-purpose: fix flaky test', label: 'general·fix flaky test', startedAt: start - 140000, status: 'completed' }, msgs: FIXER },
    { task: { id: 'a3', kind: 'agent', command: 'Plan: plan sessions migration', label: 'Plan·plan migration', startedAt: start - 60000, status: 'failed' }, msgs: PLANNER },
    { task: { id: 'a4', kind: 'agent', command: 'Explore: find expired() callers', label: 'Explore·find callers', startedAt: start - 20000 }, msgs: NESTED },
  ]
}

function shortTool(name: string): string {
  const m = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name)
  return m ? `${m[1]}:${m[2]}` : name
}

const ARG_KEYS = ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt']

function toolArg(input: Record<string, unknown>): string {
  for (const k of ARG_KEYS) if (typeof input[k] === 'string') return String(input[k])
  const first = Object.values(input).find(v => typeof v === 'string')
  return typeof first === 'string' ? first : ''
}

function textLines(text: string): string[] {
  const out: string[] = []
  for (const l of text.split('\n')) {
    if (l.trim() === '' && (out.length === 0 || out.at(-1) === '')) continue
    out.push(l)
  }
  while (out.at(-1) === '') out.pop()
  return out
}

function resultLines(text: string): string[] {
  return text.split('\n').filter(l => l.trim() !== '')
}

function variantA(msgs: Msg[]): Line[] {
  const out: Line[] = []
  msgs.forEach((m, i) => {
    if (m.role === 'user') {
      if (i === 0) out.push([{ t: `▸ ${m.text.split('\n')[0]}`, dim: true }])
      return
    }
    for (const l of textLines(m.text)) out.push([{ t: l }])
    for (const u of m.toolUses) {
      out.push([{ t: '→ ', color: 'cyan' }, { t: shortTool(u.tool), color: 'cyan', bold: true }, { t: `: ${toolArg(u.input)}` }])
      if (u.text === undefined) {
        out.push([{ t: '  …', dim: true }])
        continue
      }
      const r = resultLines(u.text)
      r.slice(0, RESULT_LINES).forEach((l, j) =>
        out.push(u.isError && j === 0 ? [{ t: `  ✗ ${l}`, color: 'red' }] : [{ t: `  ${l}`, dim: true }]),
      )
      if (r.length > RESULT_LINES) out.push([{ t: `  … +${r.length - RESULT_LINES} lines`, dim: true }])
    }
  })
  return out
}

function variantB(msgs: Msg[]): Line[] {
  const out: Line[] = []
  msgs.forEach((m, i) => {
    if (m.role === 'user') {
      if (i === 0) out.push([{ t: `▸ ${m.text.split('\n')[0]}`, dim: true }])
      return
    }
    for (const l of textLines(m.text)) out.push([{ t: l }])
    for (const u of m.toolUses) {
      const r = u.text === undefined ? undefined : resultLines(u.text)
      const tail: Part =
        r === undefined
          ? { t: ' · …', dim: true }
          : u.isError
            ? { t: ` · ✗ ${r[0] ?? 'error'}`, color: 'red' }
            : { t: ` · ${r.length === 1 ? r[0] : `${r.length} lines`}`, dim: true }
      out.push([{ t: '→ ', color: 'cyan' }, { t: shortTool(u.tool), color: 'cyan', bold: true }, { t: ` ${toolArg(u.input)}` }, tail])
    }
  })
  return out
}

function variantC(msgs: Msg[]): Line[] {
  const out: Line[] = []
  msgs.forEach((m, i) => {
    if (m.role === 'user') {
      if (i === 0) out.push([{ t: `> ${m.text.split('\n')[0]}`, dim: true }], [{ t: '' }])
      return
    }
    textLines(m.text).forEach((l, j) => out.push([{ t: j === 0 ? '● ' : '  ' }, { t: l }]))
    if (m.text) out.push([{ t: '' }])
    for (const u of m.toolUses) {
      out.push([{ t: '● ', color: u.text === undefined ? 'yellow' : u.isError ? 'red' : 'green' }, { t: shortTool(u.tool), bold: true }, { t: `(${toolArg(u.input)})` }])
      if (u.text === undefined) out.push([{ t: '  ⎿  Running…', dim: true }])
      else {
        const r = resultLines(u.text)
        r.slice(0, RESULT_LINES).forEach((l, j) =>
          out.push([{ t: j === 0 ? '  ⎿  ' : '     ', dim: true }, u.isError ? { t: l, color: 'red' } : { t: l, dim: true }]),
        )
        if (r.length > RESULT_LINES) out.push([{ t: `     … +${r.length - RESULT_LINES} lines`, dim: true }])
      }
      out.push([{ t: '' }])
    }
  })
  while (out.length && out.at(-1)?.every(p => p.t === '')) out.pop()
  return out
}

const RENDER: Record<Variant, (m: Msg[]) => Line[]> = { a: variantA, b: variantB, c: variantC }
const NAMES: Record<Variant, string> = { a: 'A log', b: 'B compact', c: 'C native' }

function clip(parts: Line, width: number): Line {
  const out: Line = []
  let used = 0
  for (const p of parts) {
    const t = sanitize(p.t)
    if (used + t.length > width) {
      out.push({ ...p, t: `${t.slice(0, Math.max(0, width - used - 1))}…` })
      return out
    }
    out.push({ ...p, t })
    used += t.length
  }
  if (used < width) out.push({ t: ' '.repeat(width - used) })
  return out
}

let timer: Timer | undefined

function start($: EngineInterface) {
  if (timer) return
  timer = $.clock.every(1000, () => void update($, tick, n => n + 1).catch(() => undefined))
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'subagent-proto', description: 'Open the subagent prototype pane', argumentHint: 'a|b|c|restart' })
    const now = await $.clock.now()
    if (!(await read($, t0))) await update($, t0, () => now)
    start($)
    return next(e)
  })

  on('command.run', { command: 'subagent-proto' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'a' || arg === 'b' || arg === 'c') await update($, variant, () => arg)
    if (arg === 'restart') {
      const now = await $.clock.now()
      await update($, tick, () => 0)
      await update($, t0, () => now)
    }
    start($)
    await openPane($)
    return { text: `subagent-proto: variant ${NAMES[await read($, variant)]}` }
  }).catch(() => ({ text: 'subagent-proto: failed' }))

  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.element === 'exit') {
      if (e.origin.kind !== 'person') return next(e)
      const n = board(await read($, tick), await read($, t0)).length
      if (n > 1 && (await read($, selected)) === n - 1) return {}
      void (async () => {
        await $.ui.close({ id: PANE })
        await openPane($)
      })().catch(() => undefined)
      return {}
    }
    const id = e.element?.startsWith('tab-') ? e.element.slice(4) : undefined
    const i = board(0, 0).findIndex(x => x.task.id === id)
    if (i >= 0) await update($, selected, () => i)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.scroll', { component: 'Pane', requestId: PANE }, async () => ({})).catch(() => ({}))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const n = await read($, tick)
    const start0 = (await read($, t0)) || (await $.clock.now())
    const v = await read($, variant)
    const at = await read($, selected)
    const now = await $.clock.now()
    const rows = board(n, start0)
    const list = rows.map(r => r.task)
    const cur = rows[at]
    const task = cur?.task
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
    const row = (parts: Line, key: string) => (
      <Text key={key} wrap="truncate">
        <Text color="gray">│ </Text>
        {clip(parts, inner).map((p, j) => (
          <Text key={String(j)} color={p.color} dimColor={p.dim} bold={p.bold}>{p.t}</Text>
        ))}
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
            <Button key={`tab-${x.id}`} plain onPress={() => undefined}>
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
    const body: Line[] = cur?.msgs ? RENDER[v](cur.msgs) : (cur?.out ?? []).map(l => [{ t: l }])
    const out = body.slice(-200).slice(-room)
    while (task && out.length < room) out.push([{ t: '' }])

    return (
      <Box flexDirection="column" width={W} height={R} backgroundColor="black">
        {top('BACKGROUND', `variant ${NAMES[v]} · ${list.length} tasks`)}
        <Box flexDirection="row">
          <Text color="gray">│ </Text>
          {tabs}
          <Text color="gray"> │</Text>
        </Box>
        {bottom(e.props.isFocused ? 'ctrl+→ next · ctrl+← back' : '/subagent-proto a|b|c|restart')}
        {task && top(task.kind === 'agent' ? 'TRANSCRIPT' : 'OUTPUT', statusText(task))}
        {task && out.map((l, i) => row(l, `o${i}`))}
        {task && bottom(task.command)}
      </Box>
    )
  })
}
