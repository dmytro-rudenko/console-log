export type ConsoleTask = {
  id: string
  kind: 'shell' | 'monitor'
  command: string
  label?: string
  path?: string
  startedAt: number
  deadline?: number
  status?: string
  exitCode?: number
  viewed?: boolean
}

export type Board = { tasks: ConsoleTask[]; selected: number }

export type TaskNotification = { id: string; status: string; exitCode?: number }

declare module 'claude-code' {
  interface PluginState {
    'console-log': {
      tasks: ConsoleTask[]
      selected: number
      lines: string[]
      pathMissing: boolean
      readFailed: boolean
      dismissed: boolean
      hasCtrlArrows: boolean
    }
  }
}
