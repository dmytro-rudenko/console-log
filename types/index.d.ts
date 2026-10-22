export type ConsoleTask = {
  id: string
  kind: 'shell' | 'monitor' | 'agent'
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

export type OutLine = { text: string; tone: 'text' | 'tool' | 'result' | 'error' | 'muted' }

declare module 'claude-code' {
  interface PluginState {
    'console-log': {
      tasks: ConsoleTask[]
      selected: number
      lines: Shaped<OutLine[]>
      pathMissing: boolean
      readFailed: boolean
      dismissed: boolean
      hasCtrlArrows: boolean
    }
  }
}
