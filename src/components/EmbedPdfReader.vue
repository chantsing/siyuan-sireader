<template>
  <div v-if="documentSource" ref="rootRef" class="embed-pdf-reader">
    <PDFViewer :config="config" @init="handleInit" @ready="handleReady" />
  </div>
  <div v-else class="embed-pdf-reader__loading">{{ props.i18n?.loading || 'Loading...' }}</div>
</template>

<script setup lang="ts">
import { computed, createApp, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { PDFViewer, type EmbedPdfContainer, type PluginRegistry } from '@embedpdf/vue-pdf-viewer'
import { Dialog, showMessage } from 'siyuan'
import { bookshelfManager } from '@/core/bookshelf'
import { migrateLegacyPdfAnnotationsToEmbedPdf, readEmbedPdfAnnotations, readEmbedPdfProgress, writeEmbedPdfAnnotations, writeEmbedPdfProgress } from '@/core/bookStore'
import { createTooltip, showTooltip } from '@/core/MarkManager'
import { copyMark } from '@/utils/copy'
import { buildEmbedPdfTheme, embedPdfThemePreference } from '@/utils/embedPdfTheme'
import { addMissingPdfMenuItemsAfterFirst, getPdfSelectionMark, pdfAnnotationNote, pdfAnnotationText, pdfAnnotationWithReplies, pdfMarkFromAnnotation, pdfSelectionFromAnnotation, sendPdfMarkToDoc, writeBlobToClipboard } from '@/utils/embedPdfActions'
import { type ReaderSettings, type ReadTheme } from '@/composables/useSetting'
import Translate from './Translate.vue'

const props = defineProps<{ source: File | string | null; settings?: ReaderSettings; theme?: string; customTheme?: ReadTheme; bookUrl?: string; i18n?: any }>()
const emit = defineEmits<{ ready: [registry: PluginRegistry] }>()
const documentSource = shallowRef<any>(null)
const rootRef = ref<HTMLElement | null>(null)
const documentId = 'sireader-document'
let annotationSaveTimer: any = null
let progressSaveTimer: any = null
let pendingProgress: { pageNumber: number; totalPages: number } | null = null
let activeRegistry: PluginRegistry | null = null
let activeContainer: EmbedPdfContainer | null = null
let activeAnnotationScope: any = null
let activeScrollScope: any = null
let pdfTooltip: HTMLElement | null = null
let pdfTooltipAnnotations: any[] = []
let currentPdfTooltipId = ''
let cleanupDocumentEvents: (() => void) | null = null
let cleanupAnnotationEvents: (() => void) | null = null
let cleanupScrollEvents: (() => void) | null = null
let cleanupCaptureEvents: (() => void) | null = null
let cleanupTooltipEvents: (() => void) | null = null
let themeObserver: MutationObserver | null = null
let copyNextCapture = false
let lastCaptureBlob: Blob | null = null

const PDF_PAGE_THEME_STYLE = `
  div[style*="transform-origin"][style*="background-color"]{background:var(--ep-background-app)!important}
  :host([data-sireader-page-mode="dark"]) img[src^="blob:"]{filter:invert(1) hue-rotate(180deg) brightness(.92) contrast(.92)}
`
const getCapability = <T = any>(registry: PluginRegistry, pluginId: string): T | null =>
  (registry.getPlugin(pluginId) as any)?.provides?.() || null
const pdfTheme = () => buildEmbedPdfTheme(props.theme, rootRef.value || undefined, props.customTheme)
const pdfThemePreference = () => embedPdfThemePreference(props.theme, rootRef.value || undefined)
const ensurePageThemeStyle = () => {
  const shadow = (activeContainer as any)?.shadowRoot as ShadowRoot | undefined
  if (!shadow || shadow.querySelector('style[data-sireader-page-theme]')) return
  const style = document.createElement('style')
  style.setAttribute('data-sireader-page-theme', '')
  style.textContent = PDF_PAGE_THEME_STYLE
  shadow.appendChild(style)
}
const applyPdfTheme = () => {
  activeContainer?.setTheme(pdfTheme())
  activeContainer?.setAttribute('data-sireader-page-mode', pdfThemePreference())
  ensurePageThemeStyle()
}
const escapeHtml = (text = '') => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ensurePdfTooltip = () => {
  if (pdfTooltip) return pdfTooltip
  pdfTooltip = document.createElement('div')
  pdfTooltip.setAttribute('data-pdf-note-tooltip', 'true')
  pdfTooltip.style.cssText = 'position:fixed;display:none;width:340px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12),0 4px 8px rgba(0,0,0,.08);z-index:99999;pointer-events:none;overflow:hidden;transition:transform .12s,opacity .12s'
  document.body.appendChild(pdfTooltip)
  return pdfTooltip
}
const hidePdfTooltip = () => {
  if (!pdfTooltip) return
  currentPdfTooltipId = ''
  pdfTooltip.style.opacity = '0'
  pdfTooltip.style.transform = 'translateY(-8px)'
  pdfTooltip.style.display = 'none'
}
const showPdfTooltip = (item: any, x: number, y: number) => {
  const tip = ensurePdfTooltip()
  const note = pdfAnnotationNote(item)
  if (currentPdfTooltipId !== item.annotation.id) {
    currentPdfTooltipId = item.annotation.id
    const text = pdfAnnotationText(item)
    const quote = text ? `<div style="padding:8px 14px;background:var(--b3-theme-background-light);border-bottom:1px solid var(--b3-border-color);font-size:12px;color:var(--b3-theme-on-surface-variant);font-style:italic;line-height:1.5">${escapeHtml(text)}</div>` : ''
    tip.innerHTML = createTooltip({ icon: '#iconEdit', iconColor: 'var(--b3-theme-primary)', title: props.i18n?.note || '笔记', content: `${quote}<div style="padding:14px;font-size:13px;line-height:1.7;max-height:300px;overflow-y:auto;word-break:break-word;white-space:pre-wrap">${escapeHtml(note)}</div>` })
  }
  showTooltip(tip, x + 12, y + 12)
}
const pdfShadowElementFromPoint = (x: number, y: number) =>
  rootRef.value?.querySelector('embedpdf-container')?.shadowRoot?.elementFromPoint(x, y) as HTMLElement | null
const pdfPointerElement = (x: number, y: number) => {
  let el = pdfShadowElementFromPoint(x, y)
  for (; el; el = el.parentElement) if (getComputedStyle(el).cursor === 'pointer') return el
  return null
}
const pdfViewportElement = (x: number, y: number) => {
  let el = pdfShadowElementFromPoint(x, y)
  for (; el; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) return el
  }
  return null
}
const pdfAnnotationFromPoint = (x: number, y: number) => {
  const pointer = pdfPointerElement(x, y)
  const viewport = pointer && pdfViewportElement(x, y)
  if (!viewport || !activeScrollScope?.getRectPositionForPage) return null
  const box = viewport.getBoundingClientRect()
  const style = getComputedStyle(viewport)
  const offsetX = box.left + (Number.parseFloat(style.paddingLeft) || 0) - viewport.scrollLeft
  const offsetY = box.top + (Number.parseFloat(style.paddingTop) || 0) - viewport.scrollTop
  const target = pointer.getBoundingClientRect()
  let best: { item: any; overlap: number } | null = null
  for (const annotation of pdfTooltipAnnotations) {
    const item = pdfAnnotationWithReplies(annotation, pdfTooltipAnnotations)
    if (!pdfAnnotationNote(item)) continue
    for (const rect of (annotation.segmentRects?.length ? annotation.segmentRects : [annotation.rect]).filter(Boolean)) {
      const pos = activeScrollScope.getRectPositionForPage(annotation.pageIndex, rect)
      if (!pos) continue
      const left = offsetX + pos.origin.x
      const top = offsetY + pos.origin.y
      const overlap = Math.max(0, Math.min(left + pos.size.width, target.right) - Math.max(left, target.left))
        * Math.max(0, Math.min(top + pos.size.height, target.bottom) - Math.max(top, target.top))
      if (overlap && (!best || overlap > best.overlap)) best = { item, overlap }
    }
  }
  return best?.item || null
}
const refreshPdfTooltipAnnotations = () => {
  pdfTooltipAnnotations = activeAnnotationScope?.getAnnotations?.().map((item: any) => item.object).filter(Boolean) || []
}
const selectedPdfAnnotation = () => activeAnnotationScope?.getSelectedAnnotation?.()?.object
const selectedPdfText = (annotation = selectedPdfAnnotation()) => annotation ? pdfSelectionFromAnnotation(annotation).text : ''
const quickDocs = () => ((props.settings ? props.settings.quickSendDocs : (window as any).__sireader_settings?.quickSendDocs) || []).filter((doc: any) => doc?.id).slice(0, 5)
const sendPdfMark = async (mark: any, docId: string, registry: PluginRegistry) => {
  await sendPdfMarkToDoc(mark, docId, {
    bookUrl: props.bookUrl || '',
    marks: { updateMark: updateSelectedPdfBlockId(registry) },
    showMsg: (msg: string, type?: string) => showMessage(msg, 1500, type as any),
    i18n: props.i18n,
  })
}
const updateSelectedPdfBlockId = (registry: PluginRegistry) => async (item: any, blockId: string) => {
  const annotation = item?.annotation || selectedPdfAnnotation()
  if (!annotation || !activeAnnotationScope?.updateAnnotation) return
  const custom = { ...(annotation.custom || {}), blockId }
  await activeAnnotationScope.updateAnnotation(annotation.pageIndex, annotation.id, { custom })
  queueAnnotationSave(registry)
}
const queueCaptureCopyButton = () => {
  const shadow = rootRef.value?.querySelector('embedpdf-container')?.shadowRoot
  if (!shadow) return
  const add = () => {
    if (shadow.querySelector('[data-sireader-copy-capture]')) return true
    const buttons = Array.from(shadow.querySelectorAll('button')) as HTMLButtonElement[]
    const download = buttons.find(button => /download|下载/i.test(button.textContent || ''))
    const footer = download?.parentElement
    if (!download || !footer) return false
    const copy = download.cloneNode(true) as HTMLButtonElement
    copy.dataset.sireaderCopyCapture = 'true'
    copy.textContent = props.i18n?.copy || '复制'
    copy.onclick = event => {
      event.preventDefault()
      event.stopPropagation()
      lastCaptureBlob && void copyCaptureBlob(lastCaptureBlob).catch((error: any) => showMessage(error?.message || '复制失败', 2000, 'error'))
    }
    footer.insertBefore(copy, download)
    return true
  }
  if (add()) return
  const observer = new MutationObserver(() => add() && observer.disconnect())
  observer.observe(shadow, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), 3000)
}
const copyCaptureBlob = async (blob: Blob) => {
  await writeBlobToClipboard(blob)
  showMessage(props.i18n?.copied || '已复制', 1200)
}
const openPdfTranslate = (text: string) => {
  text = text.trim()
  if (!text) return showMessage(props.i18n?.noContent || '无内容', 1200)
  let app: any
  const dialog = new Dialog({
    title: props.i18n?.translate || '翻译',
    content: '<div class="b3-dialog__content sireader-pdf-translate" style="height:100%;overflow:auto;padding:16px"></div>',
    width: '520px',
    height: '520px',
    destroyCallback: () => app?.unmount(),
  })
  app = createApp(Translate, { text })
  app.mount(dialog.element.querySelector('.sireader-pdf-translate') as HTMLElement)
}
const openPdfQuickSendMenu = (type: 'selection' | 'annotation', registry: PluginRegistry) => {
  const menuId = `sireader-pdf-send-${type}`
  const commandId = `sireader:send-${type}-menu`
  getCapability<any>(registry, 'ui')?.forDocument(documentId)?.openMenu?.(menuId, commandId, commandId)
}
const setupPdfCommands = (registry: PluginRegistry) => {
  const commands = getCapability<any>(registry, 'commands')
  const ui = getCapability<any>(registry, 'ui')
  const docs = quickDocs()
  commands?.registerCommand?.({
    id: 'sireader:copy-annotation-link',
    label: '复制回链',
    icon: 'copy',
    categories: ['annotation', 'sireader-copy-link'],
    action: () => {
      const selected = selectedPdfAnnotation()
      if (!selected) return
      void copyMark(pdfMarkFromAnnotation(selected, pdfTooltipAnnotations), { bookUrl: props.bookUrl || '', isPdf: true, showMsg: (msg: string, type?: string) => showMessage(msg, 1500, type as any) })
    },
    visible: () => !!selectedPdfAnnotation(),
  })
  commands?.registerCommand?.({
    id: 'sireader:dict-annotation',
    label: props.i18n?.dict || '词典',
    icon: 'book',
    categories: ['annotation', 'sireader'],
    action: async () => {
      const selected = selectedPdfAnnotation()
      if (!selected) return
      const selection = pdfSelectionFromAnnotation(selected)
      if (selection.text) (await import('@/utils/dictionary')).openDict(selection.text, innerWidth / 2, innerHeight / 2, selection)
    },
    visible: () => !!selectedPdfAnnotation(),
    disabled: () => !selectedPdfText(),
  })
  commands?.registerCommand?.({
    id: 'sireader:translate-annotation',
    label: props.i18n?.translate || '翻译',
    icon: 'text',
    categories: ['annotation', 'sireader'],
    action: () => openPdfTranslate(selectedPdfText()),
    visible: () => !!selectedPdfAnnotation(),
    disabled: () => !selectedPdfText(),
  })
  commands?.registerCommand?.({
    id: 'sireader:send-selection-menu',
    label: props.i18n?.sendTo || 'Send to',
    icon: 'fileImport',
    categories: ['selection', 'sireader-send'],
    action: () => openPdfQuickSendMenu('selection', registry),
  })
  docs.forEach((doc: any, index: number) => commands?.registerCommand?.({
    id: `sireader:send-selection:${index}`,
    label: doc.name || props.i18n?.sendTo || 'Send to',
    icon: 'fileImport',
    categories: ['selection', 'sireader-send'],
    action: async () => {
      const mark = await getPdfSelectionMark(getCapability<any>(registry, 'selection')?.forDocument(documentId))
      if (mark) await sendPdfMark(mark, doc.id, registry)
      getCapability<any>(registry, 'selection')?.forDocument(documentId)?.clear?.()
      getCapability<any>(registry, 'ui')?.forDocument(documentId)?.closeMenu?.('sireader-pdf-send-selection')
    },
  }))
  commands?.registerCommand?.({
    id: 'sireader:send-annotation-menu',
    label: props.i18n?.sendTo || 'Send to',
    icon: 'fileImport',
    categories: ['annotation', 'sireader-send'],
    action: () => openPdfQuickSendMenu('annotation', registry),
  })
  docs.forEach((doc: any, index: number) => commands?.registerCommand?.({
    id: `sireader:send-annotation:${index}`,
    label: doc.name || props.i18n?.sendTo || 'Send to',
    icon: 'fileImport',
    categories: ['annotation', 'sireader-send'],
    action: async () => {
      const selected = selectedPdfAnnotation()
      if (selected) await sendPdfMark(pdfMarkFromAnnotation(selected, pdfTooltipAnnotations), doc.id, registry)
      getCapability<any>(registry, 'ui')?.forDocument(documentId)?.closeMenu?.('sireader-pdf-send-annotation')
    },
  }))
  commands?.registerCommand?.({
    id: 'sireader:capture-copy',
    label: props.i18n?.copy || '复制截图',
    icon: 'copy',
    categories: ['document', 'document-capture', 'sireader-capture-copy'],
    action: () => {
      copyNextCapture = true
      window.dispatchEvent(new Event('sireader:close-reader-panels'))
      getCapability<any>(registry, 'capture')?.forDocument(documentId)?.toggleMarqueeCapture?.()
      showMessage(props.i18n?.capture || '拖选截图区域', 1500)
    },
  })
  const schema = ui?.getSchema?.()
  const annotationMenu = schema?.selectionMenus?.annotation
  const selectionMenu = schema?.selectionMenus?.selection
  const documentMenu = schema?.menus?.document
  if (!annotationMenu && !selectionMenu && !documentMenu) return
  if (annotationMenu) {
    const items = annotationMenu.items.filter((item: any) => !['sireader-send-annotation-list', 'sireader-send-annotation-divider', 'sireader-send-annotation-menu'].includes(item.id))
    annotationMenu.items = addMissingPdfMenuItemsAfterFirst(items, [
      { type: 'command-button', id: 'sireader-copy-annotation-link', commandId: 'sireader:copy-annotation-link', variant: 'icon', categories: ['annotation', 'sireader-copy-link'] },
      { type: 'command-button', id: 'sireader-dict-annotation', commandId: 'sireader:dict-annotation', variant: 'icon', categories: ['annotation', 'sireader'] },
      { type: 'command-button', id: 'sireader-translate-annotation', commandId: 'sireader:translate-annotation', variant: 'icon', categories: ['annotation', 'sireader'] },
      ...(docs.length ? [
        { type: 'divider', id: 'sireader-send-annotation-divider', categories: ['annotation', 'sireader-send'] },
        { type: 'command-button', id: 'sireader-send-annotation-menu', commandId: 'sireader:send-annotation-menu', variant: 'icon-text', categories: ['annotation', 'sireader-send'] },
      ] : []),
    ] as any)
  }
  if (selectionMenu) {
    const items = selectionMenu.items.filter((item: any) => !['sireader-send-selection-list', 'sireader-send-selection-divider', 'sireader-send-selection-menu'].includes(item.id))
    selectionMenu.items = docs.length
      ? addMissingPdfMenuItemsAfterFirst(items, [
        { type: 'divider', id: 'sireader-send-selection-divider', categories: ['selection', 'sireader-send'] },
        { type: 'command-button', id: 'sireader-send-selection-menu', commandId: 'sireader:send-selection-menu', variant: 'icon-text', categories: ['selection', 'sireader-send'] },
      ] as any)
      : items
  }
  const sendMenu = (type: 'selection' | 'annotation') => ({
    id: `sireader-pdf-send-${type}`,
    items: docs.map((_doc: any, index: number) => ({ type: 'command', id: `sireader-send-${type}-${index}`, commandId: `sireader:send-${type}:${index}`, categories: [type, 'sireader-send'] })),
    categories: [type, 'sireader-send'],
  })
  const sendMenus = { 'sireader-pdf-send-annotation': sendMenu('annotation'), 'sireader-pdf-send-selection': sendMenu('selection') }
  ui.mergeSchema?.({
    menus: documentMenu ? {
      ...schema.menus,
      ...sendMenus,
      document: documentMenu.items?.some((item: any) => item.id === 'sireader-capture-copy') ? documentMenu : {
        ...documentMenu,
        items: [...documentMenu.items, { type: 'command', id: 'sireader-capture-copy', commandId: 'sireader:capture-copy', categories: ['document', 'document-capture'] }],
      },
    } : { ...schema.menus, ...sendMenus },
  })
}
const setupPdfCapture = (registry: PluginRegistry) => {
  cleanupCaptureEvents?.()
  const capture = getCapability<any>(registry, 'capture')?.forDocument(documentId)
  const offArea = capture?.onCaptureArea?.(({ blob }: any) => {
    lastCaptureBlob = blob
    queueCaptureCopyButton()
    if (!copyNextCapture) return
    copyNextCapture = false
    void copyCaptureBlob(blob).catch((error: any) => showMessage(error?.message || '复制失败', 2000, 'error'))
  })
  const offState = capture?.onStateChange?.((state: any) => {
    if (state?.isMarqueeCaptureActive) window.dispatchEvent(new Event('sireader:close-reader-panels'))
  })
  cleanupCaptureEvents = () => { offArea?.(); offState?.() }
}
const setupPdfTooltip = () => {
  cleanupTooltipEvents?.()
  const root = rootRef.value
  if (!root) return
  const onMove = (event: PointerEvent) => {
    if (!root.contains(event.target as Node | null)) return
    const { clientX: x, clientY: y } = event
    const item = pdfAnnotationFromPoint(x, y)
    item ? showPdfTooltip(item, x, y) : hidePdfTooltip()
  }
  root.addEventListener('pointermove', onMove, true)
  root.addEventListener('mouseleave', hidePdfTooltip, true)
  document.addEventListener('pointerdown', hidePdfTooltip, true)
  refreshPdfTooltipAnnotations()
  cleanupTooltipEvents = () => {
    root.removeEventListener('pointermove', onMove, true)
    root.removeEventListener('mouseleave', hidePdfTooltip, true)
    document.removeEventListener('pointerdown', hidePdfTooltip, true)
  }
}

