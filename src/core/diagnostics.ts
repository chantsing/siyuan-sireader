type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error'
type DiagnosticEntry = { time: string; level: DiagnosticLevel; event: string; session?: string; sequence?: number; occurrences?: number; lastTime?: string; data?: Record<string, unknown> }

const STORAGE_KEY = 'sireader:diagnostics:v1'
const MAX_ENTRIES = 4000
const MAX_CHARACTERS = 1_000_000
const levels: DiagnosticLevel[] = ['debug', 'info', 'warn', 'error']
let entries: DiagnosticEntry[] = []
let sizes: number[] = []
let characters = 0
let loaded = false
let installed = false
let sequence = 0
let session = ''
let context: Record<string, unknown> = {}
let persistTimer: ReturnType<typeof setTimeout> | null = null
let removeDiagnosticListeners: (() => void) | null = null
const retention = { droppedEntries: 0, truncatedValues: 0, persistenceError: '' }

// Resource limits, not redaction. Logging must never break the diagnosed operation.
const clean = (value: unknown): unknown => {
  const seen = new WeakSet<object>()
  let nodes = 500
  let remaining = 16000
  const truncated = () => { retention.truncatedValues++; return '[truncated]' }
  const visit = (item: any, depth: number): any => {
    if (--nodes < 0 || remaining <= 0 || depth > 8) return truncated()
    try {
      if (typeof item === 'string') {
        const limit = Math.min(8000, remaining)
        remaining -= Math.min(item.length, limit)
        return item.length > limit ? item.slice(0, limit) + truncated() : item
      }
      if (item == null || typeof item === 'number' || typeof item === 'boolean') return item
      if (typeof item !== 'object') return visit(String(item), depth + 1)
      if (seen.has(item)) return '[circular]'
      if (item instanceof Date) return item.toISOString()
      if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) return { type: item.constructor.name, byteLength: item.byteLength }
      seen.add(item)
      try {
        const keys = item instanceof Error ? [...new Set(['name', 'message', 'stack', 'cause', ...Object.keys(item)])] : Object.keys(item)
        const result: any = Array.isArray(item) ? [] : Object.create(null)
        for (const key of keys) {
          if (nodes <= 0 || remaining <= 0) {
            if (Array.isArray(result)) result.push(truncated())
            else result['[truncated]'] = truncated()
            break
          }
          remaining -= key.length
          try { result[key] = visit(item[key], depth + 1) } catch { result[key] = '[unreadable property]' }
        }
        return result
      } finally { seen.delete(item) }
    } catch { return '[unreadable value]' }
  }
  return visit(value, 0)
}

const retain = (entry: DiagnosticEntry) => {
  const size = JSON.stringify(entry).length
  entries.push(entry); sizes.push(size); characters += size
  while (entries.length > MAX_ENTRIES || characters > MAX_CHARACTERS) {
    entries.shift(); characters -= sizes.shift() || 0; retention.droppedEntries++
  }
}
const load = () => {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const stored = raw ? JSON.parse(raw) : []
    const history = Array.isArray(stored) ? stored : stored?.entries
    if (Array.isArray(history)) {
      retention.droppedEntries = Math.max(0, Number(stored?.retention?.droppedEntries) || 0) + Math.max(0, history.length - MAX_ENTRIES)
      retention.truncatedValues = Math.max(0, Number(stored?.retention?.truncatedValues) || 0)
      for (const item of history.slice(-MAX_ENTRIES)) {
        if (item && typeof item.time === 'string' && levels.includes(item.level) && typeof item.event === 'string') retain(clean(item) as DiagnosticEntry)
      }
    }
  } catch (error) { retention.persistenceError = String(error) }
}
const persistNow = () => {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = null
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, retention }))
    retention.persistenceError = ''
  } catch (error) { retention.persistenceError = String(error) }
}
const append = (level: DiagnosticLevel, event: string, data?: Record<string, unknown>) => {
  try {
    load()
    session ||= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const entry: DiagnosticEntry = { time: new Date().toISOString(), session, sequence: ++sequence, level, event, ...(data ? { data: clean(data) as Record<string, unknown> } : {}) }
    const previous = entries.at(-1)
    if (event.startsWith('window.') && previous?.session === session && previous.event === event && JSON.stringify(previous.data) === JSON.stringify(entry.data)) {
      previous.occurrences = (previous.occurrences || 1) + 1
      previous.lastTime = entry.time
      entries.pop()
      characters -= sizes.pop() || 0
      retain(previous)
    } else retain(entry)
    if (persistTimer === null) persistTimer = setTimeout(persistNow, 2000)
  } catch { /* Diagnostics must not break storage or the host console. */ }
}

