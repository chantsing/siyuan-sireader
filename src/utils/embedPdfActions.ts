import { LicenseManager } from '@/core/license'
import { inlineLinkText, sendMarkToDoc } from '@/utils/copy'

const PDF_ASSET_DATA_DIR = '/data/public/siyuan-sireader/embedpdf'
const PDF_WASM_DATA_PATH = `${PDF_ASSET_DATA_DIR}/pdfium.wasm`
const PDF_WASM_PUBLIC_URL = '/public/siyuan-sireader/embedpdf/pdfium.wasm'
const PDF_WASM_SOURCE_URL = 'https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@2.14.4/dist/pdfium.wasm'
const PDF_RUNTIME_DATA_DIR = `${PDF_ASSET_DATA_DIR}/snippet`
const PDF_RUNTIME_PUBLIC_DIR = '/public/siyuan-sireader/embedpdf/snippet'
const PDF_RUNTIME_PUBLIC_URL = `${PDF_RUNTIME_PUBLIC_DIR}/embedpdf.js`
const PDF_RUNTIME_SOURCE_BASE = 'https://cdn.jsdelivr.net/npm/@embedpdf/snippet@2.14.4/dist'
const PDF_RUNTIME_FILES = ['embedpdf.js', 'embedpdf-7TNsu-EA.js', 'worker-engine-BkD2-rJn.js', 'direct-engine-BA2WfEti.js', 'browser-BKLM0ThC-CkSOgtCM.js']
const STAMP_LOCALES = ['zh-CN', 'en']
const STAMP_PUBLIC_MANIFEST = '/public/siyuan-sireader/embedpdf/stamps/{locale}/manifest.json'
const STAMP_SOURCE_MANIFEST = 'https://cdn.jsdelivr.net/npm/@embedpdf/default-stamps/{locale}/manifest.json'
let pdfWasmUrlPromise: Promise<string> | undefined
let pdfRuntimePromise: Promise<any> | undefined
let stampManifestsPromise: Promise<any[]> | undefined

const absoluteUrl = (path: string) => typeof location === 'undefined' ? path : new URL(path, location.origin).href
const dynamicImport = (url: string) => new Function('url', 'return import(url)')(url)

const publicReady = async (path: string) =>
  await fetch(absoluteUrl(path), { method: 'HEAD', cache: 'no-store' }).then(res => res.ok).catch(() => false)
const fetchBlob = async (url: string, error: string) => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(error)
  return res.blob()
}

export const ensureEmbedPdfWasmUrl = () =>
  pdfWasmUrlPromise ||= (async () => {
    const wasmUrl = absoluteUrl(PDF_WASM_PUBLIC_URL)
    if (!await publicReady(PDF_WASM_PUBLIC_URL)) {
      const { putFile } = await import('@/api')
      const blob = await fetchBlob(PDF_WASM_SOURCE_URL, 'PDFium wasm download failed')
      if (!blob.size) throw new Error('PDFium wasm is empty')
      await putFile(PDF_ASSET_DATA_DIR, true, new File([], ''))
      await putFile(PDF_WASM_DATA_PATH, false, new File([blob], 'pdfium.wasm', { type: 'application/wasm' }))
      if (!await publicReady(PDF_WASM_PUBLIC_URL)) throw new Error('PDFium wasm public cache is not readable')
    }
    return wasmUrl
  })().catch((error) => {
    pdfWasmUrlPromise = undefined
    throw error
  })

export const ensureEmbedPdfRuntime = () =>
  pdfRuntimePromise ||= (async () => {
    if (!await Promise.all(PDF_RUNTIME_FILES.map(file => publicReady(`${PDF_RUNTIME_PUBLIC_DIR}/${file}`))).then(items => items.every(Boolean))) {
      const { putFile } = await import('@/api')
      const files = await Promise.all(PDF_RUNTIME_FILES.map(async file => [file, await fetchBlob(`${PDF_RUNTIME_SOURCE_BASE}/${file}`, `EmbedPDF runtime download failed: ${file}`)] as const))
      await putFile(PDF_RUNTIME_DATA_DIR, true, new File([], ''))
      await Promise.all(files.map(([file, blob]) => putFile(`${PDF_RUNTIME_DATA_DIR}/${file}`, false, new File([blob], file, { type: 'text/javascript' }))))
    }
    return await dynamicImport(absoluteUrl(PDF_RUNTIME_PUBLIC_URL))
  })().catch((error) => {
    pdfRuntimePromise = undefined
    throw error
  })

export const initEmbedPdfViewer = async (target: HTMLElement, config: Record<string, any>) =>
  (await ensureEmbedPdfRuntime()).default.init({ type: 'container', target, ...config })