const saveAnnotations = async (registry: PluginRegistry) => {
  if (!props.bookUrl) return
  const annotation = getCapability<any>(registry, 'annotation')?.forDocument(documentId)
  if (!annotation?.exportAnnotations) return
  const items = await annotation.exportAnnotations().toPromise().catch(() => null)
  if (!items) return
  await writeEmbedPdfAnnotations(props.bookUrl, items)
  window.dispatchEvent(new Event('sireader:marks-updated'))
}

const queueAnnotationSave = (registry: PluginRegistry) => {
  clearTimeout(annotationSaveTimer)
  annotationSaveTimer = setTimeout(() => {
    annotationSaveTimer = null
    void saveAnnotations(registry)
  }, 600)
}

const toProgress = (page: { pageNumber: number; totalPages: number }) => ({ ...page, updatedAt: Date.now() })

const saveProgress = async (page: { pageNumber: number; totalPages: number }) => {
  if (!props.bookUrl) return
  const progress = toProgress(page)
  await writeEmbedPdfProgress(props.bookUrl, progress)
  const percent = progress.totalPages ? Math.round(progress.pageNumber / progress.totalPages * 100) : 0
  await bookshelfManager.updateProgress(props.bookUrl, percent, progress.pageNumber, `#page-${progress.pageNumber}`)
}

