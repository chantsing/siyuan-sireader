import { putFile, readDir, removeFile } from '@/api'
import { DB_KEYS, LEGACY_ROOT, getBookFileDataPath, getCoverFileDataPath, getManagedFileExt, loadData, migrateManagedPath, normalizeBookTitle, readFileBytes, readFileText, removeData, saveData } from '@/core/bookStore'
import { getDatabase, getSqlJs } from '@/core/database'
import { showMessage } from 'siyuan'

const OLD_DATA_PATH = LEGACY_ROOT
const MIGRATION_DONE_KEY = 'migrated.json'
const BACKUP_ROOT = `${LEGACY_ROOT}-backup`
const DEBUG_PREFIX = '[SiReader:migration]'
const NORMALIZE_VERSION = 1
const LEGACY_JSON_KEYS = ['index.json', 'config.json'] as const
const LEGACY_SETTING_KEYS = ['book_record_storage_v1', 'book_storage_root_v2', 'book_storage_cleanup_v1'] as const
const INTERNAL_SETTING_KEYS = new Set([...LEGACY_SETTING_KEYS, 'annotation_record_count_v1'])
const DEFAULT_GROUPS = [
  { id: 'default', name: '默认分组', icon: '📚', color: '#2196f3', order: 0, type: 'folder' },
  { id: 'reading', name: '正在阅读', icon: '📖', color: '#4caf50', order: 1, type: 'smart', rules: { status: ['reading'] } },
  { id: 'finished', name: '已完成', icon: '✅', color: '#9e9e9e', order: 2, type: 'smart', rules: { status: ['finished'] } },
] as const
const RETRY_DELAYS = [0, 80, 200] as const

const db = async () => getDatabase()
const emptyResult = () => ({ success: 0, failed: 0, totalAnnotations: 0 })

const sanitize = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f[\]{};,]/g, '').replace(/\s+/g, '_').replace(/[._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 50) || 'book'
const getBookIndexFile = (book: any) => `${sanitize(book.name)}_${Math.abs(book.bookUrl.split('').reduce((value: number, char: string) => (((value << 5) - value) + char.charCodeAt(0)) | 0, 0)).toString(36)}.json`
const getBookAssetPath = (url: string, path = '', format = 'epub') => getBookFileDataPath(url, getManagedFileExt(path, format))
const getCoverAssetPath = (url: string, path = '') => getCoverFileDataPath(url, getManagedFileExt(path, 'jpg'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const parseStoredJson = <T = any>(value: any): T | null => {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return null }
  }
  return value as T
}
const parseJson = <T = any>(value: any, fallback: T): T => {
  try {
    if (value == null || value === '') return fallback
    return typeof value === 'string' ? JSON.parse(value) : value
  } catch {
    return fallback
  }
}
const asString = (value: any, fallback = '') => value == null ? fallback : String(value)
const asNumber = (value: any, fallback = 0) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}
const asBool = (value: any) => value === true || value === 1 || value === '1'
const unique = <T>(list: T[]) => Array.from(new Set(list))
const getMigrationState = async () => parseStoredJson<any>(await loadData(MIGRATION_DONE_KEY)) || {}
const removeDataKeys = async (keys: readonly string[]) => Promise.all(keys.map(key => removeData(key)))
const saveMigrationState = async (state: Record<string, any>) => saveData(MIGRATION_DONE_KEY, { ...(await getMigrationState()), ...state })
const hasLegacySources = (sources: { legacyDbFiles: Array<any>, indexData: any[], legacyBooks: any[] }) =>
  !!(sources.legacyDbFiles.length || sources.indexData.length || sources.legacyBooks.length)
const isApiErrorText = (text: string) => {
  if (!text.trim().startsWith('{') || !text.includes('"code"')) return false
  try {
    const payload = JSON.parse(text)
    return typeof payload?.code === 'number' && payload.code !== 0
  } catch {
    return false
  }
}
async function withRetry<T>(label: string, task: () => Promise<T>, delays = RETRY_DELAYS): Promise<T> {
  let lastError: any
  for (let index = 0; index < delays.length; index++) {
    try {
      if (delays[index] > 0) await sleep(delays[index])
      return await task()
    } catch (error) {
      lastError = error
      if (index === delays.length - 1) console.warn(DEBUG_PREFIX, `${label}:retry`, { attempt: index + 1, total: delays.length, error })
    }
  }
  throw lastError
}

