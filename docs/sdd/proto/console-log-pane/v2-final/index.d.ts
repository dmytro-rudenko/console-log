export type BgTask = {
  id: string
  kind: 'shell' | 'monitor'
  command: string
  label?: string
  path: string
  startedAt: number
  status?: string
  exitCode?: number
  viewed?: boolean
}

export type Variant = 'a' | 'b' | 'c'

declare module 'claude-code' {
  interface PluginState {
    'bg-tail': {
      tasks: BgTask[]
      selected: number
      lines: string[]
      offset: number
      variant: Variant
    }
  }
}
