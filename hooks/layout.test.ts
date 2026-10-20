import { expect, test } from 'claude-code/testing'

import type { ConsoleTask } from '../types'
import { age, bottomParts, fit, mark, paneHint, statusText, tabLabel, tabWindow, topParts } from './layout'

const t = (extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id: 'b1', kind: 'shell', command: 'pnpm   exec jest --selectProjects db --runInBand', startedAt: 0, ...extra })

test('frame lines are exactly the pane width', async () => {
  for (const width of [40, 100, 137]) {
    for (const [title, right] of [['BACKGROUND', '3 tasks'], ['OUTPUT', 'failed · exit 1'], ['OUTPUT', '']] as const) {
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

test('tab label prefers the description and caps at 22 chars', async () => {
  expect(tabLabel(t({ label: 'jest db tests' }))).toBe('jest db tests')
  expect(tabLabel(t())).toBe('pnpm exec jest --sele…')
})

test('tab window keeps the selected tab inside the budget', async () => {
  expect(tabWindow([10, 10, 10], 1, 100)).toEqual({ lo: 0, hi: 2 })
  const w = tabWindow([10, 10, 10, 10, 10], 4, 25)
  expect(w.hi).toBe(4)
  expect(w.lo).toBe(3)
  expect(tabWindow([], -1, 50)).toEqual({ lo: 0, hi: -1 })
})

test('pane hint depends on focus and on the ctrl+arrow binding', async () => {
  expect(paneHint(true, false)).toBe('ctrl+→ next · ctrl+← back')
  expect(paneHint(false, true)).toBe('ctrl+→ focus')
  expect(paneHint(false, false)).toBe('ctrl+x tab focus')
})
