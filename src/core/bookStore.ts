import { putFile, readDir, removeFile } from '@/api'
import { usePlugin } from '@/main'

export const PUBLIC_ROOT = '/public/siyuan-sireader'
export const SIYUAN_CLOUD_BASE = '/plugin/private/siyuan-cloud'
const PLUGIN_STORAGE_ROOT = '/data/storage/petal'

const BOOKS_DIR = 'books'
const COVERS_DIR = 'covers'
const RECORDS_DIR = 'records'
const SUPPORTED_BOOK_EXTS = ['epub', 'pdf', 'mobi', 'azw3', 'azw', 'fb2', 'cbz', 'txt'] as const
const getPlugin = () => usePlugin()

export interface BookRecord {
  version: 1
  book: Record<string, any>
  annotations: any[]
  updatedAt: number
}

export interface EmbedPdfProgress {
  pageNumber: number
  totalPages: number
  pageCoordinates?: { x: number; y: number }
  updatedAt: number
}

export interface EmbedPdfRecord {
  version: 1
  annotations: any[]
  progress?: EmbedPdfProgress
}

const MISSING_DATA = Symbol('sireader.missingData')

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
const isRemotePath = (path = '') => /^(https?:\/\/|file:\/\/)|^\/plugin\/private\//i.test(path)
const isPublicPath = (path = '') => path.startsWith('/public/') || path.startsWith('/data/public/')
const getRecordKey = (url: string) => `${RECORDS_DIR}/${hash(url)}.json`
const getEmbedPdfRecordKey = (url: string) => `${RECORDS_DIR}/embedpdf/${hash(url)}.bin`
const req = (id: string) => { try { return (window as any).require?.(id) } catch { return null } }
const normalizeStoragePath = (storageName = '') => {
  const resolved: string[] = []
  for (const part of storageName.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') resolved.pop()
    else resolved.push(part)
  }
  return resolved.length ? resolved.join('/') : storageName.replace(/[\/\\]+/g, '')
}
const getPluginStoragePath = (key: string) => `${PLUGIN_STORAGE_ROOT}/${getPlugin().name}/${normalizeStoragePath(key)}`
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const isApiErrorPayload = (bytes?: Uint8Array | null) => {
  if (!bytes?.byteLength || bytes.byteLength > 512) return false
  const text = new TextDecoder().decode(bytes).trim()
  if (!text.startsWith('{') || !text.includes('"code"')) return false
  try {
    const payload = JSON.parse(text)
    return typeof payload?.code === 'number' && payload.code !== 0 && 'msg' in payload && 'data' in payload
  } catch {
    return false
  }
}

const parseStoredValue = <T = any>(value: any): T | null | typeof MISSING_DATA => {
  if (value == null || value === '') return MISSING_DATA
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

const readPluginStorageRawOnce = async (key: string): Promise<string | typeof MISSING_DATA> => {
  const res = await readFileResponse(getPluginStoragePath(key))
  if (!res?.ok) return MISSING_DATA
  const text = await res.text().catch(() => '')
  if (!text) return MISSING_DATA
  if (isApiErrorPayload(new TextEncoder().encode(text))) return MISSING_DATA
  return text
}

const readPluginStorageRaw = async (key: string, retries = 0): Promise<string | typeof MISSING_DATA> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await readPluginStorageRawOnce(key)
    if (raw !== MISSING_DATA || attempt === retries) return raw
    await sleep(80 + attempt * 160)
  }
  return MISSING_DATA
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