const ensureDir = async (path: string) => {
  try { await putFile(path, true, new File([], '')) } catch {}
  return path
}

const writeBackupFile = async (path: string, data: BlobPart, type = 'application/octet-stream') => {
  await ensureDir(path.split('/').slice(0, -1).join('/'))
  await putFile(path, false, new File([data], path.split('/').pop() || 'file', { type }))
}

const readJsonFile = async <T = any>(path: string): Promise<T | null> => {
  const text = await readFileText(path)
  if (!text || isApiErrorText(text)) return null
  try {
    return JSON.parse(text) as T
  } catch (error) {
    console.error(DEBUG_PREFIX, 'readJson:parse-error', { path, error })
    return null
  }
}

const readDirSafe = async (path: string) => (await readDir(path).catch(() => ({ data: [] as any[] })))?.data || []

const readLegacyJson = async <T = any>(key: typeof LEGACY_JSON_KEYS[number]): Promise<T | null> => {
  const pluginData = parseStoredJson<T>(await loadData(key))
  if (pluginData != null) return pluginData
  return readJsonFile<T>(`${OLD_DATA_PATH}/${key}`)
}

const toBytes = (value: any): Uint8Array | null => {
  if (value == null || value === '') return null
  if (value instanceof Uint8Array) return value.byteLength ? value : null
  if (value instanceof ArrayBuffer) return value.byteLength ? new Uint8Array(value) : null
  if (Array.isArray(value) && value.every(item => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return value.length ? new Uint8Array(value) : null
  }
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    if (text.startsWith('{') || text.startsWith('[')) return null
    try {
      const binary = atob(text)
      if (!binary.length) return null
      return Uint8Array.from(binary, char => char.charCodeAt(0))
    } catch {
      return new TextEncoder().encode(text)
    }
  }
  if (typeof value === 'object') {
    const typedValues = ['data', 'value', 'bytes', 'buffer']
      .map(key => (value as any)?.[key])
      .map(item => toBytes(item))
      .find(Boolean)
    if (typedValues) return typedValues
  }
  return null
}

const readLegacyDatabaseFile = async (key: typeof DB_KEYS[number]) => {
  const [pluginRaw, fileBytes] = await Promise.all([
    loadData<any>(key).catch(() => null),
    readFileBytes(`${OLD_DATA_PATH}/${key}`),
  ])
  const pluginBytes = toBytes(pluginRaw)
  const bytes = fileBytes?.byteLength ? fileBytes : pluginBytes
  return { key, bytes }
}

const readLegacyDatabaseFiles = async () => {
  const files = await Promise.all(DB_KEYS.map(readLegacyDatabaseFile))
  return files.filter(file => !!file.bytes?.byteLength) as Array<{ key: typeof DB_KEYS[number], bytes: Uint8Array }>
}

const queryRows = (db: any, sql: string, params: any[] = []) => {
  const result = db.exec(sql, params)[0]
  return result ? result.values.map((row: any[]) => Object.fromEntries(result.columns.map((column: string, index: number) => [column, row[index]]))) : []
}
const scalar = (db: any, sql: string, params: any[] = []) => Number(db.exec(sql, params)?.[0]?.values?.[0]?.[0] || 0)
const getTableColumns = (db: any, table: string) => {
  try {
    return queryRows(db, `PRAGMA table_info(${table})`).map(row => asString(row.name))
  } catch {
    return []
  }
}
const queryRowsSafe = (db: any, table: string, wanted: string[], orderBy = '') => {
  const columns = wanted.filter(column => getTableColumns(db, table).includes(column))
  if (!columns.length) return []
  try {
    return queryRows(db, `SELECT ${columns.join(', ')} FROM ${table}${orderBy ? ` ORDER BY ${orderBy}` : ''}`)
  } catch (error) {
    return []
  }
}

