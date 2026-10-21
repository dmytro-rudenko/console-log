export function parseTaskNotification(text: string): { id: string; status: string; exitCode?: number } | undefined {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim()
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim()
  if (!id || !status || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !/^[a-z_]{1,32}$/.test(status)) return undefined
  const summary = /<summary>([^<]*)<\/summary>/.exec(text)?.[1]?.trim() ?? ''
  const code = /exit code (-?\d+)\)?$/.exec(summary)?.[1]
  return code === undefined ? { id, status } : { id, status, exitCode: Number(code) }
}

export function parseBashInput(text: string): string | undefined {
  const command = /<bash-input>([\s\S]*?)<\/bash-input>/.exec(text)?.[1]?.trim()
  return command || undefined
}

export function parseUserBackground(text: string): { id: string; path: string } | undefined {
  const m = /Command was manually backgrounded by user with ID: ([A-Za-z0-9_-]{1,64})\. Output is being written to: (\/[^\s<]+\.output)/.exec(text)
  return m ? { id: m[1]!, path: m[2]! } : undefined
}