const queueProgressSave = (page: { pageNumber: number; totalPages: number }) => {
  pendingProgress = page
  clearTimeout(progressSaveTimer)
  progressSaveTimer = setTimeout(() => {
    progressSaveTimer = null
    pendingProgress = null
    void saveProgress(page)
  }, 600)
}

const handleInit = (container: EmbedPdfContainer) => {
  activeContainer = container
  applyPdfTheme()
}

const handleReady = async (registry: PluginRegistry) => {
  activeRegistry = registry
  emit('ready', registry)
  cleanupDocumentEvents?.()
  cleanupAnnotationEvents?.()
  cleanupScrollEvents?.()
  cleanupDocumentEvents = cleanupAnnotationEvents = cleanupScrollEvents = null
  const scroll = getCapability<any>(registry, 'scroll')
  if (props.bookUrl && scroll?.forDocument) {
    let restored = false
    const savedProgress = readEmbedPdfProgress(props.bookUrl).catch(() => null)
    const restore = async () => {
      if (restored) return
      const saved = await savedProgress
      if (!saved?.pageNumber) return
      restored = true
      scroll.forDocument(documentId).scrollToPage({
        pageNumber: saved.pageNumber,
        pageCoordinates: saved.pageCoordinates,
        behavior: 'instant',
        alignX: 0,
        alignY: 0,
      })
    }
    const offPage = scroll.onPageChange?.((event: any) => {
      if (event.documentId === documentId) queueProgressSave({ pageNumber: event.pageNumber, totalPages: event.totalPages })
    })
    const offLayout = scroll.onLayoutReady?.((event: any) => {
      if (event.documentId === documentId && event.isInitial) void restore()
    })
    cleanupScrollEvents = () => { offPage?.(); offLayout?.() }
  }
  const documents = getCapability<any>(registry, 'document-manager')
  activeAnnotationScope = getCapability<any>(registry, 'annotation')?.forDocument(documentId) || null
  activeScrollScope = scroll?.forDocument?.(documentId) || null
  setupPdfCommands(registry)
  setupPdfCapture(registry)
  let annotationsLoaded = false
  const loadAnnotations = async () => {
    if (annotationsLoaded) return
    annotationsLoaded = true
    const annotation = activeAnnotationScope
    if (!props.bookUrl || !annotation?.importAnnotations) return
    const migrated = await migrateLegacyPdfAnnotationsToEmbedPdf(props.bookUrl).catch(() => null)
    if (migrated?.length) showMessage((props.i18n?.pdfMigrated || 'Migrated {count} PDF annotations').replace('{count}', migrated.length), 1800, 'info')
    const stored = await readEmbedPdfAnnotations(props.bookUrl).catch(() => null)
    if (stored?.length) annotation.importAnnotations(stored)
    window.dispatchEvent(new Event('sireader:marks-updated'))
    refreshPdfTooltipAnnotations()
    const offEvent = annotation.onAnnotationEvent?.(() => { queueAnnotationSave(registry); refreshPdfTooltipAnnotations() })
    const offState = annotation.onStateChange?.(refreshPdfTooltipAnnotations)
    cleanupAnnotationEvents = () => { offEvent?.(); offState?.() }
  }
  const offOpen = documents?.onDocumentOpened?.((state: any) => {
    if (state.id === documentId) void loadAnnotations()
  })
  const offError = documents?.onDocumentError?.((event: any) => {
    if (event.documentId === documentId) showMessage(event.message || props.i18n?.loadFailed || 'PDF load failed', 3000, 'error')
  })
  cleanupDocumentEvents = () => { offOpen?.(); offError?.() }
  if (documents?.getDocumentState(documentId)?.status === 'loaded') void loadAnnotations()
  ensurePageThemeStyle()
  void nextTick(setupPdfTooltip)
}

