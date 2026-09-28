import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let diagnostics: typeof import('../src/core/diagnostics')
let exported: Blob
let saved: Map<string, string>

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  saved = new Map()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => saved.get(key) || null),
    setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
    removeItem: vi.fn((key: string) => saved.delete(key)),
  })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { sireader: {} }))
  vi.stubGlobal('document', { createElement: () => ({ click: vi.fn() }) })
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:test' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  for (const level of ['debug', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {})
  diagnostics = await import('../src/core/diagnostics')
})
afterEach(() => {
  diagnostics.disposeDiagnostics()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const report = async () => { diagnostics.exportDiagnostics({ source: 'settings' }); return JSON.parse(await exported.text()) }

test('repeated window errors retain their count without evicting useful operations', async () => {
  diagnostics.diagnosticLog('info', 'storage.write', { key: 'book' })
  for (let i = 0; i < 100; i++) diagnostics.diagnosticLog('error', 'window.error', { message: 'resize loop' })
  const result = await report()
  const errors = result.entries.filter((entry: any) => entry.event === 'window.error')
  expect(errors).toHaveLength(1)
  expect(errors[0].occurrences).toBe(100)
  expect(result.stats.errors).toBe(100)
})

test('diagnostics are export-only and never replace the host console', async () => {
  const original = console.info
  diagnostics.installDiagnostics()
  expect(console.info).toBe(original)
  diagnostics.diagnosticLog('info', 'silent-event')
  expect(original).not.toHaveBeenCalled()
  expect((await report()).entries.some((entry: any) => entry.event === 'silent-event')).toBe(true)
})

test('repeated installation preserves recent entries and installation context in exports', async () => {
  diagnostics.installDiagnostics({ version: '2.3.4', frontend: 'desktop' })
  diagnostics.diagnosticLog('info', 'recent')
  diagnostics.installDiagnostics({ version: '2.3.4' })
  const result = await report()
  expect(result.entries.filter((entry: any) => entry.event === 'diagnostics.installed')).toHaveLength(1)
  expect(result.entries.some((entry: any) => entry.event === 'recent')).toBe(true)
  expect(result.environment.version).toBe('2.3.4')
  expect(result.environment.frontend).toBe('desktop')
})

test('hostile properties and circular errors cannot interrupt the caller', async () => {
  const object: any = { value: 1 }
  object.self = object
  Object.defineProperty(object, 'broken', { enumerable: true, get() { throw new Error('getter failed') } })
  const cause = new Error('root cause')
  expect(() => diagnostics.diagnosticLog('error', 'operation.failed', { object, error: new Error('wrapper', { cause }) })).not.toThrow()
  const result = await report()
  const entry = result.entries.find((item: any) => item.event === 'operation.failed')
  expect(entry.data.error.cause.message).toBe('root cause')
  expect(entry.data.object.self).toBe('[circular]')
  expect(entry.data.object.broken).toContain('unreadable')
})

test('file failure totals do not count the transaction wrapper twice', async () => {
  diagnostics.diagnosticLog('error', 'storage.write.failed', { key: 'records/a.json', failed: true, durationMs: 15 })
  diagnostics.diagnosticLog('error', 'storage.transact.failed', { key: 'records/a.json', failed: true })
  const result = await report()
  expect(result.stats.keys['records/a.json'].failures).toBe(1)
})

test('export separates current-session IO from retained history', async () => {
  saved.set('sireader:diagnostics:v1', JSON.stringify([{ time: '2026-09-01T00:00:00Z', session: 'old', level: 'error', event: 'window.error' }]))
  diagnostics.installDiagnostics()
  diagnostics.diagnosticLog('debug', 'storage.read', { key: 'bookshelf.json', durationMs: 12 })
  const result = await report()
  expect(result.stats.errors).toBe(1)
  expect(result.sessionStats.errors).toBe(0)
  expect(result.sessionStats.io).toMatchObject({ reads: 1, writes: 0, totalDurationMs: 12, maxDurationMs: 12 })
})

test('clearing diagnostics cancels a previously scheduled persistence', async () => {
  diagnostics.diagnosticLog('info', 'test')
  diagnostics.clearDiagnostics()
  await vi.advanceTimersByTimeAsync(5000)
  expect(localStorage.setItem).not.toHaveBeenCalled()
})

test('oversized payload is bounded and the export reports truncation', async () => {
  diagnostics.diagnosticLog('info', 'large', { content: 'x'.repeat(500000) })
  const result = await report()
  expect(JSON.stringify(result).length).toBeLessThan(100000)
  expect(result.retention.truncatedValues).toBeGreaterThan(0)
})

test('local persistence failures remain visible in an in-memory export', async () => {
  vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('quota') })
  diagnostics.diagnosticLog('info', 'test')
  await vi.advanceTimersByTimeAsync(5000)
  expect((await report()).retention.persistenceError).toContain('quota')
})
