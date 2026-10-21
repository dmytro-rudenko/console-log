import { expect, test } from 'claude-code/testing'

import { sanitize } from './sanitize'

test('drops colour and cursor CSI', async () => {
  expect(sanitize('\x1b[41m FAIL \x1b[0m spec.ts')).toBe(' FAIL  spec.ts')
  expect(sanitize('a\x1b[2K\x1b[1Gb')).toBe('ab')
})

test('drops OSC terminated by BEL and by ST', async () => {
  expect(sanitize('\x1b]8;;https://x.test\x07link\x1b]8;;\x07')).toBe('link')
  expect(sanitize('\x1b]0;title\x1b\\text')).toBe('text')
  expect(sanitize('\x1b]52;c;aGVsbG8=\x07ok')).toBe('ok')
})

test('drops DCS, 8-bit CSI and stray controls', async () => {
  expect(sanitize('\x1bPq#0;2;0;0;0\x1b\\after')).toBe('after')
  expect(sanitize('\x9b31mred')).toBe('red')
  expect(sanitize('progress 10%\rprogress 20%\x07')).toBe('progress 10%progress 20%')
})

test('keeps tab and unicode', async () => {
  expect(sanitize('✓\tтести пройшли ◐')).toBe('✓\tтести пройшли ◐')
})

test('drops nF, Fp and Fs escapes', async () => {
  expect(sanitize('\x1b(B\x1b[mdone')).toBe('done')
  expect(sanitize('\x1b7x\x1b8')).toBe('x')
  expect(sanitize('\x1b=a\x1b>')).toBe('a')
  expect(sanitize('\x1bcreset')).toBe('reset')
})

test('drops a lone trailing ESC', async () => {
  expect(sanitize('end\x1b')).toBe('end')
})
