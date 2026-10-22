# Subagent transcripts in the console-log pane — implementation plan

**Goal:** every subagent (foreground, background, nested) is a tab in the console-log pane beside Bash/Monitor tasks; its body (`TRANSCRIPT`) shows the prompt's first line, its text, `→ Tool: arg` and up to 3 lines of each tool result, refreshed every second; ✓ goes after 10 s, ✗/■ stay until viewed.
**Spec:** docs/sdd/specs/2026-10-22-subagent-transcripts.md
**Prototype:** docs/sdd/proto/subagent-tab/decision.md
**Verification:** `claude plugin test .` → last line `Ran N tests across 7 files.` with `0 fail`; `npx -y -p typescript tsc -p . --noEmit` → exit 0 and no output; `claude plugin validate .` → `✔ Validation passed` (directory README/LICENSE/icon warnings are not about this plugin's root and may be ignored).

## Context

The pane already tails background Bash/Monitor output. Subagents are invisible in it: a foreground one blocks the chat with only a progress line, a background one shows in `/tasks` as name + status. The engine already keeps each agent's transcript and hands it to mods (`agent.spawn` → `agentId`, `$.agent.list()` → status, `$.session.messages({ agentId })` → messages with `toolUses[]`), so the mod reads it rather than accumulating anything.

## Waves

| Wave | Tasks | Why together |
|---|---|---|
| 0 | 0 | alone — acceptance tests, red until wave 3 |
| 1 | 1 | alone — `types/index.d.ts` is read by tasks 2, 3, 4 |
| 2 | 2, 3, 5 | disjoint writes: `hooks/transcript*.ts` vs `hooks/tasks*.ts` vs `.claude-plugin/plugin.json` + `README.md` |
| 3 | 4 | alone — `hooks/register.tsx` consumes `agentLines` (Task 2) and `syncAgents` (Task 3), and writes `types/index.d.ts` again (after Task 1) |

Serialized: Task 4 must follow 2 and 3 (consumes both). Task 1 and Task 4 both write `types/index.d.ts`, so Task 1 only adds the new type and the `'agent'` kind and leaves the `lines` state type to Task 4 — this keeps `tsc` green at the end of every wave.

## Global constraints

- Code comments: default to none. Only a constraint the code cannot show (protocol quirk, invariant, workaround). Never narrate.
- Stack: Claude Code hooks module, TypeScript + JSX (`h`), no DOM/Node. Tests: `claude plugin test .` (`import { expect, mock, test } from 'claude-code/testing'`). Engine calls are mocked in tests with `on('<noun.method>', () => ({ value: ... }))`; events the test raises (`$.tool.call`, `$.agent.spawn`) are answered by the test's own hook, which sits beneath the mod's.
- Type-check setup (once per worktree, gitignored): `cp -r /home/pc/.claude/dev-mods/680147fd-60d1-4a29-9c6f-3cf145e7cf37/subagent-proto/.claude-plugin/types .claude-plugin/types`, then `npx -y -p typescript tsc -p . --noEmit`. If that folder is gone, load the mod once in Claude Code (README "Development").
- Constants (exact): `LINES = 200`, `LINE_MAX = 500`, `POLL_MS = 1000`, `DROP_COMPLETED_MS = 10000`, `RESULT_LINES = 3`, `LABEL_MAX = 22` (existing, `hooks/layout.ts`), `MAX_TASKS = 20` (existing).
- Agent task fields: `id = agentId`, `kind: 'agent'`, `command = \`${type}: ${desc}\``, `label = \`${type}·${desc}\`` (middle dot U+00B7), no `path`, `startedAt = $.clock.now()` at spawn. `type = clean(e.subagentType)`, `desc = clean(e.description) || type`.
- Tones → render: `text` plain; `tool` `color="cyan"`; `result` and `muted` `dimColor`; `error` `color="red"`.
- Unchanged: the `e.agentId !== undefined` filter for Bash/Monitor in `tool.call`; `addTask`, `dropTask`, `selectTask`, `tabWindow`, the `viewed` rule, closing the pane when no tasks are left, keys.
- Deviation from spec 3.2, deliberate: the `agent.spawn` hook is registered **without** `.catch(($, e, next) => next(e))`. That fallback would call `next(e)` a second time if `next` itself threw, spawning the agent twice. The hook does nothing that can throw besides `next(e)`; the post-spawn work runs in `void spawned(...).catch(() => undefined)`.
- Every PR changing the plugin bumps `.claude-plugin/plugin.json` `version` (Task 5: `0.1.2` → `0.2.0`).

### Task 0: acceptance tests

**Writes:** `hooks/pane.test.tsx` (append only; existing tests untouched)
**Covers:** spec §6 "`hooks/pane.test.tsx` — `agent.spawn` → вкладка й `TRANSCRIPT`; змоканий `session.messages` → у тілі видно `→ Read: …`; `agent.list` з `completed` + 10 с → вкладка зникає, панель закривається; `{ deny }` → `transcript unavailable`", plus spec §3.3 "агента немає в `infos` → `killed`".

- [ ] **Step 1: write the acceptance tests** — append to the end of `hooks/pane.test.tsx` (it already defines `PANE`, `ok`, `note` and imports `expect, mock, test`):

```tsx
const agentSetup = (on: On, list: () => { id: string; status: string }[], messages: () => unknown) => {
  mock.env(on, { HOME: '/home/nobody' })
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', () => { throw new Error('no file') })
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('agent.list', () => ({ value: list().map(a => ({ ...a, description: 'explore auth', type: 'Explore' })) }))
  on('session.messages', () => ({ value: messages() }))
}

const TRANSCRIPT_FIXTURE = [
  { role: 'user', text: 'Find the refresh token\nDo not edit files', toolUses: [] },
  {
    role: 'assistant',
    text: 'Looking for the token.',
    toolUses: [{ tool_use_id: 't1', tool: 'Read', input: { file_path: 'src/auth/session.ts' }, text: 'a\nb\nc\nd\ne' }],
  },
]

test('a subagent becomes a tab with its transcript', async ($, on) => {
  const clock = mock.clock(on)
  agentSetup(on, () => [{ id: 'ag1', status: 'running' }], () => TRANSCRIPT_FIXTURE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Find the refresh token', description: 'explore auth', subagentType: 'Explore' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /TRANSCRIPT/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore·explore auth/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▸ Find the refresh token/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /→ Read: src\/auth\/session\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /… \+2 lines/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Explore: explore auth/ })).toBeDefined()
  await ui.unmount()
})

test('a completed subagent leaves after 10 seconds and the pane closes', async ($, on) => {
  const clock = mock.clock(on)
  let status = 'running'
  const closed: string[] = []
  agentSetup(on, () => [{ id: 'ag1', status }], () => TRANSCRIPT_FIXTURE)
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'p', description: 'explore auth', subagentType: 'Explore' })
  await clock.settle()
  status = 'completed'
  await clock.advance(1500)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✓/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(11000)
  expect(closed).toContain('console-log')
})

test('a subagent the session no longer lists shows as killed', async ($, on) => {
  const clock = mock.clock(on)
  agentSetup(on, () => [], () => TRANSCRIPT_FIXTURE)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'p', description: 'explore auth', subagentType: 'Explore' })
  await clock.settle()
  await clock.advance(1500)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /■/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /killed/ })).toBeDefined()
  await ui.unmount()
})

test('an unreadable transcript says so', async ($, on) => {
  const clock = mock.clock(on)
  agentSetup(on, () => [{ id: 'ag1', status: 'running' }], () => ({ deny: 'no such agent: ag1' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'p', description: 'explore auth', subagentType: 'Explore' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /transcript unavailable/ })).toBeDefined()
  await ui.unmount()
})
```

Add `import type { On } from 'claude-code'` at the top of the file. If the test's `on` is not assignable to `On`, type the parameter as `Parameters<Parameters<typeof test>[1]>[1]` instead.

- [ ] **Step 2: run them, watch them fail** — `claude plugin test .`, expect the four new tests `(fail)` (no tab: `TRANSCRIPT`/`✓`/`■`/`transcript unavailable` not found) and the 38 existing tests `(pass)`: `38 pass`, `4 fail`.

### Task 1: agent kind and the OutLine type

**Writes:** `types/index.d.ts`
**Depends on:** Task 0
**Interfaces:**
- Produces: `ConsoleTask.kind: 'shell' | 'monitor' | 'agent'`; `export type OutLine = { text: string; tone: 'text' | 'tool' | 'result' | 'error' | 'muted' }`.

- [ ] **Step 1: edit** — in `types/index.d.ts` change `kind: 'shell' | 'monitor'` to `kind: 'shell' | 'monitor' | 'agent'`, and after the `TaskNotification` type add:

```ts
export type OutLine = { text: string; tone: 'text' | 'tool' | 'result' | 'error' | 'muted' }
```

Leave `PluginState['console-log'].lines` as `string[]` (Task 4 changes it).
- [ ] **Step 2: type-check** — `npx -y -p typescript tsc -p . --noEmit` → exit 0. `claude plugin test .` → still `38 pass`, `4 fail`.

### Task 2: agentLines

**Writes:** `hooks/transcript.ts` (new), `hooks/transcript.test.ts` (new)
**Reads:** `types/index.d.ts`, `hooks/layout.ts`
**Depends on:** Task 1
**Interfaces:**
- Consumes: `OutLine` from `../types` (Task 1); `SessionMessage` from `'claude-code'` (`{ role: 'user' | 'assistant'; text: string; toolUses: ToolUseSummary[] }`, `ToolUseSummary = { tool_use_id: string; tool: string; input: Record<string, unknown>; text?: string; isError?: true; ... }`).
- Produces: `export function agentLines(messages: readonly SessionMessage[]): OutLine[]`, `export const RESULT_LINES = 3`, `export const TRANSCRIPT_LINES = 200`.

- [ ] **Step 1: write the failing test** — `hooks/transcript.test.ts`:

```ts
import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { agentLines } from './transcript'

type Use = SessionMessage['toolUses'][number]
const ask = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const say = (text: string, ...toolUses: Use[]): SessionMessage => ({ role: 'assistant', text, toolUses })
const use = (tool: string, input: Record<string, unknown>, text?: string, isError?: true): Use => ({
  tool_use_id: 'u1',
  tool,
  input,
  ...(text === undefined ? {} : { text }),
  ...(isError ? { isError } : {}),
})

test('the first prompt shows its first line, later user messages are skipped', async () => {
  expect(agentLines([ask('Find it\nthen report'), say('ok'), ask('tool results')])).toEqual([
    { text: '▸ Find it', tone: 'muted' },
    { text: 'ok', tone: 'text' },
  ])
})

test('assistant text keeps its lines, collapses blank runs and trims blank edges', async () => {
  expect(agentLines([say('\n\nfirst\n\n\n  indented\n\n')])).toEqual([
    { text: 'first', tone: 'text' },
    { text: '', tone: 'text' },
    { text: '  indented', tone: 'text' },
  ])
})

test('a tool call names its tool and its main argument', async () => {
  const lines = agentLines([
    say('', use('Bash', { description: 'list', command: 'ls -la' }, 'x'), use('Edit', { replace_all: false, old_string: 'a' }, 'x'), use('Noop', {}, 'x')),
  ])
  expect(lines.filter(l => l.tone === 'tool').map(l => l.text)).toEqual(['→ Bash: ls -la', '→ Edit: a', '→ Noop: '])
})

test('an MCP tool name is shortened to server:name', async () => {
  expect(agentLines([say('', use('mcp__claude_ai_Linear__get_issue', { id: 'ENG-1' }, 'x'))])[0]).toEqual({
    text: '→ claude_ai_Linear:get_issue: ENG-1',
    tone: 'tool',
  })
})

test('a result shows its first three non-empty lines and counts the rest', async () => {
  expect(agentLines([say('', use('Read', { file_path: 'a.ts' }, '1\n\n2\n3\n4\n5'))])).toEqual([
    { text: '→ Read: a.ts', tone: 'tool' },
    { text: '  1', tone: 'result' },
    { text: '  2', tone: 'result' },
    { text: '  3', tone: 'result' },
    { text: '  … +2 lines', tone: 'muted' },
  ])
})

test('an error result marks its first line', async () => {
  expect(agentLines([say('', use('Bash', { command: 'psql' }, 'Exit code 2\nno socket', true))]).slice(1)).toEqual([
    { text: '  ✗ Exit code 2', tone: 'error' },
    { text: '  no socket', tone: 'result' },
  ])
})

test('a tool still running shows an ellipsis', async () => {
  expect(agentLines([say('', use('Grep', { pattern: 'x' }))]).slice(1)).toEqual([{ text: '  …', tone: 'muted' }])
})

test('only the last 200 lines are kept', async () => {
  const lines = agentLines([say(Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n'))])
  expect(lines.length).toBe(200)
  expect(lines[0]?.text).toBe('l100')
  expect(lines.at(-1)?.text).toBe('l299')
})
```

- [ ] **Step 2: run it, watch it fail** — `claude plugin test .` → `transcript.test.ts` fails to import `./transcript`.
- [ ] **Step 3: implement** — `hooks/transcript.ts`:

```ts
import type { SessionMessage } from 'claude-code'

import type { OutLine } from '../types'

export const RESULT_LINES = 3
export const TRANSCRIPT_LINES = 200
const ARG_KEYS = ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt'] as const

function toolName(tool: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool)
  return m ? `${m[1]}:${m[2]}` : tool
}

function toolArg(input: Readonly<Record<string, unknown>>): string {
  for (const k of ARG_KEYS) {
    const v = input[k]
    if (typeof v === 'string') return v
  }
  return Object.values(input).find((v): v is string => typeof v === 'string') ?? ''
}

function textLines(text: string): string[] {
  const out: string[] = []
  for (const l of text.split('\n')) {
    const blank = l.trim() === ''
    if (blank && (out.length === 0 || out.at(-1) === '')) continue
    out.push(blank ? '' : l)
  }
  while (out.at(-1) === '') out.pop()
  return out
}

export function agentLines(messages: readonly SessionMessage[]): OutLine[] {
  const out: OutLine[] = []
  messages.forEach((m, i) => {
    if (m.role === 'user') {
      if (i === 0) out.push({ text: `▸ ${m.text.split('\n')[0] ?? ''}`, tone: 'muted' })
      return
    }
    for (const l of textLines(m.text)) out.push({ text: l, tone: 'text' })
    for (const u of m.toolUses) {
      out.push({ text: `→ ${toolName(u.tool)}: ${toolArg(u.input)}`, tone: 'tool' })
      if (u.text === undefined) {
        out.push({ text: '  …', tone: 'muted' })
        continue
      }
      const r = u.text.split('\n').filter(l => l.trim() !== '')
      r.slice(0, RESULT_LINES).forEach((l, j) =>
        out.push(u.isError && j === 0 ? { text: `  ✗ ${l}`, tone: 'error' } : { text: `  ${l}`, tone: 'result' }),
      )
      if (r.length > RESULT_LINES) out.push({ text: `  … +${r.length - RESULT_LINES} lines`, tone: 'muted' })
    }
  })
  return out.slice(-TRANSCRIPT_LINES)
}
```

- [ ] **Step 4: run it, watch it pass** — `claude plugin test .` → all `transcript.test.ts` tests `(pass)`; the 4 acceptance tests still fail. `npx -y -p typescript tsc -p . --noEmit` → exit 0.

### Task 3: syncAgents

**Writes:** `hooks/tasks.ts`, `hooks/tasks.test.ts`
**Depends on:** Task 1
**Interfaces:**
- Consumes: `ConsoleTask.kind` includes `'agent'` (Task 1).
- Produces: `export function syncAgents(board: Board, infos: readonly { id: string; status: string }[]): Board` — for each `kind === 'agent'` task without `status`: listed with `completed`/`failed`/`killed` → that status and `viewed: false`; not listed → `killed`, `viewed: false`; listed with anything else → unchanged. Non-agent tasks and agents that already have a status are untouched. Returns the same `board` object when nothing changed.

- [ ] **Step 1: write the failing test** — append to `hooks/tasks.test.ts` and add `syncAgents` to its import from `./tasks`:

```ts
const ag = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => t(id, { kind: 'agent', ...extra })

test('syncAgents gives an agent its final status from the list', async () => {
  const b: Board = { tasks: [ag('a'), ag('b'), ag('c')], selected: 0 }
  const after = syncAgents(b, [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'killed' }])
  expect(after.tasks.map(x => [x.status, x.viewed])).toEqual([['completed', false], ['failed', false], ['killed', false]])
  expect(after.selected).toBe(0)
})

test('syncAgents marks an agent the list no longer has as killed', async () => {
  const after = syncAgents({ tasks: [ag('a')], selected: 0 }, [])
  expect(after.tasks[0]?.status).toBe('killed')
})

test('syncAgents leaves running, waiting and idle agents, shells and finished agents alone', async () => {
  const b: Board = { tasks: [ag('a'), ag('b'), ag('c'), t('s'), ag('d', { status: 'failed', viewed: true })], selected: 0 }
  const infos = [{ id: 'a', status: 'running' }, { id: 'b', status: 'waiting' }, { id: 'c', status: 'idle' }, { id: 'd', status: 'completed' }]
  expect(syncAgents(b, infos)).toBe(b)
})
```

- [ ] **Step 2: run it, watch it fail** — `claude plugin test .` → `syncAgents` is not exported.
- [ ] **Step 3: implement** — append to `hooks/tasks.ts`:

```ts
const AGENT_FINAL = new Set(['completed', 'failed', 'killed'])

export function syncAgents(board: Board, infos: readonly { id: string; status: string }[]): Board {
  let changed = false
  const tasks = board.tasks.map(x => {
    if (x.kind !== 'agent' || x.status) return x
    const info = infos.find(i => i.id === x.id)
    const status = !info ? 'killed' : AGENT_FINAL.has(info.status) ? info.status : undefined
    if (!status) return x
    changed = true
    return { ...x, status, viewed: false }
  })
  return changed ? { ...board, tasks } : board
}
```

- [ ] **Step 4: run it, watch it pass** — `claude plugin test .` → the three `syncAgents` tests `(pass)`. `npx -y -p typescript tsc -p . --noEmit` → exit 0.

### Task 4: wire agents into the pane

**Writes:** `hooks/register.tsx`, `types/index.d.ts`
**Reads:** `hooks/transcript.ts`, `hooks/tasks.ts`, `hooks/layout.ts`, `hooks/sanitize.ts`
**Depends on:** Task 2, Task 3
**Satisfies:** all four Task 0 tests.
**Interfaces:**
- Consumes: `agentLines` (Task 2), `syncAgents` (Task 3), `OutLine` (Task 1).

- [ ] **Step 1: state type** — `types/index.d.ts`: in `PluginState['console-log']` change `lines: string[]` to `lines: OutLine[]`. In `hooks/register.tsx`: `import type { Board, ConsoleTask, OutLine } from '../types'`; `const lines = atom({ plugin: 'console-log', key: 'lines' } as const, [] as OutLine[])`; import `syncAgents` from `./tasks` and `agentLines` from `./transcript`.
- [ ] **Step 2: load()** — at the start of `load`, after `const task = …`, add the agent branch; in the shell branch map lines to `OutLine`:

```ts
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
```

and replace `next.map(l => sanitize(l).slice(0, LINE_MAX))` with `next.map((l): OutLine => ({ text: sanitize(l).slice(0, LINE_MAX), tone: 'text' }))`.
- [ ] **Step 3: status sync in poll()** — add above `poll`:

```ts
async function syncAgentStatus($: EngineInterface) {
  if (!(await board($)).tasks.some(x => x.kind === 'agent' && !x.status)) return
  let infos: { id: string; status: string }[]
  try {
    infos = await $.agent.list()
  } catch {
    return
  }
  let done: string[] = []
  await mutate($, b => {
    const after = syncAgents(b, infos)
    done = after.tasks.filter((x, i) => x.status === 'completed' && !b.tasks[i]?.status).map(x => x.id)
    return after
  })
  for (const id of done) $.clock.after(DROP_COMPLETED_MS, () => void drop($, id).catch(() => undefined))
}
```

and make `poll` call `await syncAgentStatus($)` as its first line (before `const now = …`).
- [ ] **Step 4: track() skips the output lookup for agents** — change `const path = known ?? (await findOutput($, seed.id).catch(() => undefined))` to `const path = seed.kind === 'agent' ? undefined : (known ?? (await findOutput($, seed.id).catch(() => undefined)))`.
- [ ] **Step 5: agent.spawn hook** — add above `export const register`:

```ts
async function spawned($: EngineInterface, e: { subagentType: string; description: string }, id: string) {
  const type = clean(e.subagentType)
  const desc = clean(e.description) || type
  await track($, { id, kind: 'agent', command: `${type}: ${desc}`, label: `${type}·${desc}` }, undefined)
}
```

and inside `register`, after the `tool.call` hook:

```ts
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) void spawned($, e, r.agentId).catch(() => undefined)
    return r
  })
```

No `.catch` on this hook (a fallback `next(e)` would spawn twice if `next` threw).
- [ ] **Step 6: render** — in the `ui.render` hook:
  - add a module-level map:
    ```ts
    const TONE: Record<OutLine['tone'], { color?: string; dim?: boolean }> = {
      text: {},
      tool: { color: 'cyan' },
      result: { dim: true },
      error: { color: 'red' },
      muted: { dim: true },
    }
    ```
  - replace `row` with:
    ```tsx
    const row = (line: OutLine, key: string) => (
      <Text key={key} wrap="truncate">
        <Text color="gray">│ </Text>
        <Text color={TONE[line.tone].color} dimColor={TONE[line.tone].dim}>{fit(line.text, inner)}</Text>
        <Text color="gray"> │</Text>
      </Text>
    )
    ```
  - `const out: OutLine[] = missing ? [{ text: 'output file not found', tone: 'muted' }] : body.slice(-room)`; pad with `out.push({ text: '', tone: 'text' })`; render `out.map((l, i) => row(l, \`o${i}\`))`.
  - `const isAgent = task?.kind === 'agent'`; right side: `` `${statusText(task)}${failed ? (isAgent ? ' · transcript unavailable' : ' · file unavailable') : ''}` ``; body title: `top(isAgent ? 'TRANSCRIPT' : 'OUTPUT', right)`.
- [ ] **Step 7: run, watch it pass** — `claude plugin test .` → `0 fail`, last line `Ran N tests across 7 files.`; `npx -y -p typescript tsc -p . --noEmit` → exit 0; `claude plugin validate .` → `✔ Validation passed`.

### Task 5: version and README

**Writes:** `.claude-plugin/plugin.json`, `README.md`
**Depends on:** Task 0

- [ ] **Step 1: plugin.json** — `"version": "0.2.0"`, `"description": "Live pane beside the chat with the last 200 lines of background Bash and Monitor tasks and the transcripts of subagents"`.
- [ ] **Step 2: README, English** — first paragraph: after "…refreshes every second." insert "Each subagent gets a tab too, with its transcript." In `## Behaviour`, after the bash-mode bullet, add:
  - `- Every subagent (foreground, background or nested) gets a tab labelled \`Type·description\`. Its body, framed \`TRANSCRIPT\`, shows the first line of its prompt (\`▸\`), its text, each tool call as \`→ Tool: argument\`, and up to three lines of each tool result (\`… +N lines\` for the rest, \`✗\` on an error, \`…\` while the tool runs).`
  - `- A subagent's tab follows the marks below. A subagent the session no longer lists shows \`■\`.`
  In `## Limits` add: `- A tool result in a subagent's tab shows at most three lines.` and `- Workflow agents and teammates in their own terminal panes get no tab.`
- [ ] **Step 3: README, Ukrainian** — first paragraph: after "…і оновлюється щосекунди." insert "Кожен субагент теж отримує вкладку зі своїм транскриптом." In `### Поведінка`, before the `◐` bullet, add:
  - `- Кожен субагент (звичайний, фоновий чи вкладений) отримує вкладку з підписом \`Тип·опис\`. Її тіло в рамці \`TRANSCRIPT\` показує перший рядок промпту (\`▸\`), текст агента, кожен виклик тулу як \`→ Tool: аргумент\` і до трьох рядків результату (\`… +N lines\` для решти, \`✗\` на помилці, \`…\` поки тул працює).`
  - `- Вкладка субагента підкоряється тим самим позначкам, що нижче. Субагент, якого сесія вже не показує в списку, отримує \`■\`.`
  In `### Обмеження` add: `- Результат тулу у вкладці субагента показує щонайбільше три рядки.` and `- Агенти воркфлоу й teammates в окремих терміналах вкладки не отримують.`
- [ ] **Step 4: check** — `claude plugin validate .` → `✔ Validation passed`.

## Verification (after wave 3)

1. `claude plugin test .` → `0 fail`.
2. `npx -y -p typescript tsc -p . --noEmit` → exit 0.
3. `claude plugin validate .` → `✔ Validation passed`.
4. Live smoke in Claude Code with this worktree loaded (`claude --plugin-dir .` or hot reload): run a background `sleep 30; echo done`, a foreground `Explore` agent and a background agent; walk tabs with `ctrl+→`/`ctrl+←`; the agent tab shows `TRANSCRIPT`, text and `→ Tool:` lines updating every second; its ✓ disappears 10 s after it finishes; the pane closes when nothing is left. Then remove the `subagent-proto` dev mod (`/home/pc/.claude/dev-mods/680147fd-60d1-4a29-9c6f-3cf145e7cf37/subagent-proto`) so it does not linger in the session.