let sourceToken = 0
watch(() => props.source, async (source) => {
  const token = ++sourceToken
  documentSource.value = null
  if (!source) return
  if (typeof source === 'string') {
    const res = await fetch(source)
    const buffer = await res.arrayBuffer()
    if (token !== sourceToken) return
    documentSource.value = { documentId, buffer, name: source.split('/').pop()?.split('?')[0] || 'document.pdf', autoActivate: true }
  } else {
    const buffer = await source.arrayBuffer()
    if (token !== sourceToken) return
    documentSource.value = { documentId, buffer, name: source.name || 'document.pdf', autoActivate: true }
  }
}, { immediate: true })

const config = computed(() => ({
  tabBar: 'never',
  worker: false,
  wasmUrl: '/plugins/siyuan-sireader/assets/pdfium.wasm',
  documentManager: {
    initialDocuments: [documentSource.value],
  },
  fontFallback: null,
  fonts: { ui: null, signature: null },
  stamp: { manifests: [{ url: '/plugins/siyuan-sireader/assets/default-stamps/{locale}/manifest.json', fallbackLocale: 'zh-CN' }] },
  permissions: { enforceDocumentPermissions: true },
  capture: { imageType: 'image/png', scale: 2, withAnnotations: true },
  i18n: {
    defaultLocale: 'zh-CN',
    fallbackLocale: 'en',
  },
  theme: pdfTheme(),
}))

