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
  const key = ARG_KEYS.find(k => typeof input[k] === 'string')
  const v = key === undefined ? Object.values(input).find((x): x is string => typeof x === 'string') : (input[key] as string)
  return v?.split('\n')[0] ?? ''
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
