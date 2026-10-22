const SEQUENCES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[ -/]*[0-~]|\x9b[0-?]*[ -/]*[@-~]|[\x80-\x9f]/g
const CONTROLS = /[\x00-\x08\x0a-\x1f\x7f]/g

export function sanitize(text: string): string {
  return text.replace(SEQUENCES, '').replace(CONTROLS, '')
}
