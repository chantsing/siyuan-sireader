import { putFile, readDir, removeFile } from '@/api'
import { DB_KEYS, PUBLIC_ROOT, getBookFileDataPath, getCoverFileDataPath, getManagedFileExt, loadData, normalizeBookTitle, readFileBytes, readFileText, removeData, saveData, saveManagedFile, type BookRecord } from '@/core/bookStore'
import { getDatabase, getSqlJs } from '@/core/database'
import { showMessage } from 'siyuan'

export const LEGACY_ROOT = '/data/storage/petal/siyuan-sireader'
export const OLD_PUBLIC_DATA_ROOT = '/data/public/siyuan-sireader'
export const OLD_PUBLIC_ROOT = '/public/siyuan-sireader'
const LEGACY_RECORD_KEY_PREFIX = 'book-record-'
const OLD_DATA_PATH = LEGACY_ROOT
const MIGRATION_DONE_KEY = 'migrated.json'
const BACKUP_ROOT = `${LEGACY_ROOT}-backup`
const DEBUG_PREFIX = '[SiReader:migration]'
const NORMALIZE_VERSION = 6
const LARGE_FILE_NOTICE_BYTES = 80 * 1024 * 1024
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
const emptyResult = () => ({ success: 0, failed: 0, skipped: 0, totalAnnotations: 0 })
const publicToDataPath = (path = '') => path.startsWith('/public/') ? path.replace('/public/', '/data/public/') : path
const toPublicPath = (path = '') => path.startsWith('/data/public/') ? path.replace('/data/public/', '/public/') : path
const toLegacyPath = (path = '') => path.replace(OLD_PUBLIC_ROOT, OLD_PUBLIC_DATA_ROOT).replace(OLD_PUBLIC_DATA_ROOT, LEGACY_ROOT)
const isLegacyManagedPath = (path = '') => path.startsWith(LEGACY_ROOT) || path.startsWith(OLD_PUBLIC_ROOT) || path.startsWith(OLD_PUBLIC_DATA_ROOT)
const isManagedPath = (path = '') => path.startsWith(PUBLIC_ROOT) || path.startsWith('/data/public/siyuan-sireader') || isLegacyManagedPath(path)
const getLegacyRecordKey = (url: string) => `${LEGACY_RECORD_KEY_PREFIX}${Math.abs(url.split('').reduce((value: number, char: string) => (((value << 5) - value) + char.charCodeAt(0)) | 0, 0)).toString(36)}.json`

