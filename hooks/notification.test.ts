import { expect, test } from 'claude-code/testing'

import { parseTaskNotification } from './notification'

const note = (id: string, status: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/tmp/claude-1000/p/s/tasks/${id}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

test('completed with exit code 0', async () => {
  expect(parseTaskNotification(note('b1', 'completed', 'Background command "lint" completed (exit code 0)'))).toEqual({ id: 'b1', status: 'completed', exitCode: 0 })
})

test('failed with exit code 1 and 3', async () => {
  expect(parseTaskNotification(note('b2', 'failed', 'Background command "jest" failed with exit code 1'))).toEqual({ id: 'b2', status: 'failed', exitCode: 1 })
  expect(parseTaskNotification(note('b3', 'failed', 'Background command "x" failed with exit code 3'))).toEqual({ id: 'b3', status: 'failed', exitCode: 3 })
})

test('negative exit code', async () => {
  expect(parseTaskNotification(note('b4', 'completed', 'Background command "vite" completed (exit code -1)'))).toEqual({ id: 'b4', status: 'completed', exitCode: -1 })
})

test('monitor stream end has no exit code', async () => {
  expect(parseTaskNotification(note('m1', 'completed', 'Monitor "ticks" stream ended'))).toEqual({ id: 'm1', status: 'completed' })
})

test('text that is not a notification', async () => {
  expect(parseTaskNotification('run the tests please')).toBeUndefined()
  expect(parseTaskNotification('<task-id>x</task-id> without status')).toBeUndefined()
})

test('exit code mentioned inside the description does not win', async () => {
  expect(parseTaskNotification(note('b5', 'completed', 'Background command "verify exit code 2 on bad args" completed (exit code 0)'))).toEqual({ id: 'b5', status: 'completed', exitCode: 0 })
  expect(parseTaskNotification(note('m2', 'completed', 'Monitor "exit code 5 watcher" stream ended'))).toEqual({ id: 'm2', status: 'completed' })
})
