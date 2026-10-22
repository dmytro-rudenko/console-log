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

test('a multi-line argument shows only its first line', async () => {
  expect(agentLines([say('', use('Bash', { command: 'git commit -F - <<EOF\nfix: x\nEOF' }, 'ok'))])[0]).toEqual({
    text: '→ Bash: git commit -F - <<EOF',
    tone: 'tool',
  })
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
