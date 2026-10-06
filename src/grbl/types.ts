export interface Vec3 {
  x: number
  y: number
  z: number
}

export type GrblState =
  | 'Idle'
  | 'Run'
  | 'Hold'
  | 'Jog'
  | 'Alarm'
  | 'Door'
  | 'Check'
  | 'Home'
  | 'Sleep'
  | 'Unknown'

export interface GrblStatus {
  state: GrblState
  subState?: string
  mpos?: Vec3
  wpos?: Vec3
  wco?: Vec3
  fs?: { feed: number; spindle: number }
  ov?: [number, number, number]
  pn?: string
  accessories?: string
  buffer?: { planner: number; rx: number }
  homed?: boolean
  raw: string
  timestamp: number
}

export type Feedback =
  | { kind: 'message'; text: string }
  | { kind: 'setting'; key: number; value: string }
  | { kind: 'parser'; raw: string; data: Record<string, string> }
  | { kind: 'probe'; x: number; y: number; z: number; ok: boolean }
  | { kind: 'unknown'; raw: string }

export interface LogEntry {
  id: number
  dir: 'in' | 'out' | 'info' | 'error'
  text: string
  time: number
}
