export type ConsoleTask = {
  id: string
  kind: 'shell' | 'monitor' | 'agent'
  command: string
  label?: string
  path?: string
  startedAt: number
  endedAt?: number
  deadline?: number
  status?: string
  exitCode?: number
}

export type Board = { tasks: ConsoleTask[] }

export type TaskNotification = { id: string; status: string; exitCode?: number }

export type OutLine = { text: string; tone: 'text' | 'tool' | 'result' | 'error' | 'muted' }

declare module 'claude-code' {
  interface PluginState {
    'console-log': {
      tasks: ConsoleTask[]
      view: string
      lines: Shaped<OutLine[]>
      pathMissing: boolean
      readFailed: boolean
      dismissed: boolean
    }
  }
}
