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

export type Variant = 'a' | 'b' | 'c'

declare module 'claude-code' {
  interface PluginState {
    'subagent-proto': {
      selected: number
      variant: Variant
      tick: number
      t0: number
    }
  }
}
