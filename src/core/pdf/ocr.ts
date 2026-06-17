import type { PDFDocumentProxy } from 'pdfjs-dist'
import { fetchSyncPost } from 'siyuan'
import { putFile, removeFile } from '@/api'
import { loadData, saveData } from '@/core/bookStore'

export type PdfOcrPageResult = {
  page: number
  text: string
  ocrJSON: any[]
  assetPath: string
  image: { width: number; height: number; bytes: number }
  pageSize: { width: number; height: number }
  cached: boolean
}

export type PdfOcrPageOptions = {
  bookKey: string
  page: number
  rotation?: 0 | 90 | 180 | 270
  scale?: number
  quality?: number
  maxFileSize?: number
}

export type PdfOcrBatchOptions = Omit<PdfOcrPageOptions, 'page'>

type PdfOcrStore = {
  version: 1
  pages: Record<string, PdfOcrPageResult>
}

const STORE_VERSION = 1
const STORE_PREFIX = 'pdf-ocr'
const TEMP_ROOT = '/data/assets/siyuan-sireader-ocr'
const DEFAULT_SCALE = 2
const DEFAULT_QUALITY = 0.86
const DEFAULT_MAX_FILE_SIZE = 1900 * 1024
const cache = new Map<string, PdfOcrStore>()
const pending = new Map<string, Promise<PdfOcrPageResult>>()

const hash = (value: string) => {
  let n = 0
  for (let i = 0; i < value.length; i++) n = ((n << 5) - n + value.charCodeAt(i)) | 0
  return Math.abs(n).toString(36)
}

const storeKey = (bookKey: string) => `${STORE_PREFIX}/${hash(bookKey)}.json`
const pageKey = (opt: Pick<PdfOcrPageOptions, 'page' | 'rotation' | 'scale'>) => `${opt.page}:${opt.rotation || 0}:${(opt.scale || DEFAULT_SCALE).toFixed(2)}`
const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '')
const request = async <T = any>(url: string, data: any): Promise<T> => {
  const res = await fetchSyncPost(url, data)
  if (!res || res.code !== 0) throw new Error(res?.msg || `Request failed: ${url}`)
  return res.data as T
}
const canvasToBlob = (canvas: HTMLCanvasElement, quality = DEFAULT_QUALITY) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => {
    if (blob) resolve(blob)
    else reject(new Error('Failed to encode OCR image'))
  }, 'image/jpeg', quality)
})

const getStore = async (bookKey: string): Promise<PdfOcrStore> => {
  const key = storeKey(bookKey)
  const existing = cache.get(key)
  if (existing) return existing
  const stored = await loadData<PdfOcrStore>(key).catch(() => null)
  const next = stored?.version === STORE_VERSION ? stored : { version: STORE_VERSION, pages: {} }
  cache.set(key, next)
  return next
}

const saveStore = async (bookKey: string, store: PdfOcrStore) => {
  cache.set(storeKey(bookKey), store)
  await saveData(storeKey(bookKey), store)
}

const resolveScale = (page: any, scale?: number) => {
  if (scale) return scale
  const base = page.getViewport({ scale: 1 })
  const maxSide = Math.max(base.width, base.height) || 1
  return Math.min(DEFAULT_SCALE, Math.max(1.2, 2200 / maxSide))
}

const renderPageToBlob = async (pdf: PDFDocumentProxy, pageNum: number, opt: PdfOcrPageOptions) => {
  const page = await pdf.getPage(pageNum)
  const scale = resolveScale(page, opt.scale)
  const viewport = page.getViewport({ scale, rotation: opt.rotation || 0 })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Failed to create OCR canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise
  const maxSize = opt.maxFileSize || DEFAULT_MAX_FILE_SIZE
  let quality = opt.quality || DEFAULT_QUALITY
  let blob = await canvasToBlob(canvas, quality)
  while (blob.size > maxSize && quality > 0.52) {
    quality = Math.max(0.52, quality - 0.08)
    blob = await canvasToBlob(canvas, quality)
  }
  if (blob.size > maxSize) throw new Error(`OCR image is too large (${Math.round(blob.size / 1024)}KB)`)
  return { blob, viewport }
}