const getV8 = () => req('v8')
const getBuffer = () => req('buffer')?.Buffer || (window as any).Buffer
const rectFromArray = (rect: number[] = []) => {
  const [x1 = 0, y1 = 0, x2 = x1, y2 = y1] = rect
  return { origin: { x: Math.min(x1, x2), y: Math.min(y1, y2) }, size: { width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) } }
}
const rectFromBox = (box: any = {}) => ({
  origin: { x: Number(box.x || 0), y: Number(box.y || 0) },
  size: { width: Number(box.w || box.width || 0), height: Number(box.h || box.height || 0) },
})
const legacyColorToHex = (color = '', fallback = '#FFCD45') => ({ yellow: '#ffeb3b', red: '#ef5350', green: '#66bb6a', blue: '#42a5f5', purple: '#ab47bc', orange: '#ff9800', pink: '#ec407a' } as Record<string, string>)[color] || color || fallback
const isUserEmbedPdfAnnotation = (item: any) => {
  const a = item?.annotation || item
  if (!a || (a.type === 4 && !a.linePoints) || ([7, 8].includes(a.type) && !Array.isArray(a.vertices))) return false
  return a.type !== 2 || !!(a.created || a.modified || a.author || a.custom || String(a.contents || '').trim())
}
const plainValue = (value: any): any => {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  if (value instanceof Date || value instanceof ArrayBuffer) return value
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  if (Array.isArray(value)) return value.map(plainValue)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== 'function' && typeof v !== 'symbol').map(([k, v]) => [k, plainValue(v)]))
  return undefined
}
const normalizeEmbedPdfAnnotations = (annotations: any[] = []) => annotations.filter(isUserEmbedPdfAnnotation).map(item => ({
  annotation: plainValue(item.annotation || item),
  ...(item.ctx ? { ctx: plainValue(item.ctx) } : {}),
}))

export const isSupportedBookFile = (name = '') => new RegExp(`\\.(${SUPPORTED_BOOK_EXTS.join('|')})$`, 'i').test(name)
export const filterSupportedBookFiles = (files: File[]) => files.filter(file => isSupportedBookFile(file.name))
export const readDirEntries = async (path: string) => (await readDir(path).catch(() => ({ data: [] as any[] })))?.data || []

