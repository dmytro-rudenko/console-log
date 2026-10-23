import { expect, test } from 'claude-code/testing'

import type { Board, ConsoleTask } from '../types'
import { addTask, applyNotification, expireTasks, hasRunning, MAX_TASKS, pick, sweep, syncAgents, unseenAgents } from './tasks'

const t = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => ({ id, kind: 'shell', command: id, startedAt: 0, ...extra })
const ag = (id: string, extra: Partial<ConsoleTask> = {}): ConsoleTask => t(id, { kind: 'agent', ...extra })
const b = (...tasks: ConsoleTask[]): Board => ({ tasks })

test('addTask appends, replaces a task with the same id and keeps the last 20', async () => {
  let x = b()
  for (let i = 0; i < MAX_TASKS + 2; i++) x = addTask(x, t(`b${i}`))
  expect(x.tasks.length).toBe(MAX_TASKS)
  expect(x.tasks[0]?.id).toBe('b2')
  const again = addTask(b(t('a', { status: 'completed', endedAt: 5 }), t('c')), t('a', { startedAt: 9 }))
  expect(again.tasks.map(y => [y.id, y.status, y.endedAt])).toEqual([['c', undefined, undefined], ['a', undefined, undefined]])
})

test('applyNotification sets status, exit code and endedAt once', async () => {
  const x = b(t('a'), t('c'))
  const failed = applyNotification(x, { id: 'a', status: 'failed', exitCode: 1 }, 700)
  expect(failed.tasks[0]).toEqual({ ...t('a'), status: 'failed', exitCode: 1, endedAt: 700 })
  expect(applyNotification(failed, { id: 'a', status: 'failed', exitCode: 1 }, 900).tasks[0]?.endedAt).toBe(700)
  expect(applyNotification(x, { id: 'zz', status: 'failed' }, 1)).toBe(x)
})

test('expireTasks marks running tasks past deadline plus grace as expired and stamps endedAt', async () => {
  const x = b(t('a', { deadline: 1000 }), t('b', { deadline: 9000 }), t('c'), t('d', { deadline: 1000, status: 'failed', endedAt: 3 }))
  const next = expireTasks(x, 7000, 5000)
  expect(next.tasks.map(y => [y.status, y.endedAt])).toEqual([['expired', 7000], [undefined, undefined], [undefined, undefined], ['failed', 3]])
  expect(expireTasks(x, 6000, 5000)).toBe(x)
})

test('hasRunning is true while any task has no status', async () => {
  expect(hasRunning(b(t('a', { status: 'completed' }), t('b')))).toBe(true)
  expect(hasRunning(b(t('a', { status: 'failed' })))).toBe(false)
})

test('syncAgents gives an agent its final status and endedAt from the list', async () => {
  const after = syncAgents(b(ag('a'), ag('b'), ag('c')), [{ id: 'a', status: 'completed' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'killed' }], 400)
  expect(after.tasks.map(x => [x.status, x.endedAt])).toEqual([['completed', 400], ['failed', 400], ['killed', 400]])
})

test('syncAgents marks an agent the list no longer has as killed', async () => {
  expect(syncAgents(b(ag('a')), [], 50).tasks[0]).toEqual({ ...ag('a'), status: 'killed', endedAt: 50 })
})

test('syncAgents leaves pending, running, waiting and idle agents, shells and finished agents alone', async () => {
  const x = b(ag('a'), ag('b'), ag('c'), ag('p'), t('s'), ag('d', { status: 'failed', endedAt: 1 }))
  const infos = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'waiting' },
    { id: 'c', status: 'idle' },
    { id: 'p', status: 'pending' },
    { id: 'd', status: 'completed' },
  ]
  expect(syncAgents(x, infos, 9)).toBe(x)
})

test('unseenAgents keeps live subagents the board lacks and skips teammates and finished ones', async () => {
  const infos = [
    { id: 'known', status: 'running', type: 'Explore' },
    { id: 'new', status: 'running', type: 'general-purpose' },
    { id: 'wait', status: 'pending', type: 'Explore' },
    { id: 'done', status: 'completed', type: 'Explore' },
    { id: 'mate', status: 'running', type: 'teammate' },
    { id: 'named', status: 'idle', type: 'Explore', teammateId: 'bob@crew' },
  ]
  expect(unseenAgents(b(ag('known')), infos).map(i => i.id)).toEqual(['new', 'wait'])
})

test('pick prefers the newest running task, the later one on a tie', async () => {
  expect(pick(b(t('a', { startedAt: 5 }), t('c', { startedAt: 9 }), t('d', { startedAt: 7 })), '')?.id).toBe('c')
  expect(pick(b(t('a', { startedAt: 5 }), t('c', { startedAt: 5 })), '')?.id).toBe('c')
})

test('pick prefers a running task over a newer finished one, then the last finished', async () => {
  expect(pick(b(t('a', { startedAt: 1 }), t('c', { startedAt: 9, status: 'completed', endedAt: 10 })), '')?.id).toBe('a')
  expect(pick(b(t('a', { status: 'failed', endedAt: 20 }), t('c', { startedAt: 9, status: 'completed', endedAt: 10 })), '')?.id).toBe('a')
  expect(pick(b(), '')).toBeUndefined()
})

test('pick gives the agent in view priority, known or not', async () => {
  expect(pick(b(ag('x', { startedAt: 1, status: 'completed', endedAt: 2 }), t('s', { startedAt: 9 })), 'x')?.id).toBe('x')
  expect(pick(b(t('s')), 'ghost')).toEqual({ id: 'ghost', kind: 'agent', command: 'agent', label: 'agent', startedAt: 0 })
})

test('sweep drops a finished task once its grace has passed, never a running one or the one in view', async () => {
  const x = b(t('run'), t('old', { status: 'completed', endedAt: 0 }), t('new', { status: 'failed', endedAt: 5000 }), ag('v', { status: 'killed', endedAt: 0 }))
  expect(sweep(x, 10000, 'v', 10000).tasks.map(y => y.id)).toEqual(['run', 'new', 'v'])
  expect(sweep(x, 15000, '', 10000).tasks.map(y => y.id)).toEqual(['run'])
  expect(sweep(x, 9999, 'v', 10000)).toBe(x)
})