const sanitize = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f[\]{};,]/g, '').replace(/\s+/g, '_').replace(/[._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 50) || 'book'
const getBookUrlHash = (url = '') => Math.abs(url.split('').reduce((value: number, char: string) => (((value << 5) - value) + char.charCodeAt(0)) | 0, 0)).toString(36)
const getBookIndexFile = (book: any) => `${sanitize(book.name)}_${getBookUrlHash(book.bookUrl)}.json`
const getBookAssetPath = (url: string, path = '', format = 'epub') => getBookFileDataPath(url, getManagedFileExt(path, format))
const getCoverAssetPath = (url: string, path = '') => getCoverFileDataPath(url, getManagedFileExt(path, 'jpg'))
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const getFileName = (path = '') => path.split(/[\\/]/).pop()?.split('?')[0]?.split('#')[0] || 'file'
const isSiyuanAssetPath = (path = '') => /^asset:\/\/assets\//i.test(path) || /^\/?assets\//i.test(path)
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
let legacyAssetIndexPromise: Promise<Record<string, string>> | null = null
const normalizeMatchText = (value = '') => normalizeBookTitle(String(value || ''))
  .toLowerCase()
  .replace(/^\d+_/, '')
  .replace(/_[a-z0-9]{4,12}$/i, '')
  .replace(/[【】\[\]()（）\s_\-—–:：,，.。!！?？'"“”‘’·;；/\\]/g, '')
const stripCoverLabel = (label = '') => label.replace(/:cover$/i, '')
const getStem = (name = '') => name.replace(/\.[^.]+$/, '')
const scoreLegacyTitleMatch = (label: string, fileName: string) => {
  const target = normalizeMatchText(stripCoverLabel(label))
  const stem = normalizeMatchText(getStem(fileName))
  if (!target || !stem) return 0
  if (target === stem) return 100
  if (stem.includes(target)) return Math.min(95, 60 + target.length)
  if (target.includes(stem)) return Math.min(90, 50 + stem.length)
  const overlap = [...target].filter(char => stem.includes(char)).length
  return overlap >= Math.min(target.length, stem.length) * 0.7 ? overlap : 0
}

const getLegacyAssetIndex = async () => {
  if (!legacyAssetIndexPromise) {
    legacyAssetIndexPromise = (async () => {
      const dirs = [`${OLD_DATA_PATH}/books`, `${OLD_DATA_PATH}/covers`]
      const entries = await Promise.all(dirs.map(readDirSafe))
      const index: Record<string, string> = {}
      dirs.forEach((dir, i) => {
        entries[i].forEach((item: any) => {
          if (item?.isDir || !item?.name) return
          index[item.name] = `${dir}/${item.name}`
        })
      })
      return index
    })()
  }
  return legacyAssetIndexPromise
}

const isCoverExt = (ext = '') => /^(jpg|jpeg|png|webp|gif)$/i.test(ext)
const isBookExt = (ext = '') => /^(epub|pdf|txt|mobi|azw3|azw|fb2|cbz)$/i.test(ext)
const parseLegacyHashFile = (name = '') => {
  const match = name.match(/_([a-z0-9]{4,12})\.([a-z0-9]+)$/i)
  return match ? { hash: match[1], ext: match[2].toLowerCase() } : null
}

async function recoverLegacyFilesToPublic(reporter?: ReturnType<typeof createMigrationReporter>) {
  const legacyIndex = await getLegacyAssetIndex()
  const entries = Object.entries(legacyIndex)
  let copied = 0
  let skipped = 0
  reporter?.phase('恢复旧版资源文件', entries.length, '正在按 hash 规则补齐 public 目录中的书籍和封面')
  for (const [name, fullPath] of entries) {
    const parsed = parseLegacyHashFile(name)
    if (!parsed) {
      skipped++
      reporter?.step(name, { skipped, success: copied, failed: 0 })
      continue
    }
    const { hash, ext } = parsed
    const target = isCoverExt(ext)
      ? `/public/siyuan-sireader/covers/${hash}.${ext}`
      : isBookExt(ext)
        ? `/public/siyuan-sireader/books/${hash}.${ext}`
        : ''
    if (!target) {
      skipped++
      reporter?.step(name, { skipped, success: copied, failed: 0 })
      continue
    }
    const exists = await readFileBytes(target).catch(() => null)
    if (exists?.byteLength) {
      skipped++
      reporter?.step(name, { skipped, success: copied, failed: 0 })
      continue
    }
    const bytes = await readFileBytes(fullPath).catch(() => null)
    if (!bytes?.byteLength) {
      skipped++
      reporter?.step(name, { skipped, success: copied, failed: 0 })
      continue
    }
    await saveManagedFile(new Blob([bytes]), target, getFileName(target))
    copied++
    reporter?.step(name, { skipped, success: copied, failed: 0 })
  }
  return { copied, skipped, total: entries.length }
}

const findLegacyAssetByTitle = (legacyIndex: Record<string, string>, label: string, target: string) => {
  const ext = getManagedFileExt(target, '')
  const isCover = /\.(jpg|jpeg|png|webp|gif)$/i.test(target)
  let best: { path: string, score: number } | null = null
  Object.entries(legacyIndex).forEach(([name, fullPath]) => {
    if (!name) return
    const candidateExt = getManagedFileExt(name, '')
    if (ext && candidateExt !== ext) return
    if (isCover !== /\.(jpg|jpeg|png|webp|gif)$/i.test(name)) return
    const score = scoreLegacyTitleMatch(label, name)
    if (!score) return
    if (!best || score > best.score) best = { path: fullPath, score }
  })
  return best?.path || ''
}

// 迁移期兜底：旧路径仍然存在时，搬到当前 public 结构并返回新路径。
export const migrateManagedPath = async (path = '', fallbackPath?: string) => {
  if (!path || path.startsWith('asset://')) return path
  if (!isManagedPath(path)) return path
  const target = fallbackPath || toPublicPath(path).replace(OLD_PUBLIC_ROOT, PUBLIC_ROOT).replace(OLD_PUBLIC_DATA_ROOT, PUBLIC_ROOT).replace(LEGACY_ROOT, PUBLIC_ROOT)
  if (path === target || publicToDataPath(path) === publicToDataPath(target)) return target
  const bytes = await readFileBytes(path)
  if (!bytes?.byteLength) return target
  const nextPath = await saveManagedFile(new Blob([bytes]), target, target.split('/').pop())
  if (path !== nextPath) {
    try { await removeFile(path.startsWith('/public/') ? publicToDataPath(path) : toLegacyPath(path)) } catch {}
  }
  return nextPath
}

export const removeLegacyBookRecord = async (url: string) => {
  try { await removeData(getLegacyRecordKey(url)) } catch {}
}

export const readCompatBookRecord = async (url: string): Promise<BookRecord | null> =>
  await loadData<BookRecord>(`records/${Math.abs(url.split('').reduce((value: number, char: string) => (((value << 5) - value) + char.charCodeAt(0)) | 0, 0)).toString(36)}.json`)
  || await loadData<BookRecord>(getLegacyRecordKey(url))

export const writeCompatBookRecord = async (url: string, record: BookRecord) => {
  const key = `records/${Math.abs(url.split('').reduce((value: number, char: string) => (((value << 5) - value) + char.charCodeAt(0)) | 0, 0)).toString(36)}.json`
  await saveData(key, record)
  await removeLegacyBookRecord(url)
}

export const removeCompatBookRecord = async (url: string) => {
  const key = `records/${Math.abs(url.split('').reduce((value: number, char: string) => (((value << 5) - value) + char.charCodeAt(0)) | 0, 0)).toString(36)}.json`
  await Promise.all([removeData(key), removeLegacyBookRecord(url)])
}

const readLegacyJson = async <T = any>(key: typeof LEGACY_JSON_KEYS[number]): Promise<T | null> => {
  const pluginData = parseStoredJson<T>(await loadData(key))
  if (pluginData != null) return pluginData
  return readJsonFile<T>(`${OLD_DATA_PATH}/${key}`)
}

type MigrationProgress = {
  phase: string
  current: number
  total: number
  success: number
  failed: number
  skipped: number
  detail: string
  updatedAt: number
  status: 'running' | 'completed' | 'error'
}

const createMigrationReporter = () => {
  const progress: MigrationProgress = {
    phase: '准备迁移',
    current: 0,
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    detail: '正在分析旧数据，请勿关闭或刷新当前页面',
    updatedAt: Date.now(),
    status: 'running',
  }
  let host: HTMLDivElement | null = null
  let lastPaint = 0
  let lastPersist = 0
  const removeHost = () => {
    if (host?.parentNode) host.parentNode.removeChild(host)
    host = null
  }
  const ensure = () => {
    if (typeof document === 'undefined' || host) return
    host = document.createElement('div')
    host.id = 'sireader-migration-progress'
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;width:min(420px,calc(100vw - 24px));padding:14px 16px;border-radius:12px;background:var(--b3-theme-surface, #fff);border:1px solid var(--b3-border-color, #ddd);box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:13px;line-height:1.5;color:var(--b3-theme-on-surface, #222);'
    document.body.appendChild(host)
  }
  const paint = (force = false) => {
    ensure()
    const now = Date.now()
    if (!force && now - lastPaint < 120) return
    lastPaint = now
    if (!host) return
    const percent = progress.total ? Math.max(0, Math.min(100, Math.round((progress.current / progress.total) * 100))) : 0
    const done = progress.status !== 'running'
    const statusText = progress.status === 'completed' ? '已完成' : progress.status === 'error' ? '出错' : '进行中'
    const statusColor = progress.status === 'completed' ? '#16a34a' : progress.status === 'error' ? '#dc2626' : 'var(--b3-theme-primary, #3b82f6)'
    host.innerHTML =
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:8px"><strong>SiReader 数据迁移</strong><span>' + percent + '%</span></div>' +
      '<div style="height:6px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;margin-bottom:10px"><div style="height:100%;width:' + percent + '%;background:' + statusColor + ';transition:width .2s"></div></div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px"><div>' + progress.phase + '</div><span style="font-size:12px;color:' + statusColor + '">' + statusText + '</span></div>' +
      '<div style="font-size:12px;opacity:.78;margin-bottom:8px;word-break:break-all">' + (progress.detail || '正在迁移...') + '</div>' +
      '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;opacity:.86"><span>' + progress.current + '/' + (progress.total || 0) + '</span><span>成功 ' + progress.success + '</span><span>失败 ' + progress.failed + '</span><span>跳过 ' + progress.skipped + '</span></div>' +
      '<div style="margin-top:8px;font-size:12px;color:var(--b3-theme-warning, #b45309)">' + (done ? '迁移结果会保留在这里，请确认信息后点击按钮刷新思源。' : '迁移进行中，请勿关闭思源、切换工作空间或刷新页面。') + '</div>' +
      (done ? '<div style="display:flex;justify-content:flex-end;margin-top:10px"><button id="sireader-migration-close" style="padding:6px 12px;border:1px solid var(--b3-border-color,#ddd);background:var(--b3-theme-background,#fff);border-radius:8px;cursor:pointer">关闭并刷新</button></div>' : '')
    const closeBtn = host.querySelector('#sireader-migration-close')
    if (closeBtn) closeBtn.onclick = () => {
      removeHost()
      location.reload()
    }
  }
  const persist = (force = false) => {
    const now = Date.now()
    if (!force && now - lastPersist < 1000) return
    lastPersist = now
    void saveMigrationState({ progress: { ...progress, updatedAt: now } })
  }
  return {
    begin(phase: string, total = 0, detail = '') {
      progress.phase = phase
      progress.total = total
      progress.current = 0
      progress.detail = detail || progress.detail
      progress.updatedAt = Date.now()
      progress.status = 'running'
      paint(true)
      persist(true)
    },
    phase(phase: string, total = progress.total, detail = progress.detail) {
      progress.phase = phase
      progress.total = total
      progress.current = 0
      progress.detail = detail
      progress.updatedAt = Date.now()
      progress.status = 'running'
      paint(true)
      persist(true)
    },
    step(detail: string, patch: Partial<MigrationProgress> = {}, force = false) {
      progress.current += 1
      progress.detail = detail
      Object.assign(progress, patch, { updatedAt: Date.now() })
      progress.status = 'running'
      paint(force)
      persist(force)
    },
    update(patch: Partial<MigrationProgress>, force = false) {
      Object.assign(progress, patch, { updatedAt: Date.now() })
      paint(force)
      persist(force)
    },
    async finish(detail: string, status: MigrationProgress['status'] = 'completed') {
      progress.detail = detail
      progress.updatedAt = Date.now()
      progress.status = status
      paint(true)
      persist(true)
      await saveMigrationState({ progress: null })
    },
  }
}

const resolveLegacySourceCandidates = async (path = '', target = '', label = '') => {
  const sourceCandidates = [path]
  if (!(target.startsWith('/public/siyuan-sireader/') || target.startsWith('/data/public/siyuan-sireader/'))) return sourceCandidates
  const legacyIndex = await getLegacyAssetIndex()
  const fileName = getFileName(target)
  const hashMatch = fileName.match(/^([a-z0-9]+)\.([a-z0-9]+)$/i)
  if (legacyIndex[fileName]) sourceCandidates.push(legacyIndex[fileName])
  if (hashMatch) {
    const [, hash, ext] = hashMatch
    Object.entries(legacyIndex).forEach(([name, fullPath]) => {
      if (name === fileName) return
      if (name.endsWith('_' + hash + '.' + ext) || name.endsWith('.' + ext) && name.includes('_' + hash + '.')) sourceCandidates.push(fullPath)
    })
  }
  const titleMatched = findLegacyAssetByTitle(legacyIndex, label, target)
  if (titleMatched) sourceCandidates.push(titleMatched)
  return Array.from(new Set(sourceCandidates))
}

const migrateAssetPath = async (path = '', fallbackPath = '', size = 0, label = '') => {
  if (!path || path.startsWith('asset://')) return path
  if (isSiyuanAssetPath(path)) return path.replace(/^asset:\/\//i, '').replace(/^\/assets\//i, 'assets/')
  if (size > LARGE_FILE_NOTICE_BYTES) console.warn(DEBUG_PREFIX, 'migrateAssetPath:large-file', { path, size, fallbackPath, label })
  const target = fallbackPath || path
  const targetBytes = await readFileBytes(target).catch(() => null)
  if (path === target && targetBytes?.byteLength) return target
  try {
    const uniqueCandidates = await resolveLegacySourceCandidates(path, target, label)
    let sourceBytes = null
    let sourcePath = path
    for (const candidate of uniqueCandidates) {
      sourceBytes = await readFileBytes(candidate).catch(() => null)
      if (sourceBytes?.byteLength) {
        sourcePath = candidate
        break
      }
    }
    if (!sourceBytes?.byteLength) {
      if (!targetBytes?.byteLength && (target.startsWith('/public/siyuan-sireader/') || target.startsWith('/data/public/siyuan-sireader/'))) {
        throw new Error('missing source file for ' + (label || target))
      }
      return targetBytes?.byteLength ? target : path
    }
    await saveManagedFile(new Blob([sourceBytes]), target, getFileName(target))
    console.info(DEBUG_PREFIX, 'migrateAssetPath:copied', { label, sourcePath, target, size: sourceBytes.byteLength })
    return target
  } catch (error) {
    console.error(DEBUG_PREFIX, 'migrateAssetPath:error', { path, target, size, label, error })
    return path
  }
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
  let saved = 0
  for (const annotation of annotations) {
    try {
      await withRetry(labels.annotation(annotation.id || 'unknown'), async () => database.saveAnnotation(annotation))
      saved++
    } catch (error) {
      console.error(DEBUG_PREFIX, 'saveImportedBook:annotation-error', { book: book.url, annotationId: annotation.id, error })
    }
  }
  return saved
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
  const bookUrl = asString(bookIndex.bookUrl || data.bookUrl || bookIndex.url || data.url)
  const format = bookIndex.format || data.format || 'epub'
  const progress = bookIndex.epubProgress || data.epubProgress || 0
  const pos: any = {}
  const meta: any = {}

  if (data.epubCfi) pos.cfi = data.epubCfi
  if (data.durChapterIndex != null) pos.chapter = data.durChapterIndex
  if (data.durChapterPos != null) pos.position = data.durChapterPos
  if (data.durChapterPage != null) pos.page = data.durChapterPage
  if (data.durChapterTitle) pos.chapterTitle = data.durChapterTitle

  if (data.publisher) meta.publisher = data.publisher
  if (data.published) meta.publishDate = data.published
  if (data.identifier) meta.isbn = data.identifier
  if (data.language) meta.language = data.language
  if (data.intro) meta.description = data.intro
  if (data.totalChapterNum) meta.pageCount = data.totalChapterNum
  if (data.series) meta.series = data.series
  if (data.subjects) meta.subjects = data.subjects
  const size = asNumber(data.fileSize || bookIndex.fileSize || data.size || bookIndex.size)

  const book = {
    url: bookUrl,
    title: normalizeBookTitle(bookIndex.name || data.name || '未知书名') || '未知书名',
    author: bookIndex.author || data.author || '未知作者',
    cover: await migrateAssetPath(
      bookIndex.coverUrl || '',
      getCoverAssetPath(bookUrl, bookIndex.coverUrl || ''),
      0,
      `${bookUrl}:cover`,
    ),
    format,
    path: await migrateAssetPath(
      data.filePath || '',
      getBookAssetPath(bookUrl, data.filePath || '', format),
      size,
      bookIndex.name || bookUrl,
    ),
    size,
    added: bookIndex.addTime || data.addTime || now,
    read: bookIndex.durChapterTime || data.durChapterTime || now,
    finished: progress >= 100 ? now : 0,
    status: progress === 0 ? 'unread' : progress >= 100 ? 'finished' : 'reading',
    progress,
    time: 0,
    chapter: bookIndex.durChapterIndex || data.durChapterIndex || 0,
    total: bookIndex.totalChapterNum || data.totalChapterNum || 0,
    pos,
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
      ...(data.annotations || []).map((mark: any) => toAnnotation(bookUrl, mark, format, now)),
      ...(data.inkAnnotations || []).map((ink: any) => ({
        id: ink.id || `ink-${ink.page}-${ink.timestamp}`,
        book: bookUrl,
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
        book: bookUrl,
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
          book: bookUrl,
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
          book: bookUrl,
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

async function normalizeCurrentStorage(reporter?: ReturnType<typeof createMigrationReporter>) {
  const database = await db()
  const adopted = await withRetry('adoptLegacyAnnotations', async () => database.adoptLegacyAnnotations())
  await recoverLegacyFilesToPublic(reporter)
  const books = await database.getBooks().catch(() => [])
  let success = 0
  let failed = 0
  let skipped = 0
  let totalAnnotations = 0

  reporter?.phase('规范化当前数据', books.length, '正在校验书籍路径、封面路径与标注数据')

  for (const book of books) {
    try {
      const [path, cover, annotations] = await Promise.all([
        migrateAssetPath(book.path || '', getBookAssetPath(book.url, book.path || '', book.format || 'epub'), Number(book.size || 0), book.title || book.url),
        migrateAssetPath(book.cover || '', getCoverAssetPath(book.url, book.cover || ''), 0, `${book.title || book.url}:cover`),
        database.getAnnotations(book.url).catch(() => []),
      ])
      await withRetry(`normalizeBook:${book.url}`, async () => database.saveBook({ ...book, title: normalizeBookTitle(book.title || '') || book.title, path, cover }))
      totalAnnotations += annotations.length
      success++
      reporter?.step(book.title || book.url, { success, failed, skipped })
    } catch (error) {
      failed++
      skipped++
      console.error(DEBUG_PREFIX, 'normalizeCurrentStorage:error', { url: book.url, error })
      reporter?.step(book.title || book.url, { success, failed, skipped })
    }
  }

  await withRetry('deleteLegacySettings', async () => database.deleteSettings([...LEGACY_SETTING_KEYS]))
  const compacted = await withRetry('compactStorage', async () => database.compactStorage(), [0, 120, 320, 800])
  return { success, failed, skipped, totalAnnotations: Math.max(totalAnnotations, adopted.annotations || 0), adopted, compacted }
}

async function normalizeStorageIfNeeded(force = false) {
  const state = await getMigrationState()
  if (!force && state?.normalizedVersion === NORMALIZE_VERSION) return true
  const database = await db()
  const reporter = createMigrationReporter()
  const normalized = await normalizeCurrentStorage(reporter)
  await withRetry('flushNormalizedDatabase', async () => database.saveNow(), [0, 120, 320, 800])
  await saveMigrationState({
    normalized: !normalized.failed,
    normalizedVersion: NORMALIZE_VERSION,
    normalizeSuccess: normalized.success,
    normalizeFailed: normalized.failed,
    normalizeAnnotations: normalized.totalAnnotations,
    at: Date.now(),
  })
  await reporter.finish(
    normalized.failed
      ? `规范化完成，但有 ${normalized.failed} 本书处理失败，请查看迁移面板信息后手动刷新。`
      : `规范化完成，共处理 ${normalized.success} 本书，请查看迁移面板信息后手动刷新。`,
    normalized.failed ? 'error' : 'completed',
  )
  return !normalized.failed
}

async function migrateFromLegacyDb(files: Array<{ key: typeof DB_KEYS[number], bytes: Uint8Array }>, reporter?: ReturnType<typeof createMigrationReporter>) {
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
  let skipped = 0
  let totalAnnotations = 0
  reporter?.begin('迁移旧数据库', legacyBooks.length, `已发现 ${legacyBooks.length} 本书籍，正在迁移`)

  for (const row of legacyBooks) {
    const book = normalizeLegacyBook(row)
    if (!book.url) {
      skipped++
      reporter?.step('跳过缺少书籍 URL 的旧记录', { success, failed, skipped })
      continue
    }
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
      reporter?.step(book.title || book.url, { success, failed, skipped })
    } catch (error) {
      failed++
      console.error(DEBUG_PREFIX, 'migrateFromLegacyDb:error', { url: book.url, error })
      reporter?.step(book.title || book.url, { success, failed, skipped })
    }
  }

  const settings = Object.fromEntries(
    settingsRows
      .map(row => [asString(row.key), parseJson(row.val, row.val)])
      .filter(([key]) => key && !INTERNAL_SETTING_KEYS.has(key)),
  )
  if (Object.keys(settings).length) await withRetry('batchSaveSettings', async () => database.batchSaveSettings(settings))
  try { legacy.close?.() } catch {}
  return { success, failed, skipped, totalAnnotations }
}

const resolveLegacyBookDataPath = (bookIndex: any, legacyBooks: any[]) => {
  const exact = getBookIndexFile(bookIndex)
  if (legacyBooks.some(file => !file.isDir && file.name === exact)) return `${OLD_DATA_PATH}/books/${exact}`
  const suffix = `_${getBookUrlHash(asString(bookIndex.bookUrl || bookIndex.url))}.json`
  const matched = legacyBooks.find(file => !file.isDir && file.name.endsWith(suffix))
  return `${OLD_DATA_PATH}/books/${matched?.name || exact}`
}

async function migrateFromIndex(indexData: any[], legacyBooks: any[], reporter?: ReturnType<typeof createMigrationReporter>) {
  const database = await db()
  let success = 0
  let failed = 0
  let skipped = 0
  let totalAnnotations = 0
  reporter?.begin('迁移旧索引数据', indexData.length, `已发现 ${indexData.length} 本书籍，正在迁移`)

  for (const bookIndex of indexData) {
    try {
      const raw = await readJsonFile(resolveLegacyBookDataPath(bookIndex, legacyBooks))
      const { book, annotations } = await migrateBook(bookIndex, raw)
      if (!book.url) {
        skipped++
        reporter?.step(bookIndex?.name || '未知书籍', { success, failed, skipped })
        continue
      }
      totalAnnotations += await saveImportedBook(database, book, annotations, {
        book: `saveIndexBook:${book.url}`,
        annotation: id => `saveIndexAnnotation:${book.url}:${id}`,
      })
      success++
      reporter?.step(book.title || book.url, { success, failed, skipped })
    } catch (error) {
      failed++
      console.error(DEBUG_PREFIX, 'migrateFromIndex:error', { book: bookIndex?.name, error })
      reporter?.step(bookIndex?.name || '未知书籍', { success, failed, skipped })
    }
  }

  return { success, failed, skipped, totalAnnotations }
}

async function migrate(reporter?: ReturnType<typeof createMigrationReporter>) {
  const sources = await getSources()
  if (!sources.shouldRun) return { ...emptyResult(), importedDb: false, normalized: false, migrated: false, completed: true, sources }

  let result = emptyResult()
  let importedDb = false

  if (sources.legacyDbFiles.length) {
    result = await migrateFromLegacyDb(sources.legacyDbFiles, reporter)
    importedDb = true
  }
  if (!result.success && sources.indexData.length) result = await migrateFromIndex(sources.indexData, sources.legacyBooks, reporter)

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

  const normalized = await normalizeCurrentStorage(reporter)
  await withRetry('flushDatabase', async () => database.saveNow(), [0, 120, 320, 800])
  const success = result.success || normalized.success
  const failed = result.failed + normalized.failed
  const skipped = result.skipped + normalized.skipped
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
    skipped,
    totalAnnotations,
    retryable: !completed,
  })
  console.info(DEBUG_PREFIX, 'migrate:done', { success, failed, skipped, annotations: totalAnnotations, importedDb, completed })
  return {
    success,
    failed,
    skipped,
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
  return { deleted, failed }
}

export async function autoMigrate(): Promise<boolean> {
  const reporter = createMigrationReporter()
  try {
    if (!await needsMigration()) return false
    reporter.begin('开始迁移', 0, '正在分析旧数据结构')
    showMessage('检测到旧版数据，开始迁移，请勿刷新页面。', 4000, 'info')
    const result = await migrate(reporter)
    if (!result.completed) {
      await reporter.finish(`迁移未完成：成功 ${result.success} 本，失败 ${result.failed} 本，跳过 ${result.skipped} 本。旧数据已保留，可修复后再次刷新重试。`, 'error')
      showMessage(`迁移未完成：成功 ${result.success}，失败 ${result.failed}，跳过 ${result.skipped}。旧数据已保留，请处理后手动刷新重试。`, 7000, 'error')
      return false
    }
    reporter.begin('备份迁移前数据', 0, '正在生成旧数据备份，便于后续回滚')
    const backupPath = await backupLegacyData(result.sources, {
      success: result.success,
      failed: result.failed,
      skipped: result.skipped,
      totalAnnotations: result.totalAnnotations,
      importedDb: result.importedDb,
    })
    await removeDataKeys([...LEGACY_JSON_KEYS, ...LEGACY_SETTING_KEYS])
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
    await reporter.finish(
      cleanup.failed
        ? `迁移已完成，但清理阶段有 ${cleanup.failed} 项失败。旧数据库文件已保留。`
        : `迁移完成：${result.success} 本书、${result.totalAnnotations} 条标注，旧数据库文件已保留。`,
    )
    showMessage(
      cleanup.failed
        ? `迁移已完成，但仍有 ${cleanup.failed} 个旧文件未清理。备份位置：${backupPath}。请确认后手动刷新页面。`
        : `迁移完成：${result.success} 本书，${result.totalAnnotations} 条标注。备份位置：${backupPath}。请确认后手动刷新页面。`,
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
    await reporter.finish(`迁移失败：${error?.message || 'unknown error'}。旧数据未删除，请修复后手动刷新重试。`, 'error')
    showMessage(`迁移失败：${error?.message || 'unknown error'}。旧数据未删除，请处理后手动刷新重试。`, 7000, 'error')
    return false
  }
}
