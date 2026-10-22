import { expect, test } from 'claude-code/testing'

import type { Board, ConsoleTask } from '../types'
import { addTask, applyNotification, dropTask, expireTasks, hasRunning, MAX_TASKS, selectTask, syncAgents, unseenAgents } from './tasks'

const t = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id, kind: 'shell', command: id, startedAt: 0, ...extra })
const empty: Board = { tasks: [], selected: -1 }

test('addTask appends, selects the new task and keeps the last 20', async () => {
  let b = empty
  for (let i = 0; i < MAX_TASKS + 2; i++) b = addTask(b, t(`b${i}`))
  expect(b.tasks.length).toBe(MAX_TASKS)
  expect(b.tasks[0]?.id).toBe('b2')
  expect(b.selected).toBe(MAX_TASKS - 1)
})

test('applyNotification never marks a task viewed, even the selected one', async () => {
  const b = addTask(addTask(empty, t('a')), t('b'))
  const failedSelected = applyNotification(b, { id: 'b', status: 'failed', exitCode: 1 })
  expect(failedSelected.tasks[1]).toEqual({ ...t('b'), status: 'failed', exitCode: 1, viewed: false })
  const failedOther = applyNotification(b, { id: 'a', status: 'failed', exitCode: 2 })
  expect(failedOther.tasks[0]?.viewed).toBe(false)
  const done = applyNotification(b, { id: 'b', status: 'completed', exitCode: 0 })
  expect(done.tasks[1]?.viewed).toBe(false)
  expect(applyNotification(b, { id: 'zz', status: 'failed' })).toBe(b)
})

test('a failed task selected when it fails survives moving away once, and goes after a visit', async () => {
  let b: Board = { tasks: [t('a'), t('b')], selected: 0 }
  b = applyNotification(b, { id: 'a', status: 'failed', exitCode: 1 })
  b = selectTask(b, 1)
  expect(b.tasks.map(x => x.id)).toEqual(['a', 'b'])
  b = selectTask(b, 0)
  expect(b.tasks[0]?.viewed).toBe(true)
  b = selectTask(b, 1)
  expect(b.tasks.map(x => x.id)).toEqual(['b'])
})

test('expireTasks marks running tasks past deadline plus grace as expired', async () => {
  const b: Board = {
    tasks: [t('a', { deadline: 1000 }), t('b', { deadline: 9000 }), t('c'), t('d', { deadline: 1000, status: 'failed' })],
    selected: 0,
  }
  const next = expireTasks(b, 7000, 5000)
  expect(next.tasks.map(x => x.status)).toEqual(['expired', undefined, undefined, 'failed'])
  expect(next.selected).toBe(0)
  expect(expireTasks(b, 6000, 5000).tasks[0]?.status).toBeUndefined()
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

const ag = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => t(id, { kind: 'agent', ...extra })

test('syncAgents gives an agent its final status from the list', async () => {
  const b: Board = { tasks: [ag('a'), ag('b'), ag('c')], selected: 0 }
  const after = syncAgents(b, [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'killed' }])
  expect(after.tasks.map(x => [x.status, x.viewed])).toEqual([['completed', false], ['failed', false], ['killed', false]])
  expect(after.selected).toBe(0)
})

test('syncAgents marks an agent the list no longer has as killed', async () => {
  const after = syncAgents({ tasks: [ag('a')], selected: 0 }, [])
  expect(after.tasks[0]).toEqual({ ...ag('a'), status: 'killed', viewed: false })
})

test('syncAgents leaves pending, running, waiting and idle agents, shells and finished agents alone', async () => {
  const b: Board = { tasks: [ag('a'), ag('b'), ag('c'), ag('p'), t('s'), ag('d', { status: 'failed', viewed: true })], selected: 0 }
  const infos = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'waiting' },
    { id: 'c', status: 'idle' },
    { id: 'p', status: 'pending' },
    { id: 'd', status: 'completed' },
  ]
  expect(syncAgents(b, infos)).toBe(b)
})

test('unseenAgents keeps live subagents the board lacks and skips teammates and finished ones', async () => {
  const b: Board = { tasks: [ag('known')], selected: 0 }
  const infos = [
    { id: 'known', status: 'running', type: 'Explore' },
    { id: 'new', status: 'running', type: 'general-purpose' },
    { id: 'wait', status: 'pending', type: 'Explore' },
    { id: 'done', status: 'completed', type: 'Explore' },
    { id: 'mate', status: 'running', type: 'teammate' },
    { id: 'named', status: 'idle', type: 'Explore', teammateId: 'bob@crew' },
  ]
  expect(unseenAgents(b, infos).map(i => i.id)).toEqual(['new', 'wait'])
})