const normalizeLegacyBook = (row: any) => {
  const url = asString(row.url || row.bookUrl || row.id)
  const progress = Math.max(0, Math.min(100, asNumber(row.progress ?? row.epubProgress, 0)))
  return {
    url,
    title: normalizeBookTitle(asString(row.title || row.name, '未知书名')) || '未知书名',
    author: asString(row.author, '未知作者'),
    cover: asString(row.cover || row.coverUrl),
    format: asString(row.format, 'epub'),
    path: asString(row.path || row.filePath),
    size: asNumber(row.size || row.fileSize),
    added: asNumber(row.added || row.addTime, Date.now()),
    read: asNumber(row.read || row.durChapterTime || row.added || row.addTime, Date.now()),
    finished: asNumber(row.finished, progress >= 100 ? Date.now() : 0),
    status: asString(row.status, progress <= 0 ? 'unread' : progress >= 100 ? 'finished' : 'reading'),
    progress,
    time: asNumber(row.time),
    chapter: asNumber(row.chapter || row.durChapterIndex),
    total: asNumber(row.total || row.totalChapterNum),
    pos: parseJson(row.pos, {}),
    source: parseJson(row.source, {}),
    rating: asNumber(row.rating),
    meta: parseJson(row.meta, {}),
    tags: [] as string[],
    groups: [] as string[],
    bindDocId: asString(row.bindDocId),
    bindDocName: asString(row.bindDocName),
    autoSync: asBool(row.autoSync),
    syncDelete: asBool(row.syncDelete),
  }
}

