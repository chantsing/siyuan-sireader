import { bookRecordKey, deleteBookAnnotation, readBookRecord as loadBookRecord, removeBookRecord, transactBookRecord, type BookRecord, upsertBookAnnotation, flushStorage, storageEngine, type StorageKey, writeSequentially, storageTransactionStep, leafEntries } from './storage'

const BOOK_INDEX_KEY = 'bookshelf.json'
const SETTINGS_KEY = 'settings.json'
const DAILY_READING_KEY = 'daily.json'

const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b)
export interface Book {
  url: string
  title: string
  author: string
  cover: string
  format: string
  path: string
  size: number
  added: number
  read: number
  finished: number
  status: string
  progress: number
  time: number
  chapter: number
  total: number
  pos: any
  rating: number
  meta: any
  tags: string[]
  groups: string[]
  bindDocId?: string
  bindDocName?: string
  dataId?: string
  fingerprint?: string
  annotationCount?: number
}

export type AnnotationType = 'highlight' | 'note' | 'bookmark' | 'vocab' | 'shape' | 'ink' | 'daily_reading'

export interface Annotation {
  id: string
  book: string
  type: AnnotationType
  loc: string
  text: string
  note: string
  tags?: string[]
  color: string
  data: any
  created: number
  updated: number
  chapter: string
  block: string
  format?: 'pdf' | 'epub'
  page?: number
  cfi?: string
  section?: number
  rects?: any[]
  style?: string
  customOrder?: number
  shapeType?: string
  filled?: boolean
  paths?: any[]
  date?: string
  duration?: number
}

type StoredIndex = Record<string, Book>
type StoredSettings = Record<string, any>
type DailyReadingStore = Record<string, Record<string, number>>
const booksKey: StorageKey<StoredIndex> = { name: BOOK_INDEX_KEY, defaultValue: () => ({}) }
const settingsKey: StorageKey<StoredSettings> = { name: SETTINGS_KEY, defaultValue: () => ({}) }
const dailyKey: StorageKey<DailyReadingStore> = { name: DAILY_READING_KEY, defaultValue: () => ({}) }
const operationId = (label: string) => `${label}:${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}`

const emptyBook = (book: Partial<Book> & Pick<Book, 'url' | 'title' | 'format' | 'status'>): Book => ({
  url: book.url,
  title: book.title,
  author: '',
  cover: '',
  format: book.format,
  path: '',
  size: 0,
  added: Date.now(),
  read: Date.now(),
  finished: 0,
  status: book.status,
  progress: 0,
  time: 0,
  chapter: 0,
  total: 0,
  pos: {},
  rating: 0,
  meta: {},
  tags: [],
  groups: [],
  bindDocId: '',
  bindDocName: '',
})

export class ReaderDatabase {
  async init() {}

  async saveNow() {
    await flushStorage()
  }

  async cleanup() {
    await this.saveNow()
  }

  private stripBookForIndex(book: Partial<Book> & Pick<Book, 'url' | 'title' | 'format' | 'status'>): Book {
    return {
      url: book.url,
      title: book.title,
      author: book.author || '',
      cover: book.cover || '',
      format: book.format,
      path: '',
      size: Number(book.size || 0),
      added: Number(book.added || Date.now()),
      read: Number(book.read || book.added || Date.now()),
      finished: Number(book.finished || 0),
      status: book.status,
      progress: Number(book.progress || 0),
      time: Number(book.time || 0),
      chapter: Number(book.chapter || 0),
      total: Number(book.total || 0),
      pos: {},
      rating: Number(book.rating || 0),
      meta: {},
      tags: Array.from(new Set(book.tags || [])),
      groups: Array.from(new Set(book.groups || [])),
      bindDocId: book.bindDocId || '',
      bindDocName: book.bindDocName || '',
      dataId: book.dataId || '',
      fingerprint: book.fingerprint || '',
    }
  }

  private mergeRecordBook = (book: Book, record?: Partial<Book> | null) =>
    record ? { ...record, ...book, path: record.path || book.path, meta: record.meta || book.meta, pos: record.pos || book.pos } : book

  private dataKey = (book: Pick<Book, 'url'> & Partial<Pick<Book, 'dataId'>>) => book.dataId || book.url

  private readBookRecord = async (book: Book) =>
    await loadBookRecord(this.dataKey(book)) || (book.dataId && book.dataId !== book.url ? await loadBookRecord(book.url) : null) || { version: 1, book: { ...book }, annotations: [], updatedAt: Date.now() } as BookRecord

