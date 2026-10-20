export function parseTaskNotification(text: string): { id: string; status: string; exitCode?: number } | undefined {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1]?.trim()
  const status = /<status>([^<]+)<\/status>/.exec(text)?.[1]?.trim()
  if (!id || !status) return undefined
  const summary = /<summary>([^<]*)<\/summary>/.exec(text)?.[1]?.trim() ?? ''
  const code = /exit code (-?\d+)\)?$/.exec(summary)?.[1]
  return code === undefined ? { id, status } : { id, status, exitCode: Number(code) }
}