export const ensureEmbedPdfStampManifests = () =>
  stampManifestsPromise ||= (async () => {
    const { putFile } = await import('@/api')
    for (const locale of STAMP_LOCALES) {
      const dir = `${PDF_ASSET_DATA_DIR}/stamps/${locale}`
      const publicBase = `/public/siyuan-sireader/embedpdf/stamps/${locale}`
      if (await publicReady(`${publicBase}/manifest.json`) && await publicReady(`${publicBase}/stamps.pdf`)) continue
      const manifestUrl = STAMP_SOURCE_MANIFEST.replace('{locale}', locale)
      const manifestText = await fetch(manifestUrl, { cache: 'no-store' }).then(res => {
        if (!res.ok) throw new Error(`PDF stamp manifest download failed: ${locale}`)
        return res.text()
      })
      const pdfUrl = new URL(JSON.parse(manifestText).pdf || 'stamps.pdf', manifestUrl).href
      const pdfBlob = await fetchBlob(pdfUrl, `PDF stamp file download failed: ${locale}`)
      await putFile(dir, true, new File([], ''))
      await putFile(`${dir}/manifest.json`, false, new File([manifestText], 'manifest.json', { type: 'application/json' }))
      await putFile(`${dir}/stamps.pdf`, false, new File([pdfBlob], 'stamps.pdf', { type: 'application/pdf' }))
    }
    return [{ url: STAMP_PUBLIC_MANIFEST, fallbackLocale: 'en' }]
  })().catch((error) => {
    stampManifestsPromise = undefined
    throw error
  })

export const createEmbedPdfDocumentSource = async (documentId: string, source: File | Blob | string, fallbackName = 'document.pdf') => {
  const name = typeof source === 'string'
    ? source.split('/').pop()?.split('?')[0] || fallbackName
    : (source as File).name || fallbackName
  return typeof source === 'string'
    ? { documentId, url: source, name, autoActivate: true }
    : { documentId, buffer: await source.arrayBuffer(), name, autoActivate: true }
}

export const taskToPromise = <T>(task: any) => new Promise<T>((resolve, reject) => {
  if (!task?.wait) return resolve(task as T)
  task.wait(resolve, reject)
})

export const makePdfSelectionMark = (text: string, selection: any[] = []) => {
  const first = selection[0] || {}
  const page = Number(first.pageIndex ?? 0) + 1
  return {
    format: 'pdf',
    type: 'highlight',
    page,
    cfi: `#page-${page}`,
    chapter: `Page ${page}`,
    text: inlineLinkText(text),
    rects: first.segmentRects || (first.rect ? [first.rect] : []),
  }
}

export const getPdfSelectionMark = async (selectionScope: any) => {
  const lines = await taskToPromise<string[]>(selectionScope?.getSelectedText?.()).catch(() => [])
  const text = inlineLinkText((lines || []).join('\n'))
  return text ? makePdfSelectionMark(text, selectionScope?.getFormattedSelection?.() || []) : null
}

export const pdfAnnotationNote = (item: any) => item?.annotation?.custom?.note || item?.annotation?.contents || ''

export const pdfAnnotationText = (item: any) => inlineLinkText(item?.annotation?.custom?.text || '')

export const pdfAnnotationWithReplies = (annotation: any, annotations: any[] = []) => {
  const replies = annotations.filter(item => item?.inReplyToId === annotation.id && item.contents)
  const contents = [annotation.custom?.note || annotation.contents, ...replies.map(item => item.contents)].filter(Boolean).join('\n\n')
  return { annotation: { ...annotation, contents }, replies }
}

export const pdfMarkFromAnnotation = (annotation: any, annotations: any[] = []) => {
  const item = pdfAnnotationWithReplies(annotation, annotations)
  const page = Number(annotation.pageIndex || 0) + 1
  return { id: annotation.id, type: 'note', format: 'pdf', page, cfi: `#page-${page}`, chapter: `Page ${page}`, text: pdfAnnotationText(item), note: pdfAnnotationNote(item) }
}

export const pdfSelectionFromAnnotation = (annotation: any) => {
  const page = Number(annotation.pageIndex || 0) + 1
  return { text: pdfAnnotationText({ annotation }) || pdfAnnotationNote({ annotation }), page, cfi: `#page-${page}`, rects: annotation.segmentRects?.length ? annotation.segmentRects : [annotation.rect].filter(Boolean) }
}

export const sendPdfMarkToDoc = async (mark: any, docId: string, ctx: any) => {
  if (!LicenseManager.can('quick-send', await LicenseManager.getLicense())) return ctx.showMsg?.('快捷发送需要升级会员', 'info')
  return sendMarkToDoc(mark, docId, { ...ctx, isPdf: true })
}

export const writeBlobToClipboard = async (blob: Blob) => {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) throw new Error('当前环境不支持复制图片')
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
}

export const addMissingPdfMenuItemsAfterFirst = <T extends { id: string }>(items: T[] = [], additions: T[] = []) => {
  const ids = new Set(items.map(item => item.id))
  return [...items.slice(0, 1), ...additions.filter(item => !ids.has(item.id)), ...items.slice(1)]
}

export const bookmarkPage = (bookmark: any) => {
  const target = bookmark?.target
  const destination = target?.type === 'destination' ? target.destination : target?.action?.destination
  return Number.isFinite(destination?.pageIndex) ? destination.pageIndex + 1 : 0
}

export const bookmarkToc = (items: any[] = []): any[] =>
  items.map(item => ({
    label: item.title || 'Untitled',
    href: bookmarkPage(item) ? `#page-${bookmarkPage(item)}` : '',
    subitems: item.children?.length ? bookmarkToc(item.children) : undefined,
  }))
