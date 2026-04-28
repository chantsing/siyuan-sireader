import { putFile, readDir, removeFile } from '@/api'
import { usePlugin } from '@/main'

export const LEGACY_ROOT = '/data/storage/petal/siyuan-sireader'
export const OLD_PUBLIC_DATA_ROOT = '/data/public/siyuan-sireader'
export const OLD_PUBLIC_ROOT = '/public/siyuan-sireader'
export const PUBLIC_ROOT = '/public/siyuan-sireader'
export const PUBLIC_DATA_ROOT = '/data/public/siyuan-sireader'
export const DB_KEYS = ['reader.db', 'reader.last-good.db'] as const

const BOOKS_DIR = 'books'
const COVERS_DIR = 'covers'
const RECORDS_DIR = 'records'
const LEGACY_RECORD_KEY_PREFIX = 'book-record-'
const getPlugin = () => usePlugin()
const decoder = new TextDecoder()
const isApiErrorPayload = (bytes?: Uint8Array | null) => {
  if (!bytes?.byteLength || bytes.byteLength > 512) return false
  const text = decoder.decode(bytes).trim()
  if (!text.startsWith('{') || !text.includes('"code"')) return false
  try {
    const payload = JSON.parse(text)
    return typeof payload?.code === 'number' && payload.code !== 0
  } catch {
    return false
  }
}

export interface BookRecord {
  version: 1
  book: Record<string, any>
  annotations: any[]
  updatedAt: number
}

export interface StoredBookRef {
  url: string
  path?: string
  cover?: string
}

const hash = (str: string) => {
  let value = 0
  for (let i = 0; i < str.length; i++) value = (((value << 5) - value) + str.charCodeAt(i)) | 0
  return Math.abs(value).toString(36)
}

const publicToDataPath = (path = '') => path.startsWith('/public/') ? path.replace('/public/', '/data/public/') : path
const toPublicPath = (path = '') => path.startsWith('/data/public/') ? path.replace('/data/public/', '/public/') : path
const toLegacyPath = (path = '') => path.replace(OLD_PUBLIC_ROOT, OLD_PUBLIC_DATA_ROOT).replace(OLD_PUBLIC_DATA_ROOT, LEGACY_ROOT)
const isRemotePath = (path = '') => /^(https?:\/\/|file:\/\/)/i.test(path)
const isPublicPath = (path = '') => path.startsWith('/public/') || path.startsWith('/data/public/')
const isLegacyManagedPath = (path = '') => path.startsWith(LEGACY_ROOT) || path.startsWith(OLD_PUBLIC_ROOT) || path.startsWith(OLD_PUBLIC_DATA_ROOT)
const isManagedPath = (path = '') => path.startsWith(PUBLIC_ROOT) || path.startsWith(PUBLIC_DATA_ROOT) || isLegacyManagedPath(path)
const getRecordKey = (url: string) => `${RECORDS_DIR}/${hash(url)}.json`
const getLegacyRecordKey = (url: string) => `${LEGACY_RECORD_KEY_PREFIX}${hash(url)}.json`
const parseStoredValue = <T = any>(value: any): T | null => {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return value as T }
  }
  return value as T
}

const readFileResponse = async (path: string) => {
  if (!path) return null
  const target = path.startsWith('/public/') ? publicToDataPath(path) : path
  return fetch('/api/file/getFile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: target }),
  }).catch(() => null)
}

export const readDirEntries = async (path: string) => (await readDir(path).catch(() => ({ data: [] as any[] })))?.data || []

export const readFileText = async (path: string) => {
  const res = await readFileResponse(path)
  const text = res?.ok ? await res.text().catch(() => '') : ''
  return text && !isApiErrorPayload(new TextEncoder().encode(text)) ? text : ''
}

export const readFileBlob = async (path: string) => {
  const res = await readFileResponse(path)
  if (!res?.ok) return null
  const blob = await res.blob().catch(() => null)
  if (!blob) return null
  if (blob.size <= 512) {
    const text = await blob.text().catch(() => '')
    if (text && isApiErrorPayload(new TextEncoder().encode(text))) return null
  }
  return blob
}

export const readFileBytes = async (path: string) => {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) {
    const res = await fetch(path)
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  }
  if (path.startsWith('file://')) return null
  const res = await readFileResponse(path)
  if (!res.ok) return null
  const bytes = new Uint8Array(await res.arrayBuffer())
  return isApiErrorPayload(bytes) ? null : bytes
}

export const readManagedFile = async (path: string, fallbackName?: string) => {
  const blob = await readFileBlob(path)
  return blob ? new File([blob], fallbackName || path.split(/[/\\]/).pop() || 'file', { type: blob.type || 'application/octet-stream' }) : null
}