  private listBooks = async (orderBy = 'read DESC') => {
    const books = Object.values((await storageEngine.read(booksKey)))
    const [field, direction = 'DESC'] = orderBy.split(/\s+/)
    const getter = (book: Book) => {
      if (field === 'read') return book.read || 0
      if (field === 'added') return book.added || 0
      if (field === 'progress') return book.progress || 0
      if (field === 'rating') return book.rating || 0
      if (field === 'time') return book.time || 0
      if (field === 'title') return (book.title || '').toLowerCase()
      if (field === 'author') return (book.author || '').toLowerCase()
      return book.read || 0
    }
    return [...books].sort((a, b) => {
      const av = getter(a)
      const bv = getter(b)
      if (av === bv) return 0
      if (direction.toUpperCase() === 'ASC') return av > bv ? 1 : -1
      return av < bv ? 1 : -1
    })
  }

  private async hydrateBook(book: Book) {
    const record = await this.readBookRecord(book)
    const full = {
      ...this.mergeRecordBook(book, record?.book),
      annotationCount: record?.annotations?.length || 0,
    }
    return full
  }

  private async countRecordAnnotations(books: Book[]) {
    return (await Promise.all(books.map(async book => (await this.readBookRecord(book))?.annotations?.length || 0))).reduce((sum, count) => sum + count, 0)
  }

  async getBook(url: string) {
    const book = (await storageEngine.read(booksKey))[url]
    return book ? this.hydrateBook(book) : null
  }

  async getBooks() {
    return this.listBooks('read DESC')
  }

  async saveBook(book: Partial<Book> & Pick<Book, 'url' | 'title' | 'format' | 'status'>) {
    const existingIndexBook = (await storageEngine.read(booksKey))[book.url]
    const record = await loadBookRecord(book.dataId || book.url) || await loadBookRecord(book.url)
    const current = existingIndexBook ? this.mergeRecordBook(existingIndexBook, record?.book) : null
    const hasPath = Object.prototype.hasOwnProperty.call(book, 'path')
    const hasCover = Object.prototype.hasOwnProperty.call(book, 'cover')
    const fullBook = {
      ...(current || emptyBook(book)),
      ...book,
      path: hasPath ? book.path || '' : current?.path || '',
      cover: hasCover ? book.cover || '' : current?.cover || '',
      tags: book.tags || current?.tags || record?.book?.tags || [],
      groups: book.groups || current?.groups || record?.book?.groups || [],
    } as Book
    const prevBook = current ? { ...current } : null
    if (same(prevBook, fullBook)) return
    const indexBook = this.stripBookForIndex(fullBook)
    const recordKey = bookRecordKey(this.dataKey(fullBook))
    await writeSequentially('book-save', [
      storageTransactionStep('book-record', { name: recordKey.name, defaultValue: recordKey.defaultValue() }, [
        { id: operationId('record-book:patch'), type: 'patch', path: ['book'], value: fullBook as unknown as Record<string, unknown> },
        { id: operationId('record:touch'), type: 'set', path: ['updatedAt'], value: Date.now() },
      ]),
      storageTransactionStep('book-index', { name: booksKey.name, defaultValue: booksKey.defaultValue() }, [
        { id: operationId('book:set'), type: 'set', path: [indexBook.url], value: indexBook },
      ]),
    ])
  }

  async patchBook(url: string, patch: Partial<Book>) {
    const current = (await storageEngine.read(booksKey))[url]
    if (!current) return false
    const merged = { ...current, ...patch } as Book
    const dataKey = this.dataKey(merged)
    const recordKey = bookRecordKey(dataKey)
    await storageEngine.transact(recordKey, [{ id: operationId('record-book:patch'), type: 'patch', path: ['book'], value: patch as Record<string, unknown> }])
    await storageEngine.mutate(booksKey, 'book:patch', latest => latest[url]
      ? { ...latest, [url]: this.stripBookForIndex({ ...latest[url], ...patch }) } : latest)
    return true
  }

  async incrementBook(url: string, field: 'time', value: number, patch: Partial<Book> = {}) {
    const current = (await storageEngine.read(booksKey))[url]
    if (!current) return false
    await storageEngine.mutate(booksKey, 'book:increment', latest => latest[url]
      ? { ...latest, [url]: { ...latest[url], ...patch, [field]: Number(latest[url][field] || 0) + value } } : latest)
    return true
  }