watch(() => [props.theme, props.customTheme], () => nextTick(applyPdfTheme), { deep: true })
watch(() => props.settings?.quickSendDocs, () => activeRegistry && setupPdfCommands(activeRegistry), { deep: true })
themeObserver = new MutationObserver(() => requestAnimationFrame(applyPdfTheme))
;[document.documentElement, document.body].forEach(el => themeObserver?.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'data-theme-mode'] }))

onBeforeUnmount(() => {
  if (annotationSaveTimer && activeRegistry) {
    clearTimeout(annotationSaveTimer)
    void saveAnnotations(activeRegistry)
  }
  if (progressSaveTimer && pendingProgress) {
    clearTimeout(progressSaveTimer)
    void saveProgress(pendingProgress)
  }
  cleanupAnnotationEvents?.()
  cleanupDocumentEvents?.()
  cleanupScrollEvents?.()
  cleanupCaptureEvents?.()
  cleanupTooltipEvents?.()
  themeObserver?.disconnect()
  activeAnnotationScope = null
  activeScrollScope = null
  activeContainer = null
  pdfTooltip?.remove()
  pdfTooltip = null
})
</script>

<style scoped>
.embed-pdf-reader{width:100%;height:100%;display:block;background:var(--b3-theme-background)}
.embed-pdf-reader :deep(> *){width:100%;height:100%}
.embed-pdf-reader__loading{height:100%;display:flex;align-items:center;justify-content:center;color:var(--b3-theme-on-surface)}
</style>