export const diagnosticLog = (level: DiagnosticLevel, event: string, data?: Record<string, unknown>) => {
  append(level, event, data)
}
export const getDiagnosticEntries = () => { load(); return structuredClone(entries) }
export const clearDiagnostics = () => {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = null
  loaded = true
  entries = []; sizes = []; characters = 0
  Object.assign(retention, { droppedEntries: 0, truncatedValues: 0, persistenceError: '' })
  try { localStorage.removeItem(STORAGE_KEY) } catch (error) { retention.persistenceError = String(error) }
}

// Calculate over the exported window, including previous sessions. Higher-level
// errors stay visible without counting one file failure multiple times.
const summarize = (items = entries) => {
  const stats = {
    scope: 'retained-entries', startedAt: items[0]?.time, endedAt: items.at(-1)?.lastTime || items.at(-1)?.time,
    events: Object.create(null), levels: Object.create(null), keys: Object.create(null),
    io: { reads: 0, writes: 0, removes: 0, lists: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0 },
    errors: 0, lastError: undefined as DiagnosticEntry | undefined,
  }
  for (const entry of items) {
    const count = entry.occurrences || 1
    stats.events[entry.event] = (stats.events[entry.event] || 0) + count
    stats.levels[entry.level] = (stats.levels[entry.level] || 0) + count
    if (entry.level === 'error') { stats.errors += count; stats.lastError = entry }
    if (!/^storage\.(read|write|remove|list)(\.failed)?$/.test(entry.event)) continue
    const key = entry.data?.key || entry.data?.prefix
    if (typeof key !== 'string') continue
    const item = stats.keys[key] ||= { reads: 0, writes: 0, removes: 0, lists: 0, missing: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0 }
    if (entry.event.endsWith('.failed')) item.failures++
    else {
      const field = { read: 'reads', write: 'writes', remove: 'removes', list: 'lists' }[entry.event.split('.')[1]]!
      item[field]++
      if (entry.event === 'storage.read' && entry.data?.found === false) item.missing++
    }
    const duration = Number(entry.data?.durationMs) || 0
    item.totalDurationMs += duration
    item.maxDurationMs = Math.max(item.maxDurationMs, duration)
  }
  for (const item of Object.values(stats.keys) as any[]) {
    for (const field of ['reads', 'writes', 'removes', 'lists', 'failures', 'totalDurationMs']) stats.io[field] += item[field]
    stats.io.maxDurationMs = Math.max(stats.io.maxDurationMs, item.maxDurationMs)
  }
  return stats
}

export const exportDiagnostics = (extra: Record<string, unknown> = {}) => {
  diagnosticLog('debug', 'diagnostics.exported', { count: entries.length })
  const report = {
    format: 'siyuan-sireader-diagnostics-v1', exportedAt: new Date().toISOString(),
    environment: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      language: typeof navigator !== 'undefined' ? navigator.language : '',
      platform: typeof navigator !== 'undefined' ? navigator.platform : '',
      url: typeof location !== 'undefined' ? `${location.protocol}//${location.host}` : '',
      ...context, ...(clean(extra) as Record<string, unknown>), session,
    },
    stats: summarize(),
    sessionStats: { ...summarize(entries.filter(entry => entry.session === session)), scope: 'retained-current-session', session },
    retention: { ...retention, maxEntries: MAX_ENTRIES, maxCharacters: MAX_CHARACTERS, retainedEntries: entries.length, characters },
    entries,
  }
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = `siyuan-sireader-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}

export const installDiagnostics = (extra: Record<string, unknown> = {}) => {
  if (installed || typeof window === 'undefined') return
  load()
  installed = true
  context = clean(extra) as Record<string, unknown>
  const onError = (event: ErrorEvent) => diagnosticLog('error', 'window.error', { message: event.message, source: event.filename, line: event.lineno, column: event.colno, error: event.error })
  const onRejection = (event: PromiseRejectionEvent) => diagnosticLog('error', 'window.unhandledrejection', { reason: event.reason })
  const onPageHide = () => persistNow()
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('pagehide', onPageHide)
  const api = ((window as any).sireader ||= {})
  api.exportDiagnostics = exportDiagnostics
  api.clearDiagnostics = clearDiagnostics
  removeDiagnosticListeners = () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('pagehide', onPageHide)
    if (api.exportDiagnostics === exportDiagnostics) delete api.exportDiagnostics
    if (api.clearDiagnostics === clearDiagnostics) delete api.clearDiagnostics
  }
  diagnosticLog('info', 'diagnostics.installed', context)
}

export const disposeDiagnostics = () => {
  removeDiagnosticListeners?.()
  removeDiagnosticListeners = null
  if (persistTimer !== null) persistNow()
  installed = false
}
