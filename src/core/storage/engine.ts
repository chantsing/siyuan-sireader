import { pluginStorageAdapter, type StorageAdapter } from './adapter'
import { decodeStoredValue, encodeStoredValue, StorageCorruptionError } from './codec'
import { applyOperations } from './reducer'
import type { StorageOperation, StoredEnvelope } from './types'
import { cloneStorageValue, compactOperationIds } from './types'

export interface StorageKey<T> {
  name: string
  defaultValue: () => T
}

export interface StorageCommitEvent<T = unknown> {
  key: string
  envelope: StoredEnvelope<T>
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const WRITE_VERIFY_ATTEMPTS = 4
const shouldRetry = (error: unknown) => !(error instanceof StorageCorruptionError || error instanceof TypeError)
const transactionId = () => globalThis.crypto?.randomUUID?.()
  || `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export class StorageEngine {
  private cache = new Map<string, StoredEnvelope<unknown>>()
  private present = new Set<string>()
  private queues = new Map<string, Promise<unknown>>()
  private failures = new Map<string, { error: unknown, retry: () => Promise<unknown> }>()
  private listeners = new Set<(event: StorageCommitEvent) => void>()
  private accepting = true

  constructor(private readonly adapter: StorageAdapter) {}

  private publishCache<T>(key: string, envelope: StoredEnvelope<T>, found: boolean) {
    const cached = this.cache.get(key) as StoredEnvelope<T> | undefined
    const winner = cached && (cached.revision > envelope.revision
      || (cached.revision === envelope.revision && cached.updatedAt > envelope.updatedAt))
      ? cached
      : envelope
    this.cache.set(key, cloneStorageValue(winner))
    if (winner === envelope) {
      if (found) this.present.add(key)
      else this.present.delete(key)
    }
    return winner
  }

  private async freshState<T>(key: StorageKey<T>): Promise<{ found: boolean, envelope: StoredEnvelope<T> }> {
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const stored = await this.adapter.read(key.name)
        if (!stored.found) {
        return { found: false, envelope: encodeStoredValue(cloneStorageValue(key.defaultValue()), {
            revision: 0,
            transactionId: '',
            updatedAt: 0,
            appliedOperationIds: [],
          }) }
        }
        try {
          return { found: true, envelope: decodeStoredValue<T>(stored.value).envelope }
        } catch (error) {
          if (error instanceof Error) error.message = `${error.message} (${key.name})`
          throw error
        }
      } catch (error) {
        lastError = error
        if (error instanceof StorageCorruptionError || error instanceof TypeError || attempt >= 2) throw error
        await sleep(40 * (attempt + 1))
      }
    }
    throw lastError
  }

  private async freshEnvelope<T>(key: StorageKey<T>) { return (await this.freshState(key)).envelope }

  private async writeAndVerify<T>(key: StorageKey<T>, next: StoredEnvelope<T>) {
    await this.adapter.write(key.name, next)
    let lastError: unknown
    for (let attempt = 0; attempt < WRITE_VERIFY_ATTEMPTS; attempt++) {
      try {
        const verified = await this.freshEnvelope(key)
        if (verified.revision === next.revision
          && verified.transactionId === next.transactionId
          && verified.checksum === next.checksum) return verified
        lastError = new Error('Concurrent storage write detected')
      } catch (error) {
        lastError = error
      }
      if (attempt + 1 < WRITE_VERIFY_ATTEMPTS) await sleep(40 * (attempt + 1))
    }
    throw lastError || new Error('Storage write verification failed')
  }

  private withCrossContextLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks
    return locks?.request
      ? locks.request(`sireader:${key}`, task) as unknown as Promise<T>
      : task()
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) || Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      const failed = this.failures.get(key)
      if (failed) {
        try {
          await this.withCrossContextLock(key, failed.retry)
          if (this.failures.get(key) === failed) this.failures.delete(key)
        } catch (error) {
          failed.error = error
          throw error
        }
      }
      try {
        return await this.withCrossContextLock(key, task)
      } catch (error) {
        if (shouldRetry(error)) this.failures.set(key, { error, retry: task })
        throw error
      }
    })
    const tracked = current.finally(() => {
      if (this.queues.get(key) === tracked) this.queues.delete(key)
    })
    this.queues.set(key, tracked)
    return tracked
  }

  async read<T>(key: StorageKey<T>, fresh = false): Promise<T> {
    if (!fresh) {
      const cached = this.cache.get(key.name) as StoredEnvelope<T> | undefined
      if (cached) return cloneStorageValue(cached.data)
    }
    const { found, envelope } = await this.freshState(key)
    return cloneStorageValue(this.publishCache(key.name, envelope, found).data)
  }

  async readState<T>(key: StorageKey<T>, fresh = false): Promise<{ found: boolean, value: T }> {
    if (!fresh && this.cache.has(key.name)) {
      return { found: this.present.has(key.name), value: await this.read(key) }
    }
    const { found, envelope } = await this.freshState(key)
    const published = this.publishCache(key.name, envelope, found)
    return { found: this.present.has(key.name), value: cloneStorageValue(published.data) }
  }

  transact<T>(key: StorageKey<T>, operations: StorageOperation[], onCommit?: (data: T) => void): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('Storage is shutting down'))
    const captured = cloneStorageValue(operations)
    let notified = false
    return this.enqueue(key.name, async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        let current: StoredEnvelope<T>
        try { current = await this.freshEnvelope(key) }
        catch (error) {
          lastError = error
          if (attempt < 2) await sleep(40 * (attempt + 1))
          continue
        }
        const result = applyOperations(current.data, captured, current.appliedOperationIds)
        const next = encodeStoredValue(result.data, {
          revision: current.revision + 1,
          transactionId: transactionId(),
          updatedAt: Date.now(),
          appliedOperationIds: result.appliedOperationIds,
        })
        let verified: StoredEnvelope<T>
        try { verified = await this.writeAndVerify(key, next) }
        catch (error) { lastError = error; continue }
        this.publishCache(key.name, verified, true)
        const event = { key: key.name, envelope: cloneStorageValue(verified) }
        for (const listener of this.listeners) {
          try { listener(event) }
          catch (error) { console.error(`[Storage commit listener] ${key.name}`, error) }
        }
        if (!notified && onCommit) {
          notified = true
          try { onCommit(cloneStorageValue(verified.data)) }
          catch (error) { console.error(`[Storage commit callback] ${key.name}`, error) }
        }
        return cloneStorageValue(verified.data)
      }
      const verificationError = new Error(`Storage verification failed for ${key.name}`)
      ;(verificationError as Error & { cause?: unknown }).cause = lastError
      throw verificationError
    })
  }

  mutate<T>(key: StorageKey<T>, mutationId: string, update: (current: T) => T): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('Storage is shutting down'))
    return this.enqueue(key.name, async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        let current: StoredEnvelope<T>
        try { current = await this.freshEnvelope(key) }
        catch (error) {
          lastError = error
          if (attempt < 2) await sleep(40 * (attempt + 1))
          continue
        }
        if (current.appliedOperationIds.includes(mutationId)) return cloneStorageValue(current.data)
        const data = update(cloneStorageValue(current.data))
        const next = encodeStoredValue(data, {
          revision: current.revision + 1,
          transactionId: transactionId(),
          updatedAt: Date.now(),
          appliedOperationIds: compactOperationIds([...current.appliedOperationIds, mutationId]),
        })
        let verified: StoredEnvelope<T>
        try { verified = await this.writeAndVerify(key, next) }
        catch (error) { lastError = error; continue }
        this.publishCache(key.name, verified, true)
        const event = { key: key.name, envelope: cloneStorageValue(verified) }
        for (const listener of this.listeners) {
          try { listener(event) }
          catch (error) { console.error(`[Storage commit listener] ${key.name}`, error) }
        }
        return cloneStorageValue(verified.data)
      }
      const error = new Error(`Storage verification failed for ${key.name}`) as Error & { cause?: unknown }
      error.cause = lastError
      throw error
    })
  }

  remove(key: string) {
    if (!this.accepting) return Promise.reject(new Error('Storage is shutting down'))
    return this.enqueue(key, async () => {
      await this.adapter.remove(key)
      this.cache.delete(key)
      this.present.delete(key)
    })
  }

  releaseOperationIds<T>(key: StorageKey<T>, operationIds: string[]): Promise<T> {
    const remove = new Set(operationIds)
    return this.enqueue(key.name, async () => {
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt++) {
        let current: StoredEnvelope<T>
        try { current = await this.freshEnvelope(key) }
        catch (error) {
          lastError = error
          if (attempt < 2) await sleep(40 * (attempt + 1))
          continue
        }
        const retained = current.appliedOperationIds.filter(id => !remove.has(id))
        if (retained.length === current.appliedOperationIds.length) return cloneStorageValue(current.data)
        const next = encodeStoredValue(current.data, {
          revision: current.revision + 1,
          transactionId: transactionId(),
          updatedAt: Date.now(),
          appliedOperationIds: retained,
        })
        let verified: StoredEnvelope<T>
        try { verified = await this.writeAndVerify(key, next) }
        catch (error) { lastError = error; continue }
        this.publishCache(key.name, verified, true)
        return cloneStorageValue(verified.data)
      }
      const error = new Error(`Storage operation ID cleanup failed for ${key.name}`) as Error & { cause?: unknown }
      error.cause = lastError
      throw error
    })
  }

  invalidate(key?: string) {
    if (key) {
      this.cache.delete(key)
      this.present.delete(key)
    } else {
      this.cache.clear()
      this.present.clear()
    }
  }

  subscribe(listener: (event: StorageCommitEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async flush() {
    while (this.queues.size) {
      await Promise.allSettled([...this.queues.values()])
    }
    if (this.failures.size) {
      await Promise.allSettled([...this.failures.keys()].map(key => this.enqueue(key, async () => undefined)))
      while (this.queues.size) await Promise.allSettled([...this.queues.values()])
    }
    const errors = [...this.failures.values()].map(failure => failure.error)
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      const error = new Error(`Storage flush failed (${errors.length} errors)`) as Error & { errors?: unknown[] }
      error.errors = errors
      throw error
    }
  }

  stopAccepting() { this.accepting = false }
}

export const createStorageEngine = (adapter: StorageAdapter) => new StorageEngine(adapter)
export const storageEngine = createStorageEngine(pluginStorageAdapter)
export const invalidateStorage = (key?: string) => storageEngine.invalidate(key)
export const flushStorage = () => storageEngine.flush()
