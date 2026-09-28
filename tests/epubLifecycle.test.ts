import { readFileSync } from 'node:fs'
import { afterEach, expect, test, vi } from 'vitest'
import ts from 'typescript'

afterEach(() => vi.unstubAllGlobals())

test('resize delivery is deferred, coalesced, size-aware, and cancelled on disconnect', async () => {
  let deliver!: (entries: any[]) => void
  const frames = new Map<number, Function>()
  let id = 0
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback: any) { deliver = callback } disconnect = disconnect })
  vi.stubGlobal('requestAnimationFrame', (callback: Function) => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  const { observeResize } = await import('../node_modules/foliate-js/resize-observer.js')
  const update = vi.fn()
  const observer = observeResize(update)
  const target = { isConnected: true }
  const entry = (width: number) => [{ target, contentRect: { width, height: 100 } }]
  deliver(entry(100)); deliver(entry(200))
  expect(update).not.toHaveBeenCalled()
  expect(frames.size).toBe(1)
  const run = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()) }
  run()
  expect(update).toHaveBeenCalledTimes(1)
  deliver(entry(200)); run()
  expect(update).toHaveBeenCalledTimes(1)
  deliver(entry(300)); observer.disconnect(); run()
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(update).toHaveBeenCalledTimes(1)
  deliver(entry(400)); run()
  expect(update).toHaveBeenCalledTimes(1)
})

test('paginator disconnects every observed target when destroyed', () => {
  const source = readFileSync('node_modules/foliate-js/paginator.js', 'utf8')
  expect(source).not.toContain('this.#observer.unobserve(this)')
  expect(source).toContain('this.#observer.disconnect()')
})

test('reader stops layout and settings listeners before awaiting persistence', async () => {
  const source = readFileSync('src/core/epub/reader.ts', 'utf8')
  const ast = ts.createSourceFile('reader.ts', source, ts.ScriptTarget.Latest, true)
  const reader = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoliateReader') as ts.ClassDeclaration
  const method = reader.members.find(node => node.name?.getText(ast) === 'destroy')!.getText(ast)
  const script = ts.transpileModule(`const lifecycle = { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const frames = new WeakMap()
  const destroy = new Function('marginalFrames', 'diagnosticLog', 'readText', `${script}; return lifecycle.destroy`)(frames, vi.fn(), (value: any) => value)
  const removeEventListener = vi.fn()
  vi.stubGlobal('window', { removeEventListener })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const context = { destroyed: false, onSettingsChanged: vi.fn(), themeObserver: { disconnect: vi.fn() }, eventListeners: new Map(), clockTimer: null,
    marks: { destroy: () => pending }, view: { close: vi.fn(), remove: vi.fn(), book: { destroy: vi.fn() } } }
  frames.set(context.view, 1)
  const closing = destroy.call(context)
  expect(context.view.close).toHaveBeenCalledTimes(1)
  expect(removeEventListener).toHaveBeenCalledWith('sireaderSettingsUpdated', context.onSettingsChanged)
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  release()
  await closing
  await destroy.call(context)
  expect(context.view.close).toHaveBeenCalledTimes(1)
  expect(context.view.remove).toHaveBeenCalledTimes(1)
})
