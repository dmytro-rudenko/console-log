import type { Board, ConsoleTask, TaskNotification } from '../types'

export const MAX_TASKS = 20

export function addTask(board: Board, task: ConsoleTask): Board {
  const tasks = [...board.tasks.filter(x => x.id !== task.id), task].slice(-MAX_TASKS)
  return { tasks, selected: tasks.length - 1 }
}

export function applyNotification(board: Board, n: TaskNotification): Board {
  const at = board.tasks.findIndex(x => x.id === n.id)
  if (at < 0) return board
  const tasks = board.tasks.map((x, i) => (i === at ? { ...x, status: n.status, exitCode: n.exitCode, viewed: false } : x))
  return { ...board, tasks }
}

export function dropTask(board: Board, id: string): Board {
  const at = board.tasks.findIndex(x => x.id === id)
  if (at < 0) return board
  const keep = board.tasks[board.selected]?.id
  const tasks = board.tasks.filter(x => x.id !== id)
  if (tasks.length === 0) return { tasks, selected: -1 }
  const kept = tasks.findIndex(x => x.id === keep)
  return { tasks, selected: kept >= 0 ? kept : Math.min(at, tasks.length - 1) }
}

export function selectTask(board: Board, i: number): Board {
  const target = board.tasks[i]
  if (!target || i === board.selected) return board
  const prev = board.tasks[board.selected]
  const tasks = board.tasks.map((x, j) => (j === i && x.status && x.status !== 'completed' ? { ...x, viewed: true } : x))
  const next = { tasks, selected: i }
  return prev?.viewed ? dropTask(next, prev.id) : next
}

export function hasRunning(board: Board): boolean {
  return board.tasks.some(x => !x.status)
}

export function expireTasks(board: Board, now: number, graceMs: number): Board {
  if (!board.tasks.some(x => !x.status && x.deadline !== undefined && x.deadline + graceMs < now)) return board
  const tasks = board.tasks.map(x =>
    !x.status && x.deadline !== undefined && x.deadline + graceMs < now ? { ...x, status: 'expired' } : x,
  )
  return { ...board, tasks }
}

const AGENT_FINAL = new Set(['completed', 'failed', 'killed'])

export function syncAgents(board: Board, infos: readonly { id: string; status: string }[]): Board {
  let changed = false
  const tasks = board.tasks.map(x => {
    if (x.kind !== 'agent' || x.status) return x
    const info = infos.find(i => i.id === x.id)
    const status = !info ? 'killed' : AGENT_FINAL.has(info.status) ? info.status : undefined
    if (!status) return x
    changed = true
    return { ...x, status, viewed: false }
  })
  return changed ? { ...board, tasks } : board
}