const putPublicFile = async (blob: Blob, publicPath: string, name?: string) => {
  const dataPath = publicToDataPath(publicPath)
  const dirPath = dataPath.split('/').slice(0, -1).join('/')
  const fileName = name || publicPath.split('/').pop() || 'file'
  const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' })
  try { await putFile(dirPath, true, new File([], '')) } catch {}
  await putFile(dataPath, false, file)
  return publicPath
}

export const getBookFileName = (url: string, ext: string) => `${hash(url)}.${ext}`
export const getBookFileDataPath = (url: string, ext: string) => `${PUBLIC_ROOT}/${BOOKS_DIR}/${getBookFileName(url, ext)}`
export const getManagedFileExt = (path = '', fallback = 'bin') => {
  const cleanPath = path.split('?')[0].split('#')[0]
  const ext = cleanPath.split('.').pop()?.trim().toLowerCase()
  return ext && /^[a-z0-9]+$/.test(ext) ? ext : fallback
}
export const getCoverFileDataPath = (url: string, ext = 'jpg') => `${PUBLIC_ROOT}/${COVERS_DIR}/${getBookFileName(url, ext)}`
export const normalizeBookTitle = (title = '') => {
  const trimmed = title.trim()
  if (!trimmed) return ''
  const withoutExt = trimmed.replace(/\.(epub|pdf|mobi|azw3|azw|txt|fb2|cbz)$/i, '')
  return withoutExt.replace(/_[a-z0-9]{4,12}$/i, '') || withoutExt || trimmed
}

export const loadData = async <T = any>(key: string): Promise<T | null> => {
  try {
    return parseStoredValue<T>(await getPlugin().loadData(key))
  } catch {
    return null
  }
}

export const saveData = async (key: string, data: any) => {
  await getPlugin().saveData(key, data)
}

export const removeData = async (key: string) => {
  await getPlugin().removeData(key)
}

export const saveManagedFile = async (blob: Blob, path: string, name?: string) => putPublicFile(blob, path, name)

export const migrateManagedPath = async (path = '', fallbackPath?: string) => {
  if (!path || path.startsWith('asset://')) return path
  if (!isManagedPath(path)) return path
  const bytes = await readFileBytes(path)
  const target = fallbackPath || toPublicPath(path).replace(OLD_PUBLIC_ROOT, PUBLIC_ROOT).replace(OLD_PUBLIC_DATA_ROOT, PUBLIC_ROOT).replace(LEGACY_ROOT, PUBLIC_ROOT)
  if (path === target || publicToDataPath(path) === publicToDataPath(target)) return target
  if (!bytes?.byteLength) {
    return target
  }
  const nextPath = await saveManagedFile(new Blob([bytes]), target, target.split('/').pop())
  if (path !== nextPath) {
    try { await removeFile(path.startsWith('/public/') ? publicToDataPath(path) : toLegacyPath(path)) } catch {}
  }
  return nextPath
}

export const readBookRecord = async (url: string): Promise<BookRecord | null> => {
  const key = getRecordKey(url)
  return await loadData<BookRecord>(key) || await loadData<BookRecord>(getLegacyRecordKey(url))
}
export const writeBookRecord = async (url: string, record: BookRecord) => {
  const key = getRecordKey(url)
  await saveData(key, record)
  await removeData(getLegacyRecordKey(url))
}
export const removeBookRecord = async (url: string) => {
  await Promise.all([removeData(getRecordKey(url)), removeData(getLegacyRecordKey(url))])
}

export const removeManagedFile = async (path = '') => {
  if (!path || path.startsWith('asset://') || isRemotePath(path)) return
  try { await removeFile(isPublicPath(path) ? publicToDataPath(path) : toLegacyPath(path)) } catch {}
}

export const cleanupManagedStorage = async (books: StoredBookRef[]) => {
  const keep = new Set(
    books
      .flatMap(book => [book.path || '', book.cover || ''])
      .filter(path => path.startsWith('/public/siyuan-sireader/'))
      .map(publicToDataPath),
  )
  for (const dir of [`${PUBLIC_DATA_ROOT}/${BOOKS_DIR}`, `${PUBLIC_DATA_ROOT}/${COVERS_DIR}`]) {
    for (const file of await readDirEntries(dir)) {
      const path = `${dir}/${file.name || ''}`
      if (!file.isDir && !keep.has(path)) try { await removeFile(path) } catch {}
    }
  }
}

export const clearStoredPluginData = async (books: StoredBookRef[] = []) => {
  for (const book of books) {
    await Promise.all([removeManagedFile(book.path), removeManagedFile(book.cover), removeBookRecord(book.url)])
  }
  for (const key of ['bookshelf.json', 'settings.json', 'daily.json', 'migrated.json']) await removeData(key)
  for (const key of DB_KEYS) await removeData(key)
}