  async updateProgress(url: string, progress: number, chapter?: number, cfi?: string, pdf?: { key: string; totalPages: number }) {
    const book = (await storageEngine.read(booksKey))[url]
    if (!book) return false
    const value = Math.max(0, Math.min(100, progress)), now = Date.now()
    const patch = (current: Partial<Book>) => ({ progress: value,
      status: current.status === 'finished' ? 'finished' : value === 100 ? 'finished' : value > 0 ? 'reading' : 'unread',
      ...(chapter !== undefined ? { chapter } : {}),
    })
    let changed = false
    await storageEngine.mutate(bookRecordKey(pdf?.key || this.dataKey(book)), 'progress', record => {
      const current = { ...book, ...record.book }
      const next = { ...patch({ ...current, status: book.status }), pos: { ...current.pos, ...(chapter !== undefined ? { chapter } : {}), ...(cfi !== undefined ? { cfi } : {}) } }
      const pdfChanged = pdf && (record.progress?.pageNumber !== chapter || record.progress?.totalPages !== pdf.totalPages)
      if (!pdfChanged && Object.entries(next).every(([key, value]) => same(current[key], value))) return record
      changed = true
      return { ...record, book: { ...record.book, ...next, read: now, pos: { ...next.pos, timestamp: now }, ...(value === 100 && !current.finished ? { finished: now } : {}) },
        ...(pdf ? { progress: { pageNumber: chapter!, totalPages: pdf.totalPages, updatedAt: now } } : {}), updatedAt: now }
    })
    // Read the latest index inside its queue; never revive a concurrently removed book.
    await storageEngine.mutate(booksKey, 'progress:index', latest => {
      const current = latest[url]
      if (!current) return latest
      const next = patch(current)
      if (Object.entries(next).every(([key, value]) => same(current[key], value)) && !changed) return latest
      changed = true
      return { ...latest, [url]: { ...current, ...next, read: now, ...(value === 100 && !current.finished ? { finished: now } : {}) } }
    })
    return changed
  }

  async deleteBook(url: string, deleteData = false) {
    const book = (await storageEngine.read(booksKey))[url]
    const dailyDeletes = Object.entries((await storageEngine.read(dailyKey))).flatMap(([date, items]) => {
      if (!Object.prototype.hasOwnProperty.call(items, url)) return []
      return [{ id: operationId('daily:delete'), type: 'delete' as const, path: [date, url] }]
    })
    const steps = [storageTransactionStep('book-index', { name: booksKey.name, defaultValue: booksKey.defaultValue() }, [
      { id: operationId('book:delete'), type: 'delete', path: [url] },
    ])]
    if (dailyDeletes.length) steps.push(storageTransactionStep('daily-reading', { name: dailyKey.name, defaultValue: dailyKey.defaultValue() }, dailyDeletes))
    await writeSequentially('book-delete', steps)
    if (deleteData) {
      if (book?.dataId) await removeBookRecord(book.dataId)
      await removeBookRecord(url)
    }
  }

  async getAnnotations(book: string) {
    const item = (await storageEngine.read(booksKey))[book]
    return (await loadBookRecord(item ? this.dataKey(item) : book) || await loadBookRecord(book))?.annotations || []
  }

  async saveAnnotation(annotation: Partial<Annotation> & Pick<Annotation, 'id' | 'book' | 'type'>, onCommit?: () => void) {
    if (!annotation.book) throw new Error('book required')
    if (!annotation.id) throw new Error('id required')
    if (annotation.type === 'daily_reading') {
      const data = annotation.data || {}
      const date = String(data.date || '')
      const duration = Number(data.duration || 0)
      if (!date || duration <= 0) return
      await storageEngine.transact(dailyKey, [{ id: operationId('daily:max'), type: 'max', path: [date, annotation.book], value: duration }])
      return
    }
    const book = await this.getBook(annotation.book)
    if (!book) throw new Error('book not found')
    if (book.format === 'pdf') return
    const record = await this.readBookRecord(book)
    const old = (record.annotations || []).find(item => item.id === annotation.id)
    const now = Date.now()
    const item = {
      id: annotation.id,
      book: annotation.book,
      type: annotation.type,
      loc: annotation.loc || '',
      text: annotation.text || '',
      note: annotation.note || '',
      tags: Array.from(new Set((annotation.tags || []).map(tag => String(tag || '').trim()).filter(Boolean))),
      color: annotation.color || '',
      data: annotation.data || {},
      created: annotation.created || old?.created || now,
      updated: now,
      chapter: annotation.chapter || '',
      block: annotation.block || '',
    } as Annotation
    await upsertBookAnnotation(this.dataKey(book), item, false, onCommit)
  }

