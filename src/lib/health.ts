export type OpType = 'read' | 'write' | 'delete'
export type DataSource = 'supabase' | 'local'

export interface DbOp {
  id: string
  ts: number
  type: OpType
  table: string
  success: boolean
  duration: number
  source: DataSource
  detail?: string
}

class HealthTracker {
  private ops: DbOp[] = []
  private readonly boot = Date.now()
  private listeners = new Set<() => void>()

  record(op: Omit<DbOp, 'id'>) {
    this.ops.push({ ...op, id: Math.random().toString(36).slice(2, 9) })
    if (this.ops.length > 300) this.ops.shift()
    this.listeners.forEach(fn => fn())
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  reset() {
    this.ops = []
    this.listeners.forEach(fn => fn())
  }

  get stats() {
    const all = this.ops
    const recent50 = all.slice(-50)
    const sb = recent50.filter(o => o.source === 'supabase')
    const reads = recent50.filter(o => o.type === 'read')
    const writes = recent50.filter(o => o.type === 'write' || o.type === 'delete')

    const pct = (arr: DbOp[]) =>
      arr.length ? Math.round(arr.filter(o => o.success).length / arr.length * 100) : 100

    const sbConnected = sb.some(o => o.success)
    const avgMs = recent50.length
      ? Math.round(recent50.reduce((s, o) => s + o.duration, 0) / recent50.length)
      : 0

    const writeOk = pct(writes)
    const readOk = pct(reads)
    const overall: 'healthy' | 'degraded' | 'offline' =
      !sbConnected ? 'degraded'
      : writeOk < 50 || readOk < 50 ? 'offline'
      : writeOk < 90 || readOk < 90 ? 'degraded'
      : 'healthy'

    return {
      uptime: Date.now() - this.boot,
      totalOps: all.length,
      sbConnected,
      sbSuccessPct: pct(sb),
      readSuccessPct: readOk,
      writeSuccessPct: writeOk,
      avgMs,
      overall,
      localMode: !sbConnected,
      recent: [...all].reverse().slice(0, 25),
    }
  }
}

export const health = new HealthTracker()
