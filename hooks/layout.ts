import type { ConsoleTask } from '../types'

export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width)
}

export function topParts(title: string, right: string, width: number): { fill: string; right: string } {
  const room = Math.max(0, width - 9 - title.length)
  const r = right && room > 0 ? ` ${fit(right, room).trimEnd()} ` : ' '
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

export function taskLabel(task: ConsoleTask): string {
  return (task.label ?? task.command).replace(/\s+/g, ' ').trim()
}

export function headLine(label: string, tail: string, width: number): string {
  if (tail.length >= width) return fit(tail, width)
  return `${fit(label, width - tail.length)}${tail}`
}
