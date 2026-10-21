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

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const note = (id: string, status: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/${id}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

test('a monitor past its deadline shows as expired', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('process.run', (_, e) => (e.argv[0] === 'tail' ? ok('event\n') : ok('/tmp/m1.output\n')))
  on('tool.call', () => ({ result: { taskId: 'm1', timeoutMs: 3000 } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Monitor', description: 'watch logs', timeout_ms: 3000, command: 'tail -f x' })
  await clock.settle()
  await clock.advance(9000)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /expired/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /■/ })).toBeDefined()
  await ui.unmount()
})

test('a task whose output path cannot be resolved still becomes a tab', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('process.run', () => { throw new Error('no sh') })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b9' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'make', description: 'build all', run_in_background: true })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /build all/ })).toBeDefined()
  await ui.unmount()
})

test('two tasks failing together both keep their status', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  const clock = mock.clock(on)
  let n = 0
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('prompt.submit', (_, e) => e)
  on('process.run', (_, e) => (e.argv[0] === 'tail' ? ok('x\n') : ok('/tmp/out.output\n')))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `c${++n}` } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'one', description: 'job one', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'two', description: 'job two', run_in_background: true })
  await clock.settle()
  const origin = { kind: 'task-notification' } as const
  await Promise.all([
    $.prompt.submit({ text: note('c1', 'failed', 'Background command "one" failed with exit code 1'), origin, wait: false }),
    $.prompt.submit({ text: note('c2', 'failed', 'Background command "two" failed with exit code 2'), origin, wait: false }),
  ])
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: /^✗/ })).length).toBe(2)
  await ui.unmount()
})

test('a task stopped with TaskStop leaves the pane and the pane closes', async ($, on) => {
  mock.env(on, { HOME: '/home/nobody' })
  const clock = mock.clock(on)
  const closed: string[] = []
  on('command.register', () => ({ value: { command: 'console-log' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'S1' }))
  on('fs.read', () => { throw new Error('no file') })
  on('process.run', (_, e) => (e.argv[0] === 'tail' ? ok('x\n') : ok('/tmp/s1.output\n')))
  on('tool.call', (_, e) =>
    e.tool === 'TaskStop'
      ? { result: { message: 'stopped', task_id: 's1', task_type: 'local_bash' } }
      : { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 's1' } },
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'sleep infinity', description: 'dev server', run_in_background: true })
  await clock.settle()
  await $.tool.call({ tool: 'TaskStop', task_id: 's1' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /■/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(11000)
  expect(closed).toContain('console-log')
})
