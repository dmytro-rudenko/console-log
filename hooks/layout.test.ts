import { expect, test } from 'claude-code/testing'

import type { ConsoleTask } from '../types'
import { age, bottomParts, fit, headLine, mark, statusText, taskLabel, topParts } from './layout'

const t = (extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id: 'b1', kind: 'shell', command: 'pnpm   exec jest --selectProjects db --runInBand', startedAt: 0, ...extra })

test('frame lines are exactly the pane width', async () => {
  for (const width of [40, 100, 137]) {
    for (const [title, right] of [['TRANSCRIPT', 'running · 3 running'], ['OUTPUT', 'failed · exit 1'], ['OUTPUT', '']] as const) {
      const p = topParts(title, right, width)
      expect(`╭─ ${title}${p.fill}${p.right}─╮`.length).toBe(width)
    }
    for (const hint of ['ctrl+→ focus', '', 'x'.repeat(300)]) {
      const p = bottomParts(hint, width)
      expect(`╰─${p.hint}${p.fill}`.length).toBe(width)
    }
  }
})

test('top frame line truncates a long right text at narrow widths', async () => {
  const right = 'failed · exit 1 · file unavailable'
  for (const width of [30, 40, 48]) {
    const p = topParts('OUTPUT', right, width)
    expect(`╭─ OUTPUT${p.fill}${p.right}─╮`.length).toBe(width)
  }
})

test('fit pads and truncates with an ellipsis', async () => {
  expect(fit('abc', 5)).toBe('abc  ')
  expect(fit('abcdef', 4)).toBe('abc…')
  expect(fit('abc', 0)).toBe('')
})

test('age formats seconds and minutes', async () => {
  expect(age(0, 12_400)).toBe('12s')
  expect(age(0, 65_000)).toBe('1m05s')
})

test('status marks and text', async () => {
  expect(mark(t())).toEqual({ glyph: '◐', color: 'yellow' })
  expect(mark(t({ status: 'completed' }))).toEqual({ glyph: '✓', color: 'green' })
  expect(mark(t({ status: 'failed' }))).toEqual({ glyph: '✗', color: 'red' })
  expect(mark(t({ status: 'killed' }))).toEqual({ glyph: '■', color: 'gray' })
  expect(statusText(t())).toBe('running')
  expect(statusText(t({ status: 'failed', exitCode: 1 }))).toBe('failed · exit 1')
  expect(statusText(t({ status: 'completed' }))).toBe('completed')
})

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
