import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'

test('refresh bursts share one read, but changes during a read trigger a trailing read', async () => {
  vi.useFakeTimers()
  try {
    const source = readFileSync('src/components/Bookshelf.vue', 'utf8')
    const body = source.slice(source.indexOf('let refreshTask:'), source.indexOf('const refresh ='))
    const script = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const read = vi.fn().mockImplementationOnce(() => blocked).mockResolvedValue(undefined)
    const refresh = new Function('readBooks', 'currentGroup', `${script}; return loadBooks`)(read, { value: null })
    const first = refresh()
    expect(refresh()).toBe(first)
    await vi.advanceTimersByTimeAsync(80)
    expect(read).toHaveBeenCalledTimes(1)
    expect(refresh()).toBe(first)
    release()
    await vi.advanceTimersByTimeAsync(80)
    await first
    expect(read).toHaveBeenCalledTimes(2)
    read.mockRejectedValueOnce(new Error('offline'))
    const failure = refresh().catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(80)
    expect(await failure).toBe('offline')
    const retry = refresh()
    await vi.advanceTimersByTimeAsync(80)
    await expect(retry).resolves.toBeUndefined()
  } finally { vi.useRealTimers() }
})
