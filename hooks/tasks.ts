import type { Board, ConsoleTask, TaskNotification } from '../types'

export const MAX_TASKS = 20

export function addTask(board: Board, task: ConsoleTask): Board {
  return { tasks: [...board.tasks.filter(x => x.id !== task.id), task].slice(-MAX_TASKS) }
}

export function applyNotification(board: Board, n: TaskNotification, now: number): Board {
  if (!board.tasks.some(x => x.id === n.id)) return board
  return { tasks: board.tasks.map(x => (x.id === n.id ? { ...x, status: n.status, exitCode: n.exitCode, endedAt: x.endedAt ?? now } : x)) }
}

export function expireTasks(board: Board, now: number, graceMs: number): Board {
  const late = (x: ConsoleTask) => !x.status && x.deadline !== undefined && x.deadline + graceMs < now
  if (!board.tasks.some(late)) return board
  return { tasks: board.tasks.map(x => (late(x) ? { ...x, status: 'expired', endedAt: now } : x)) }
}

const AGENT_FINAL = new Set(['completed', 'failed', 'killed'])

export function syncAgents(board: Board, infos: readonly { id: string; status: string }[], now: number): Board {
  let changed = false
  const tasks = board.tasks.map(x => {
    if (x.kind !== 'agent' || x.status) return x
    const info = infos.find(i => i.id === x.id)
    const status = !info ? 'killed' : AGENT_FINAL.has(info.status) ? info.status : undefined
    if (!status) return x
    changed = true
    return { ...x, status, endedAt: now }
  })
  return changed ? { tasks } : board
}

export function unseenAgents<T extends { id: string; status: string; type: string; teammateId?: string }>(
  board: Board,
  infos: readonly T[],
): T[] {
  return infos.filter(
    i => !i.teammateId && i.type !== 'teammate' && !AGENT_FINAL.has(i.status) && !board.tasks.some(x => x.id === i.id),
  )
}

export function pick(board: Board, view: string): ConsoleTask | undefined {
  if (view) return board.tasks.find(x => x.id === view) ?? { id: view, kind: 'agent', command: 'agent', label: 'agent', startedAt: 0 }
  let best: ConsoleTask | undefined
  for (const x of board.tasks) if (!x.status && (!best || x.startedAt >= best.startedAt)) best = x
  if (best) return best
  for (const x of board.tasks) if (!best || (x.endedAt ?? 0) >= (best.endedAt ?? 0)) best = x
  return best
}

export function sweep(board: Board, now: number, view: string, graceMs: number): Board {
  const tasks = board.tasks.filter(x => !x.status || x.id === view || (x.endedAt ?? 0) + graceMs > now)
  return tasks.length === board.tasks.length ? board : { tasks }
}