  async saveAnnotations(bookUrl: string, types: AnnotationType[], annotations: Array<Partial<Annotation> & Pick<Annotation, 'id' | 'type'>>) {
    if (!bookUrl) throw new Error('book required')
    const book = await this.getBook(bookUrl)
    if (!book) throw new Error('book not found')
    if (book.format === 'pdf') return
    const record = await this.readBookRecord(book)
    const current = record.annotations || []
    const allow = new Set(types)
    const prev = new Map(current.map(item => [item.id, item]))
    const now = Date.now()
    const next = [
      ...current.filter(item => !allow.has(item.type)),
      ...annotations.map(annotation => {
        if (!annotation.id) throw new Error('id required')
        const old = prev.get(annotation.id)
        const item = {
          id: annotation.id,
          book: bookUrl,
          type: annotation.type,
          loc: annotation.loc || '',
          text: annotation.text || '',
          note: annotation.note || '',
          tags: Array.from(new Set((annotation.tags || []).map(tag => String(tag || '').trim()).filter(Boolean))),
          color: annotation.color || '',
          data: annotation.data || {},
          created: annotation.created || old?.created || now,
          updated: old?.updated || annotation.updated || now,
          chapter: annotation.chapter || '',
          block: annotation.block || '',
        } as Annotation
        return old && same({ ...old, updated: item.updated }, item) ? old : { ...item, updated: now }
      }),
    ].sort((a, b) => (a.created || 0) - (b.created || 0))
    if (same(current, next)) return
    const nextIds = new Set(next.filter(item => allow.has(item.type)).map(item => item.id))
    const operations = [
      ...current.filter(item => allow.has(item.type) && !nextIds.has(item.id)).map(item => ({
        id: operationId('annotation:delete'), type: 'delete' as const, path: ['annotations'], itemKey: 'id', itemValue: item.id,
      })),
      ...next.filter(item => allow.has(item.type)).map(item => ({
        id: operationId('annotation:upsert'), type: 'upsert' as const, path: ['annotations'], itemKey: 'id', value: item,
      })),
      { id: operationId('record:touch'), type: 'set' as const, path: ['updatedAt'], value: Date.now() },
    ]
    await transactBookRecord(this.dataKey(book), operations)
  }

  async deleteAnnotation(id: string, bookUrl?: string) {
    const knownBook = bookUrl
      ? (await storageEngine.read(booksKey))[bookUrl] || Object.values((await storageEngine.read(booksKey))).find(book => book.dataId === bookUrl)
      : null
    const books = knownBook ? [knownBook] : await this.listBooks('added DESC')
    for (const book of books) {
      if (book.format === 'pdf') {
        const record = await loadBookRecord(this.dataKey(book)) || await loadBookRecord(book.url)
        const annotations = record?.annotations || []
        const existed = annotations.some(item => (item.annotation || item).id === id)
        if (!knownBook && !existed) continue
        await deleteBookAnnotation(this.dataKey(book), id, true)
        break
      }
      const record = await loadBookRecord(this.dataKey(book)) || await loadBookRecord(book.url)
      const existed = !!record?.annotations?.some(item => item.id === id)
      if (!knownBook && !existed) continue
      await deleteBookAnnotation(this.dataKey(book), id, false)
      break
    }
  }

  async getSetting<T = any>(key: string): Promise<T | null> {
    return (await storageEngine.read(settingsKey))[key] ?? null
  }

  async getSettings() { return storageEngine.read(settingsKey) }

  async saveSetting(key: string, value: any) {
    await storageEngine.transact(settingsKey, [{ id: operationId('setting:set'), type: 'set', path: [key], value }])
  }

  async patchSetting(key: string, patch: Record<string, unknown>) {
    const operations = leafEntries(patch).map(([path, value]) => ({
      id: operationId('setting:set'), type: 'set' as const, path: [key, ...path], value,
    }))
    if (operations.length) await storageEngine.transact(settingsKey, operations)
  }