const uploadTempAsset = async (blob: Blob, bookKey: string, pageNum: number) => {
  const bookHash = hash(bookKey)
  const name = `page-${String(pageNum).padStart(4, '0')}-${uid()}.jpg`
  const dataPath = `${TEMP_ROOT}/${bookHash}/${name}`
  const dataDir = dataPath.split('/').slice(0, -1).join('/')
  const file = new File([blob], name, { type: blob.type || 'image/jpeg' })
  await putFile(dataDir, true, new File([], ''))
  await putFile(dataPath, false, file)
  return dataPath.replace(/^\/data\//, '')
}

const ocrAsset = async (assetPath: string) => request<{ text: string; ocrJSON: any[] }>('/api/asset/ocr', { path: assetPath, force: true })

export const clearPdfOcrCache = async (bookKey: string) => {
  const key = storeKey(bookKey)
  cache.delete(key)
  await saveData(key, { version: STORE_VERSION, pages: {} })
}

export const getCachedPdfOcrPage = async (bookKey: string, page: number, rotation: 0 | 90 | 180 | 270 = 0, scale = DEFAULT_SCALE) => {
  const store = await getStore(bookKey)
  return store.pages[pageKey({ page, rotation, scale })] || null
}

export const ocrPdfPage = async (pdf: PDFDocumentProxy, opt: PdfOcrPageOptions): Promise<PdfOcrPageResult> => {
  const cacheId = `${storeKey(opt.bookKey)}::${pageKey(opt)}`
  if (pending.has(cacheId)) return pending.get(cacheId)!

  const run = (async () => {
    const store = await getStore(opt.bookKey)
    const key = pageKey(opt)
    const cached = store.pages[key]
    if (cached) return { ...cached, cached: true }

    const { blob, viewport } = await renderPageToBlob(pdf, opt.page, opt)
    const assetPath = await uploadTempAsset(blob, opt.bookKey, opt.page)
    try {
      const result = await ocrAsset(assetPath)
      const pageResult: PdfOcrPageResult = {
        page: opt.page,
        text: result?.text || '',
        ocrJSON: result?.ocrJSON || [],
        assetPath,
        image: { width: viewport.width, height: viewport.height, bytes: blob.size },
        pageSize: { width: viewport.width, height: viewport.height },
        cached: false,
      }
      store.pages[key] = pageResult
      await saveStore(opt.bookKey, store)
      return pageResult
    } finally {
      await removeFile(`/data/${assetPath}`).catch(() => {})
    }
  })().finally(() => pending.delete(cacheId))

  pending.set(cacheId, run)
  return run
}

export const ocrPdfPages = async (
  pdf: PDFDocumentProxy,
  pages: number[],
  opt: PdfOcrBatchOptions,
  onProgress?: (done: number, total: number, page: number, result?: PdfOcrPageResult, error?: Error) => void,
) => {
  const results: PdfOcrPageResult[] = []
  const errors: Array<{ page: number; error: Error }> = []
  const total = pages.length
  let done = 0

  for (const page of pages) {
    try {
      const result = await ocrPdfPage(pdf, { ...opt, page })
      results.push(result)
      done += 1
      onProgress?.(done, total, page, result)
    } catch (error: any) {
      done += 1
      const err = error instanceof Error ? error : new Error(String(error || 'OCR failed'))
      errors.push({ page, error: err })
      onProgress?.(done, total, page, undefined, err)
    }
  }

  return { results, errors }
}

export const ocrPdfAll = async (
  pdf: PDFDocumentProxy,
  opt: PdfOcrBatchOptions,
  onProgress?: (done: number, total: number, page: number, result?: PdfOcrPageResult, error?: Error) => void,
) => ocrPdfPages(pdf, Array.from({ length: pdf.numPages }, (_, i) => i + 1), opt, onProgress)