const openLegacyDatabase = async (files: Array<{ key: typeof DB_KEYS[number], bytes: Uint8Array }>) => {
  const SQL = await getSqlJs()
  for (const file of files) {
    try {
      const db = new SQL.Database(file.bytes)
      const tables = queryRows(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(row => row.name)
      return { db, key: file.key, tables }
    } catch (error) {
      console.error(DEBUG_PREFIX, 'openLegacyDatabase:error', { key: file.key, error })
    }
  }
  return null
}

const ensureDefaultGroups = async () => {
  const database = await db()
  const groups = await database.getGroups().catch(() => [])
  if (!groups?.length) await database.saveGroups([...DEFAULT_GROUPS] as any[])
}
const saveImportedBook = async (database: any, book: any, annotations: any[], labels: { book: string, annotation: (id: string) => string }) => {
  await withRetry(labels.book, async () => database.saveBook(book))
  for (const annotation of annotations) await withRetry(labels.annotation(annotation.id || 'unknown'), async () => database.saveAnnotation(annotation))
  return annotations.length
}

const toAnnotation = (bookUrl: string, mark: any, format: string, now: number) => {
  const data: any = { format }
  if (format === 'pdf') {
    if (mark.page != null) data.page = mark.page
    if (mark.rects) data.rects = mark.rects
  } else if (format === 'epub' && mark.cfi) {
    data.cfi = mark.cfi
  }
  if (mark.style) data.style = mark.style
  if (mark.shapeType) data.shapeType = mark.shapeType
  if (mark.filled != null) data.filled = mark.filled
  if (mark.paths) data.paths = mark.paths
  return {
    id: mark.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    book: bookUrl,
    type: mark.note ? 'note' : mark.shapeType ? 'shape' : mark.paths ? 'ink' : 'highlight',
    loc: mark.cfi || mark.value || (mark.page != null ? `page-${mark.page}` : '') || (mark.section != null ? `section-${mark.section}` : ''),
    text: mark.text || '',
    note: mark.note || '',
    color: mark.color || '#ffeb3b',
    data,
    created: mark.timestamp || now,
    updated: mark.timestamp || now,
    chapter: mark.chapter || '',
    block: mark.blockId || '',
  }
}

async function migrateBook(bookIndex: any, raw: any) {
  const now = Date.now()
  const data = raw || {}
  const format = bookIndex.format || data.format || 'epub'
  const progress = bookIndex.epubProgress || data.epubProgress || 0
  const pos: any = {}
  const source: any = {}
  const meta: any = {}

  if (data.epubCfi) pos.cfi = data.epubCfi
  if (data.durChapterIndex != null) pos.chapter = data.durChapterIndex
  if (data.durChapterPos != null) pos.position = data.durChapterPos
  if (data.durChapterPage != null) pos.page = data.durChapterPage
  if (data.durChapterTitle) pos.chapterTitle = data.durChapterTitle

  if (data.tocUrl) {
    source.origin = data.origin || 'unknown'
    source.bookUrl = bookIndex.bookUrl
    source.tocUrl = data.tocUrl
    source.latestChapter = data.latestChapterTitle
    source.latestTime = data.latestChapterTime
    source.lastCheckTime = data.lastCheckTime
    source.updateCount = bookIndex.lastCheckCount || 0
  }

  if (data.publisher) meta.publisher = data.publisher
  if (data.published) meta.publishDate = data.published
  if (data.identifier) meta.isbn = data.identifier
  if (data.language) meta.language = data.language
  if (data.intro) meta.description = data.intro
  if (data.totalChapterNum) meta.pageCount = data.totalChapterNum
  if (data.series) meta.series = data.series
  if (data.subjects) meta.subjects = data.subjects

  const book = {
    url: bookIndex.bookUrl,
    title: normalizeBookTitle(bookIndex.name || data.name || '未知书名') || '未知书名',
    author: bookIndex.author || data.author || '未知作者',
    cover: await migrateManagedPath(
      bookIndex.coverUrl || '',
      getCoverAssetPath(bookIndex.bookUrl, bookIndex.coverUrl || ''),
    ),
    format,
    path: await migrateManagedPath(
      data.filePath || '',
      getBookAssetPath(bookIndex.bookUrl, data.filePath || '', format),
    ),
    size: data.fileSize || 0,
    added: bookIndex.addTime || data.addTime || now,
    read: bookIndex.durChapterTime || data.durChapterTime || now,
    finished: progress >= 100 ? now : 0,
    status: progress === 0 ? 'unread' : progress >= 100 ? 'finished' : 'reading',
    progress,
    time: 0,
    chapter: bookIndex.durChapterIndex || data.durChapterIndex || 0,
    total: bookIndex.totalChapterNum || data.totalChapterNum || 0,
    pos,
    source,
    rating: data.rating || 0,
    meta,
    tags: data.tags || [],
    groups: data.groups || ['default'],
    bindDocId: data.bindDocId || '',
    bindDocName: data.bindDocName || '',
    autoSync: !!data.autoSync,
    syncDelete: !!data.syncDelete,
  }

  return {
    book,
    annotations: [
      ...(data.annotations || []).map((mark: any) => toAnnotation(bookIndex.bookUrl, mark, format, now)),
      ...(data.inkAnnotations || []).map((ink: any) => ({
        id: ink.id || `ink-${ink.page}-${ink.timestamp}`,
        book: bookIndex.bookUrl,
        type: 'ink',
        loc: `page-${ink.page}`,
        text: '',
        note: '',
        color: ink.paths?.[0]?.color || '#ff0000',
        data: { format: 'pdf', page: ink.page, paths: ink.paths },
        created: ink.timestamp || now,
        updated: ink.timestamp || now,
        chapter: '',
        block: '',
      })),
      ...(data.shapeAnnotations || []).map((shape: any) => ({
        id: shape.id || `shape-${shape.page}-${shape.timestamp}`,
        book: bookIndex.bookUrl,
        type: 'shape',
        loc: `page-${shape.page}`,
        text: '',
        note: shape.note || '',
        color: shape.color || '#ff0000',
        data: { format: 'pdf', page: shape.page, shapeType: shape.shapeType, filled: shape.filled, rect: shape.rect },
        created: shape.timestamp || now,
        updated: shape.timestamp || now,
        chapter: shape.chapter || '',
        block: '',
      })),
      ...(data.epubBookmarks || []).flatMap((bookmark: any) => ([
        {
          id: `bookmark-${bookmark.cfi}-${bookmark.time}`,
          book: bookIndex.bookUrl,
          type: 'bookmark',
          loc: bookmark.cfi || '',
          text: bookmark.title || '',
          note: '',
          color: '#2196f3',
          data: { format: 'epub', cfi: bookmark.cfi, title: bookmark.title || '', progress: bookmark.progress || 0 },
          created: bookmark.time || now,
          updated: bookmark.time || now,
          chapter: bookmark.title || '',
          block: '',
        },
        {
          id: `bookmark-section-${bookmark.section}-${bookmark.time}`,
          book: bookIndex.bookUrl,
          type: 'bookmark',
          loc: `section-${bookmark.section}`,
          text: bookmark.title || '',
          note: '',
          color: '#2196f3',
          data: { format: 'epub', section: bookmark.section, title: bookmark.title || '' },
          created: bookmark.time || now,
          updated: bookmark.time || now,
          chapter: bookmark.title || '',
          block: '',
        },
      ])),
    ],
  }
}

async function getSources() {
  const done = await getMigrationState()
  const [indexData, configData, legacyDbFiles, legacyBooks] = await Promise.all([
    readLegacyJson<any[]>('index.json'),
    readLegacyJson<any>('config.json'),
    readLegacyDatabaseFiles(),
    readDirSafe(`${OLD_DATA_PATH}/books`),
  ])
  const normalizedIndex = Array.isArray(indexData) ? indexData : []
  const shouldMigrate = !done?.done && hasLegacySources({ legacyDbFiles, indexData: normalizedIndex, legacyBooks })
  const shouldNormalize = !done?.normalized
  const retryLegacyDb = !!legacyDbFiles.length && (!done || !done.success)
  const shouldRun = shouldNormalize || shouldMigrate || retryLegacyDb
  return {
    done,
    indexData: normalizedIndex,
    configData,
    legacyDbFiles,
    legacyBooks,
    retryLegacyDb,
    shouldNormalize,
    shouldMigrate,
    shouldRun,
  }
}

export async function needsMigration() {
  try {
    return (await getSources()).shouldRun
  } catch (error) {
    console.error(DEBUG_PREFIX, 'needsMigration:error', error)
    return false
  }
}

async function normalizeCurrentStorage() {
  const database = await db()
  const adopted = await withRetry('adoptLegacyAnnotations', async () => database.adoptLegacyAnnotations())
  const books = await database.getBooks().catch(() => [])
  let success = 0
  let failed = 0
  let totalAnnotations = 0

  for (const book of books) {
    try {
      const [path, cover, annotations] = await Promise.all([
        migrateManagedPath(book.path || '', getBookAssetPath(book.url, book.path || '', book.format || 'epub')),
        migrateManagedPath(book.cover || '', getCoverAssetPath(book.url, book.cover || '')),
        database.getAnnotations(book.url).catch(() => []),
      ])
      await withRetry(`normalizeBook:${book.url}`, async () => database.saveBook({ ...book, title: normalizeBookTitle(book.title || '') || book.title, path, cover }))
      totalAnnotations += annotations.length
      success++
    } catch (error) {
      failed++
      console.error(DEBUG_PREFIX, 'normalizeCurrentStorage:error', { url: book.url, error })
    }
  }

  await withRetry('deleteLegacySettings', async () => database.deleteSettings([...LEGACY_SETTING_KEYS]))
  const compacted = await withRetry('compactStorage', async () => database.compactStorage(), [0, 120, 320, 800])
  return { success, failed, totalAnnotations: Math.max(totalAnnotations, adopted.annotations || 0), adopted, compacted }
}

async function normalizeStorageIfNeeded(force = false) {
  const state = await getMigrationState()
  if (!force && state?.normalizedVersion === NORMALIZE_VERSION) return true
  const database = await db()
  const normalized = await normalizeCurrentStorage()
  await withRetry('flushNormalizedDatabase', async () => database.saveNow(), [0, 120, 320, 800])
  await saveMigrationState({
    normalized: !normalized.failed,
    normalizedVersion: NORMALIZE_VERSION,
    normalizeSuccess: normalized.success,
    normalizeFailed: normalized.failed,
    normalizeAnnotations: normalized.totalAnnotations,
    at: Date.now(),
  })
  return !normalized.failed
}

async function migrateFromLegacyDb(files: Array<{ key: typeof DB_KEYS[number], bytes: Uint8Array }>) {
  const opened = await openLegacyDatabase(files)
  if (!opened) return emptyResult()

  const { db: legacy, key, tables } = opened
  const bookColumns = getTableColumns(legacy, 'books')
  const annotationColumns = getTableColumns(legacy, 'annotations')
  const bookCount = bookColumns.length ? scalar(legacy, 'SELECT COUNT(*) FROM books') : 0
  const annotationCount = annotationColumns.length ? scalar(legacy, "SELECT COUNT(*) FROM annotations WHERE type != 'daily_reading'") : 0
  console.info(DEBUG_PREFIX, 'migrateFromLegacyDb', { key, tables, bookCount, annotationCount })
  if (!bookCount) return emptyResult()

  const database = await db()
  const legacyBooks = queryRowsSafe(legacy, 'books', [
    'url', 'bookUrl', 'id', 'title', 'name', 'author', 'cover', 'coverUrl', 'format', 'path', 'filePath', 'size', 'fileSize',
    'added', 'addTime', 'read', 'durChapterTime', 'finished', 'status', 'progress', 'epubProgress', 'time', 'chapter',
    'durChapterIndex', 'total', 'totalChapterNum', 'pos', 'source', 'rating', 'meta', 'bindDocId', 'bindDocName', 'autoSync', 'syncDelete',
  ], 'added DESC')
  const tags = getTableColumns(legacy, 'tags').length ? queryRowsSafe(legacy, 'tags', ['book', 'tag']) : []
  const groups = getTableColumns(legacy, 'groups').length ? queryRowsSafe(legacy, 'groups', ['book', 'gid']) : []
  const annotations = annotationColumns.length ? queryRowsSafe(legacy, 'annotations', ['id', 'book', 'type', 'loc', 'text', 'note', 'color', 'data', 'created', 'updated', 'chapter', 'block'], 'created') : []
  const settingsRows = getTableColumns(legacy, 'settings').length ? queryRowsSafe(legacy, 'settings', ['key', 'val']) : []

  const tagsMap = new Map<string, string[]>()
  const groupsMap = new Map<string, string[]>()
  const annotationsMap = new Map<string, any[]>()
  tags.forEach(row => tagsMap.set(asString(row.book), unique([...(tagsMap.get(asString(row.book)) || []), asString(row.tag)]).filter(Boolean)))
  groups.forEach(row => groupsMap.set(asString(row.book), unique([...(groupsMap.get(asString(row.book)) || []), asString(row.gid)]).filter(Boolean)))
  annotations.forEach(row => annotationsMap.set(asString(row.book), [...(annotationsMap.get(asString(row.book)) || []), row]))

  let success = 0
  let failed = 0
  let totalAnnotations = 0

  for (const row of legacyBooks) {
    const book = normalizeLegacyBook(row)
    if (!book.url) continue
    try {
      totalAnnotations += await saveImportedBook(database, {
        ...book,
        tags: tagsMap.get(book.url) || [],
        groups: groupsMap.get(book.url) || ['default'],
      }, (annotationsMap.get(book.url) || []).map(annotation => ({
        id: asString(annotation.id, `${book.url}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        book: book.url,
        type: asString(annotation.type, 'highlight') as any,
        loc: asString(annotation.loc),
        text: asString(annotation.text),
        note: asString(annotation.note),
        color: asString(annotation.color),
        data: parseJson(annotation.data, {}),
        created: asNumber(annotation.created, Date.now()),
        updated: asNumber(annotation.updated || annotation.created, Date.now()),
        chapter: asString(annotation.chapter),
        block: asString(annotation.block),
      })), {
        book: `saveBook:${book.url}`,
        annotation: id => `saveAnnotation:${book.url}:${id}`,
      })
      success++
    } catch (error) {
      failed++
      console.error(DEBUG_PREFIX, 'migrateFromLegacyDb:error', { url: book.url, error })
    }
  }

  const settings = Object.fromEntries(
    settingsRows
      .map(row => [asString(row.key), parseJson(row.val, row.val)])
      .filter(([key]) => key && !INTERNAL_SETTING_KEYS.has(key)),
  )
  if (Object.keys(settings).length) await withRetry('batchSaveSettings', async () => database.batchSaveSettings(settings))
  try { legacy.close?.() } catch {}
  return { success, failed, totalAnnotations }
}

async function migrateFromIndex(indexData: any[]) {
  const database = await db()
  let success = 0
  let failed = 0
  let totalAnnotations = 0

  for (const bookIndex of indexData) {
    try {
      const raw = await readJsonFile(`${OLD_DATA_PATH}/books/${getBookIndexFile(bookIndex)}`)
      const { book, annotations } = await migrateBook(bookIndex, raw)
      totalAnnotations += await saveImportedBook(database, book, annotations, {
        book: `saveIndexBook:${book.url}`,
        annotation: id => `saveIndexAnnotation:${book.url}:${id}`,
      })
      success++
    } catch (error) {
      failed++
      console.error(DEBUG_PREFIX, 'migrateFromIndex:error', { book: bookIndex?.name, error })
    }
  }

  return { success, failed, totalAnnotations }
}

async function migrate() {
  const sources = await getSources()
  if (!sources.shouldRun) return { ...emptyResult(), importedDb: false, normalized: false, migrated: false, completed: true, sources }

  let result = emptyResult()
  let importedDb = false

  if (sources.legacyDbFiles.length) {
    result = await migrateFromLegacyDb(sources.legacyDbFiles)
    importedDb = true
  }
  if (!result.success && sources.indexData.length) result = await migrateFromIndex(sources.indexData)

  const database = await db()
  if (sources.configData?.settings) await withRetry('batchSaveConfigSettings', async () => database.batchSaveSettings(sources.configData.settings))
  await ensureDefaultGroups()

  const migrated = importedDb || !!result.success || !!sources.configData?.settings
  if (!migrated && !sources.shouldNormalize) {
    await saveMigrationState({
      done: false,
      normalized: false,
      at: Date.now(),
      importedDb,
      success: 0,
      failed: result.failed,
    })
    return { ...result, importedDb, normalized: false, migrated, completed: false, sources }
  }

  const normalized = await normalizeCurrentStorage()
  await withRetry('flushDatabase', async () => database.saveNow(), [0, 120, 320, 800])
  const success = result.success || normalized.success
  const failed = result.failed + normalized.failed
  const totalAnnotations = result.totalAnnotations || normalized.totalAnnotations
  const completed = (migrated || !!normalized.success || sources.shouldNormalize) && !failed
  await saveMigrationState({
    done: completed,
    normalized: !normalized.failed,
    normalizedVersion: NORMALIZE_VERSION,
    at: Date.now(),
    importedDb,
    success,
    failed,
    totalAnnotations,
    retryable: !completed,
  })
  console.info(DEBUG_PREFIX, 'migrate:done', { success, failed, annotations: totalAnnotations, importedDb, completed })
  return {
    success,
    failed,
    totalAnnotations,
    importedDb,
    normalized: !normalized.failed,
    migrated,
    completed,
    sources,
  }
}

export async function ensureMigrationCompleted() {
  const state = await getMigrationState()
  if (!state?.done || !state?.success || !state?.normalized) {
    if (!await autoMigrate()) return true
    setTimeout(() => location.reload(), 1200)
    return false
  }
  return await normalizeStorageIfNeeded()
}

async function getAllFiles(basePath: string) {
  const files: string[] = []
  const scan = async (path: string): Promise<void> => {
    const result: any = await readDir(path).catch(() => null)
    for (const item of Array.isArray(result?.data) ? result.data : []) {
      const fullPath = `${path}/${item.name}`
      if (item.isDir) await scan(fullPath)
      else files.push(fullPath.replace(`${basePath}/`, ''))
    }
  }
  await scan(basePath)
  return files
}

async function backupLegacyData(sources: Awaited<ReturnType<typeof getSources>>, summary: Record<string, any>) {
  const backupPath = await ensureDir(`${BACKUP_ROOT}/${Date.now()}`)
  const legacyFiles = await getAllFiles(OLD_DATA_PATH)
  const copied = new Set<string>()
  await writeBackupFile(`${backupPath}/manifest.json`, JSON.stringify({
    createdAt: Date.now(),
    summary,
    legacyFiles,
    dbFiles: sources.legacyDbFiles.map(file => ({ key: file.key, size: file.bytes.byteLength })),
    hasIndex: !!sources.indexData.length,
    hasConfig: !!sources.configData,
  }, null, 2), 'application/json')

  for (const file of legacyFiles) {
    const bytes = await readFileBytes(`${OLD_DATA_PATH}/${file}`)
    if (!bytes?.byteLength) continue
    await withRetry(`backupFile:${file}`, async () => writeBackupFile(`${backupPath}/${file}`, bytes))
    copied.add(file)
  }

  for (const file of sources.legacyDbFiles) {
    if (copied.has(file.key)) continue
    await withRetry(`backupDb:${file.key}`, async () => writeBackupFile(`${backupPath}/${file.key}`, file.bytes))
  }

  if (sources.indexData.length && !copied.has('index.json')) {
    await withRetry('backupIndex', async () => writeBackupFile(`${backupPath}/index.json`, JSON.stringify(sources.indexData, null, 2), 'application/json'))
  }
  if (sources.configData && !copied.has('config.json')) {
    await withRetry('backupConfig', async () => writeBackupFile(`${backupPath}/config.json`, JSON.stringify(sources.configData, null, 2), 'application/json'))
  }

  return backupPath
}

const isWhitelisted = (filePath: string) => [
  /^deck-data\.db$/,
  /^books\/[^/]+\.(epub|pdf|txt|mobi|azw3|html)$/,
  /^(books|covers)\/[^/]+\.(jpg|jpeg|png|webp|gif)$/,
  /^anki\/[^/]+\/collection\.anki21$/,
  /^anki\/[^/]+\/source\.apkg$/,
  /^dictionaries\//,
].some(rule => rule.test(filePath))

const removeLegacyDbFiles = async () => {
  let deleted = 0
  for (const key of DB_KEYS) {
    try {
      await removeFile(`${OLD_DATA_PATH}/${key}`)
      deleted++
    } catch {}
  }
  return deleted
}

async function cleanupOldData() {
  let deleted = 0
  let failed = 0
  for (const file of (await getAllFiles(OLD_DATA_PATH)).filter(file => !isWhitelisted(file))) {
    try {
      await removeFile(`${OLD_DATA_PATH}/${file}`)
      deleted++
    } catch {
      failed++
    }
  }
  deleted += await removeLegacyDbFiles()
  return { deleted, failed }
}

export async function autoMigrate(): Promise<boolean> {
  try {
    if (!await needsMigration()) return false
    showMessage('Legacy data detected, migrating...', 3000, 'info')
    const result = await migrate()
    if (!result.completed) {
      showMessage(`Migration incomplete: ${result.success} succeeded, ${result.failed} failed. Legacy data was kept for retry.`, 5000, 'error')
      return false
    }
    const backupPath = await backupLegacyData(result.sources, {
      success: result.success,
      failed: result.failed,
      totalAnnotations: result.totalAnnotations,
      importedDb: result.importedDb,
    })
    await removeDataKeys([...LEGACY_JSON_KEYS, ...LEGACY_SETTING_KEYS])
    if (result.importedDb || result.success) await removeDataKeys(DB_KEYS)
    const cleanup = await cleanupOldData()
    const completed = !cleanup.failed
    await saveMigrationState({
      done: completed,
      normalized: completed,
      cleaned: completed,
      cleanupFailed: cleanup.failed,
      backupPath,
      at: Date.now(),
    })
    showMessage(
      cleanup.failed
        ? `Migration finished, but cleanup failed for ${cleanup.failed} items. Backup: ${backupPath}`
        : `Migration succeeded: ${result.success} books, ${result.totalAnnotations} annotations. Legacy data backed up and cleaned.`,
      5000,
      cleanup.failed ? 'error' : 'info',
    )
    return completed
  } catch (error: any) {
    console.error(DEBUG_PREFIX, 'autoMigrate:error', error)
    await saveMigrationState({
      done: false,
      normalized: false,
      retryable: true,
      at: Date.now(),
      error: error?.message || String(error),
    }).catch(() => {})
    showMessage(`Migration failed: ${error?.message || 'unknown error'}`, 4000, 'error')
    return false
  }
}
