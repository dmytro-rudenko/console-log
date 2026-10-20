import { expect, test } from 'claude-code/testing'

import type { Board, ConsoleTask } from '../types'
import { addTask, applyNotification, dropTask, hasRunning, MAX_TASKS, selectTask } from './tasks'

const t = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id, kind: 'shell', command: id, startedAt: 0, ...extra })
const empty: Board = { tasks: [], selected: -1 }

test('addTask appends, selects the new task and keeps the last 20', async () => {
  let b = empty
  for (let i = 0; i < MAX_TASKS + 2; i++) b = addTask(b, t(`b${i}`))
  expect(b.tasks.length).toBe(MAX_TASKS)
  expect(b.tasks[0]?.id).toBe('b2')
  expect(b.selected).toBe(MAX_TASKS - 1)
})

test('applyNotification marks viewed only for the selected non-completed task', async () => {
  const b = addTask(addTask(empty, t('a')), t('b'))
  const failedSelected = applyNotification(b, { id: 'b', status: 'failed', exitCode: 1 })
  expect(failedSelected.tasks[1]).toEqual({ ...t('b'), status: 'failed', exitCode: 1, viewed: true })
  const failedOther = applyNotification(b, { id: 'a', status: 'failed', exitCode: 2 })
  expect(failedOther.tasks[0]?.viewed).toBe(false)
  const done = applyNotification(b, { id: 'b', status: 'completed', exitCode: 0 })
  expect(done.tasks[1]?.viewed).toBe(false)
  expect(applyNotification(b, { id: 'zz', status: 'failed' })).toBe(b)
})

test('selectTask marks a finished target viewed and drops the viewed task it leaves', async () => {
  let b: Board = { tasks: [t('a', { status: 'failed', exitCode: 1 }), t('b'), t('c')], selected: 2 }
  b = selectTask(b, 0)
  expect(b.selected).toBe(0)
  expect(b.tasks[0]?.viewed).toBe(true)
  b = selectTask(b, 1)
  expect(b.tasks.map(x => x.id)).toEqual(['b', 'c'])
  expect(b.selected).toBe(0)
})

test('dropTask keeps the selection by id and closes to -1 when empty', async () => {
  const b: Board = { tasks: [t('a'), t('b'), t('c')], selected: 2 }
  expect(dropTask(b, 'a')).toEqual({ tasks: [t('b'), t('c')], selected: 1 })
  expect(dropTask(b, 'c')).toEqual({ tasks: [t('a'), t('b')], selected: 1 })
  expect(dropTask({ tasks: [t('a')], selected: 0 }, 'a')).toEqual({ tasks: [], selected: -1 })
})

test('hasRunning is true while any task has no status', async () => {
  expect(hasRunning({ tasks: [t('a', { status: 'completed' }), t('b')], selected: 0 })).toBe(true)
  expect(hasRunning({ tasks: [t('a', { status: 'failed' })], selected: 0 })).toBe(false)
})
