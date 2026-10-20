import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'console-log',
  component: 'Pane',
  requestId: 'console-log',
  props: {
    title: 'Background output',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('a background Bash call becomes a tab with its live output', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('process.run', (_, e) =>
    e.argv[0] === 'tail'
      ? { value: { exitCode: 0, stdout: 'line 1\n\x1b[31mline 2\x1b[0m\nline 3\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 0, stdout: '/tmp/claude-1000/p/S1/tasks/b1.output\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } },
  )
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'pnpm exec jest', description: 'jest db tests', run_in_background: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const top = await ui.find({ type: 'Text', text: /BACKGROUND/ })
  expect(top?.text.length).toBe(100)
  expect((await ui.find({ type: 'Text', text: /jest db tests/ }))?.text).toContain('jest db tests')
  expect((await ui.find({ type: 'Text', text: /line 2/ }))?.text).not.toContain('\x1b')
  expect(await ui.find({ type: 'Text', text: /ctrl\+x tab focus/ })).toBeDefined()
  await ui.unmount()
})

test('an empty pane says so', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.read', () => { throw new Error('no file') })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No background tasks yet\./ })).toBeDefined()
  await ui.unmount()
})

test('a subagent background call does not become a tab', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2', backgroundOutputPath: '/tmp/b2.output' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const fromSubagent = { tool: 'Bash', command: 'sleep 60', run_in_background: true, agentId: 'sub1' } as const
  await $.tool.call(fromSubagent)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No background tasks yet\./ })).toBeDefined()
  await ui.unmount()
})