export const normalizeSiyuanCloudUrl = (value = '') => {
  const i = value.indexOf(SIYUAN_CLOUD_BASE)
  return i >= 0 ? value.slice(i) : value
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

export const readManagedFile = async (path: string, fallbackName?: string) => {
  const blob = await readFileBlob(path)
  return blob ? new File([blob], fallbackName || path.split(/[/\\]/).pop() || 'file', { type: blob.type || 'application/octet-stream' }) : null
}

export const normalizeNativePath = (value = '') => {
  if (!value) return ''
  const path = req('path')
  const raw = decodeURI(`${value}`).replace(/^file:\/+/, path?.sep === '\\' ? '' : '/')
  return path ? path.normalize(raw) : raw
}

export const createLocalFileRef = (path: string, size: number, lastModified: number) => {
  const normalized = normalizeNativePath(path)
  return {
    name: normalized.split(/[\\/]/).pop() || 'file',
    size,
    type: '',
    lastModified,
    path: normalized,
  } as File
}

export const materializeNativeFile = (file: File): File => {
  const path = normalizeNativePath((file as any)?.path || (file as any)?._path || '')
  if (!path) return file
  const cached = (file as any)._realFile
  if (cached) return cached
  const fs = req('fs')
  if (!fs) return file
  const realFile = new File([fs.readFileSync(path)], file.name || path.split(/[\\/]/).pop() || 'file', {
    type: file.type || '',
    lastModified: file.lastModified || Date.now(),
  }) as File & { path?: string }
  Object.defineProperty(realFile, 'path', { value: path })
  ;(file as any)._realFile = realFile
  return realFile
}

export const toFileUrl = (value: string | File) => {
  const path = normalizeNativePath(typeof value === 'string' ? value : ((value as any)?.path || (value as any)?._path || ''))
  if (!path) return ''
  return path.startsWith('/') ? `file://${encodeURI(path)}` : `file:///${path.replace(/\\/g, '/').replace(/^\/+/, '')}`
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

export const loadDataState = async <T = any>(key: string, options: { retries?: number } = {}): Promise<{ found: boolean; value: T | null }> => {
  try {
    // Critical reader state bypasses Plugin.data so SiYuan sync changes are visible immediately.
    const raw = await readPluginStorageRaw(key, Math.max(0, Number(options.retries || 0)))
    const value = parseStoredValue<T>(raw)
    return value === MISSING_DATA ? { found: false, value: null } : { found: true, value: value as T }
  } catch {
    return { found: false, value: null }
  }
}

export const loadData = async <T = any>(key: string): Promise<T | null> => {
  const state = await loadDataState<T>(key)
  return state.found ? state.value : null
}

export const saveData = async (key: string, data: any) => {
  const plugin = getPlugin()
  await plugin.saveData(key, data)
  if ((plugin as any).data) (plugin as any).data[key] = data
}

export const removeData = async (key: string) => {
  const plugin = getPlugin()
  await plugin.removeData(key)
  if ((plugin as any).data) delete (plugin as any).data[key]
}

export const saveManagedFile = async (blob: Blob, path: string, name?: string) => putPublicFile(blob, path, name)

export const readBookRecord = async (url: string): Promise<BookRecord | null> => loadData<BookRecord>(getRecordKey(url))
export const writeBookRecord = async (url: string, record: BookRecord) => saveData(getRecordKey(url), record)
export const removeBookRecord = async (url: string) => removeData(getRecordKey(url))
const readEmbedPdfRecord = async (url: string): Promise<EmbedPdfRecord | null> => {
  const v8 = getV8()
  const Buffer = getBuffer()
  const blob = v8 && Buffer ? await readFileBlob(getPluginStoragePath(getEmbedPdfRecordKey(url))) : null
  if (blob) {
    const record = v8.deserialize(Buffer.from(await blob.arrayBuffer()))
    if (record?.version === 1) return { version: 1, annotations: Array.isArray(record.annotations) ? record.annotations : [], progress: record.progress }
  }
  return null
}
const writeEmbedPdfRecord = async (url: string, record: EmbedPdfRecord) => {
  const v8 = getV8()
  if (!v8) return
  const key = getEmbedPdfRecordKey(url)
  const path = getPluginStoragePath(key)
  const dir = path.split('/').slice(0, -1).join('/')
  await putFile(dir, true, new File([], ''))
  await putFile(path, false, new File([v8.serialize(record)], key.split('/').pop() || 'embedpdf.bin', { type: 'application/octet-stream' }))
}
export const readEmbedPdfAnnotations = async (url: string): Promise<any[] | null> => {
  const record = await readEmbedPdfRecord(url)
  return record?.annotations || null
}
export const writeEmbedPdfAnnotations = async (url: string, annotations: any[]) => {
  const record = await readEmbedPdfRecord(url)
  await writeEmbedPdfRecord(url, { version: 1, annotations: normalizeEmbedPdfAnnotations(annotations), progress: record?.progress })
}
export const readEmbedPdfProgress = async (url: string): Promise<EmbedPdfProgress | null> => {
  const record = await readEmbedPdfRecord(url)
  return record?.progress || null
}
export const writeEmbedPdfProgress = async (url: string, progress: EmbedPdfProgress) => {
  const record = await readEmbedPdfRecord(url)
  await writeEmbedPdfRecord(url, { version: 1, annotations: record?.annotations || [], progress })
}
export const removeEmbedPdfAnnotations = async (url: string) => {
  await removeFile(getPluginStoragePath(getEmbedPdfRecordKey(url))).catch(() => {})
}
const legacyAnnotationToEmbedPdf = (item: any) => {
  const data = item?.data || {}
  const pageIndex = Math.max(0, Number(data.page || item.page || item.loc || 1) - 1)
  const color = legacyColorToHex(item.color, item.type === 'highlight' ? '#FFCD45' : '#E44234')
  const custom = Object.fromEntries(Object.entries({ text: item.text || data.text, note: item.note || data.note, tags: item.tags || data.tags, blockId: item.blockId || item.block, chapter: item.chapter, style: item.style || data.style, textOffset: item.textOffset || data.textOffset, customOrder: item.customOrder }).filter(([, v]) => Array.isArray(v) ? v.length : v))
  const base = { id: item.id, pageIndex, flags: ['print'], created: new Date(item.created || Date.now()).toISOString(), modified: new Date(item.updated || item.created || Date.now()).toISOString(), author: 'SiReader', ...(Object.keys(custom).length ? { custom } : {}) }
  if (item.type === 'highlight') {
    const rects = (data.rects || item.rects || []).map(rectFromBox)
    return rects[0] && { annotation: { ...base, type: 9, strokeColor: color, opacity: 1, rect: rects[0], segmentRects: rects, contents: item.note || data.note || '' } }
  }
  if (item.type === 'ink') return { annotation: { ...base, type: 15, strokeColor: color, color, opacity: data.opacity ?? 1, strokeWidth: data.paths?.[0]?.width || 2, rect: rectFromArray(data.rect), inkList: (data.paths || []).map((path: any) => ({ points: path.points || [] })), contents: item.note || data.note || item.text || data.text || '' } }
  if (item.type === 'shape' && data.shapeType === 'textbox') return { annotation: { ...base, type: 3, contents: item.text || data.text || item.note || data.note || '', fontSize: 14, fontColor: color, fontFamily: 4, textAlign: 0, verticalAlign: 0, color: 'transparent', backgroundColor: 'transparent', opacity: 1, rect: rectFromArray(data.rect), unrotatedRect: rectFromArray(data.rect), rotation: 0 } }
  if (item.type === 'shape') return { annotation: { ...base, type: data.shapeType === 'circle' ? 6 : 5, color: 'transparent', strokeColor: color, strokeWidth: data.strokeWidth || 2, strokeStyle: 0, opacity: 1, rect: rectFromArray(data.rect), contents: item.note || data.note || item.text || data.text || '' } }
  return null
}
export const migrateLegacyPdfAnnotationsToEmbedPdf = async (url: string) => {
  if ((await readEmbedPdfAnnotations(url))?.length) return null
  const legacy = await readBookRecord(url)
  const annotations = normalizeEmbedPdfAnnotations((legacy?.annotations || []).map(legacyAnnotationToEmbedPdf).filter(Boolean))
  if (!annotations.length) return null
  await writeEmbedPdfRecord(url, { version: 1, annotations, progress: legacy?.book?.chapter ? { pageNumber: legacy.book.chapter, totalPages: legacy.book.total || 0, updatedAt: legacy.book.read || Date.now() } : undefined })
  return annotations
}

export const removeManagedFile = async (path = '') => {
  if (!path || path.startsWith('asset://') || isRemotePath(path)) return
  try { await removeFile(isPublicPath(path) ? publicToDataPath(path) : path) } catch {}
}

export const saveBookFile = async (file: File, url: string) => {
  const ext = file.name.split('.').pop() || 'bin'
  return saveManagedFile(file, getBookFileDataPath(url, ext))
}

export const saveCoverFile = async (blob: Blob, url: string) => {
  const ext = getManagedFileExt(blob.type.split('/').pop() || '', 'jpg')
  return saveManagedFile(blob, getCoverFileDataPath(url, ext))
}

export const saveOptionalCover = async (blob: Blob | undefined, url: string) => blob ? saveCoverFile(blob, url) : undefined

// 统一读取入口，避免上层重复判断 http / file / public / data 路径。
export const loadBookFile = async (path: string): Promise<File> => {
  path = normalizeSiyuanCloudUrl(path)
  if (path.startsWith(`${SIYUAN_CLOUD_BASE}/`)) {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return new File([await res.arrayBuffer()], path.split('/').pop()?.split('?')[0] || 'book', {
      type: res.headers.get('content-type') || 'application/octet-stream',
    })
  }
  if (path.startsWith('http://') || path.startsWith('https://')) {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    return new File([await res.arrayBuffer()], path.split('/').pop()?.split('?')[0] || 'book', {
      type: res.headers.get('content-type') || 'application/octet-stream',
    })
  }
  if (path.startsWith('file://')) {
    const filePath = decodeURI(path.substring(7)).replace(/^\/([a-zA-Z]:[\\/])/, '$1')
    const fs = req('fs')
    if (fs) return new File([fs.readFileSync(filePath)], filePath.split(/[/\\]/).pop() || 'book')
    throw new Error('本地文件仅支持桌面端')
  }
  const publicPath = path.startsWith('/assets/') || path.startsWith('/public/')
    ? path
    : path.startsWith('assets/') || path.startsWith('public/')
      ? `/${path}`
      : ''
  if (publicPath) {
    const name = path.split(/[/\\]/).pop() || 'book'
    const res = await fetch(publicPath).catch(() => null)
    if (res?.ok) return new File([await res.arrayBuffer()], name, {
      type: res.headers.get('content-type') || 'application/octet-stream',
    })
    if (publicPath.startsWith(PUBLIC_ROOT)) {
      const file = await readManagedFile(publicPath, name)
      if (!file) throw new Error('文件加载失败')
      return file
    }
    throw new Error('文件加载失败')
  }
  const blob = await readFileBlob(path)
  if (!blob) throw new Error('文件加载失败')
  return new File([blob], path.split(/[/\\]/).pop() || 'book', { type: blob.type || 'application/octet-stream' })
}

export const clearStoredPluginData = async (books: StoredBookRef[] = []) => {
  for (const book of books) {
    await Promise.all([removeManagedFile(book.path), removeManagedFile(book.cover), removeBookRecord(book.url), removeEmbedPdfAnnotations(book.url)])
  }
  for (const key of ['bookshelf.json', 'settings.json', 'daily.json']) await removeData(key)
}