  async getGroups() {
    return this.getSetting('book_groups').then(groups => groups || [])
  }

  async saveGroups(groups: any[]) {
    await this.saveSetting('book_groups', groups)
  }

  async getAllTags(books?: Book[]) {
    const counts = new Map<string, number>()
    ;(books ?? Object.values(await storageEngine.read(booksKey))).forEach(book => (book.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)))
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)
  }

  async filterBooks(opt: {
    status?: string[]
    rating?: number
    formats?: string[]
    tags?: string[]
    sortBy?: string
    reverse?: boolean
  } = {}, source?: Book[]) {
    const sortMap: Record<string, keyof Book> = {
      time: 'read',
      added: 'added',
      progress: 'progress',
      rating: 'rating',
      readTime: 'time',
      name: 'title',
      author: 'author',
    }
    const column = sortMap[opt.sortBy || 'time']
    let books = (source ?? Object.values(await storageEngine.read(booksKey))).filter(book =>
      (!opt.status?.length || opt.status.includes(book.status)) &&
      (!opt.rating || (book.rating || 0) >= opt.rating) &&
      (!opt.formats?.length || opt.formats.includes(book.format)) &&
      (!opt.tags?.length || opt.tags.some(tag => (book.tags || []).includes(tag))),
    )
    books = books.sort((a, b) => {
      const av = column === 'title' || column === 'author' ? String(a[column] || '').toLowerCase() : Number(a[column] || 0)
      const bv = column === 'title' || column === 'author' ? String(b[column] || '').toLowerCase() : Number(b[column] || 0)
      if (av === bv) return 0
      return opt.reverse ? (av > bv ? 1 : -1) : (av < bv ? -1 : 1)
    })
    return books
  }

  async getStats(books?: Book[], includeAnnotations = true) {
    books ??= Object.values(await storageEngine.read(booksKey))
    const byStatus: Record<string, number> = { unread: 0, reading: 0, finished: 0 }
    const byFormat: Record<string, number> = { epub: 0, pdf: 0, mobi: 0, azw3: 0, txt: 0 }
    const byRating: Record<number, number> = {}
    books.forEach(book => {
      byStatus[book.status] = (byStatus[book.status] || 0) + 1
      byFormat[book.format] = (byFormat[book.format] || 0) + 1
      if ((book.rating || 0) > 0) byRating[book.rating] = (byRating[book.rating] || 0) + 1
    })
    const annotationCount = includeAnnotations ? await this.countRecordAnnotations(books) : undefined
    return { total: books.length, byStatus, byFormat, byRating, annotationCount }
  }

  async getTodayReading() {
    const today = new Date().toISOString().split('T')[0]
    return Object.values((await storageEngine.read(dailyKey))[today] || {}).reduce((sum, duration) => sum + Number(duration || 0), 0)
  }

  async getDailyReading(year: number, month?: number) {
    const prefix = month ? `${year}-${String(month).padStart(2, '0')}` : `${year}`
    const daily: Record<string, { total: number, books: Array<{ url: string, duration: number }> }> = {}
    Object.entries((await storageEngine.read(dailyKey)))
      .filter(([date]) => date.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([date, items]) => {
        const books = Object.entries(items)
          .map(([url, duration]) => ({ url, duration: Number(duration || 0) }))
          .filter(item => item.duration > 0)
          .sort((a, b) => b.duration - a.duration)
        daily[date] = { total: books.reduce((sum, item) => sum + item.duration, 0), books }
      })
    return daily
  }

  async saveDailyReading(bookUrl: string, duration: number) {
    if (!bookUrl || duration <= 0) return
    const date = new Date().toISOString().split('T')[0]
    await storageEngine.transact(dailyKey, [{ id: operationId('daily:increment'), type: 'increment', path: [date, bookUrl], value: duration }])
  }

  async deleteGroup(gid: string) {
    await storageEngine.mutate(settingsKey, 'group-delete', current => ({ ...current, book_groups: (current.book_groups || []).filter((group: any) => group.id !== gid) }))
    await storageEngine.mutate(booksKey, 'group-delete', current => Object.fromEntries(Object.entries(current).map(([url, book]) => [url, { ...book, groups: (book.groups || []).filter(group => group !== gid) }])))
  }

}

let instance: ReaderDatabase | null = null

export const getDatabase = async () => {
  if (!instance) instance = new ReaderDatabase()
  return instance
}

export const initDatabase = getDatabase
