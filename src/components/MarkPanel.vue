<template>
  <Teleport to="body">
    <div v-if="state.showMenu || state.showCard || state.showSendMenu" class="mark-overlay" @click="closeAll" />

    <div v-if="state.showMenu" class="mark-menu" :style="menuPosition" @click.stop>
      <button @click="openSelectionEditor" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.note || '笔记'"><svg><use xlink:href="#lucide-square-pen" /></svg></button>
      <button @click="() => handleCopy()" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.mark || '标注'"><svg><use xlink:href="#iconMark" /></svg></button>
      <button @click="toggleSendMenu" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.sendTo || '发送到'"><svg><use xlink:href="#lucide-send" /></svg></button>
      <button @click="handleCopyText" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.copy || '复制'"><svg><use xlink:href="#iconCopy" /></svg></button>
      <button v-if="props.ttsConfig?.enabled" @click="handleSpeak" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.ttsPlay || '朗读'"><svg><use xlink:href="#iconPlay" /></svg></button>
      <button @click="handleDict" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.dict || '词典'"><svg><use xlink:href="#iconLanguage" /></svg></button>
      <button @click="handleTranslate" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.translate || '翻译'"><svg><use xlink:href="#iconTranslate" /></svg></button>
    </div>

    <!-- 发送到文档菜单 -->
    <div v-if="state.showSendMenu" class="mark-menu send-menu" :style="sendMenuPosition" @click.stop>
      <button v-for="doc in quickDocs" :key="doc.id" class="send-item" @click="() => handleSendToDoc(doc.id)">{{ doc.name }}</button>
      <input v-model="sendSearch" class="b3-text-field send-input" :placeholder="i18n?.searchDocPlaceholder || '搜索文档...'" @input="searchSendDocs" />
      <div v-if="!sendDocs.length" class="send-empty">{{ sendSearch ? '无结果' : '输入关键词搜索' }}</div>
      <button v-for="doc in sendDocs" :key="doc.id" class="send-item" @click="() => handleSendToDoc(doc.path?.split('/').pop()?.replace('.sy', '') || doc.id)">{{ doc.hPath || doc.content || '无标题' }}</button>
    </div>

    <Translate :show="state.showTranslate" :text="state.selection?.text || ''" :x="state.x" :y="state.y" @close="state.showTranslate = false" />

    <div v-if="state.showCard" v-motion :initial="{ opacity: 0, y: 5 }" :enter="{ opacity: 1, y: 0 }" class="sr-card sr-popup sr-popup-panel" :style="cardPosition" @click.stop>
      <div class="sr-main" :style="{ borderLeftColor: currentColor }">
        <template v-if="!state.isEditing">
          <div class="sr-title" @click="goToMark">{{ state.text || '无内容' }}</div>
          <div v-if="state.note" class="sr-note" @click.stop="handleEdit">{{ state.note }}</div>
          <div class="sr-btns">
            <button @click.stop="handleCopyMark" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n?.copy || '复制'"><svg><use xlink:href="#iconCopy" /></svg></button>
            <button @click.stop="handleEdit" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n?.edit || '编辑'"><svg><use xlink:href="#iconEdit" /></svg></button>
            <button v-if="state.currentMark?.blockId" @click.stop="handleOpenBlock" @mouseenter="handleShowFloat" @mouseleave="hideFloat" class="b3-tooltips b3-tooltips__nw" aria-label="打开块"><svg><use xlink:href="#iconRef" /></svg></button>
            <button v-else @click.stop="handleImport" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n?.import || '导入'"><svg><use xlink:href="#iconDownload" /></svg></button>
            <button @click.stop="handleDelete" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n?.delete || '删除'"><svg><use xlink:href="#iconTrashcan" /></svg></button>
          </div>
        </template>

        <template v-else>
          <div class="sr-title">{{ state.text }}</div>
          <textarea
            v-if="isTextboxMark"
            ref="noteRef"
            v-model="state.text"
            class="sr-note-input"
            placeholder="输入文本框内容..."
          />
          <textarea
            v-else
            ref="noteRef"
            v-model="state.note"
            class="sr-note-input"
            placeholder="添加笔记..."
          />
          <div class="sr-options">
            <div class="sr-colors">
              <button v-for="c in colorOptions" :key="c.key" class="sr-color-btn" :class="{ active: state.color === c.value }" :style="{ background: c.bg }" @click.stop="state.color = c.value" />
            </div>
            <div v-if="isShapeMark" class="sr-styles">
              <button v-for="s in SHAPES" :key="s.type" class="sr-style-btn" :class="{ active: state.shapeType === s.type }" :title="s.label" @click.stop="state.shapeType = s.type"><svg><use :xlink:href="s.icon" /></svg></button>
              <span class="toolbar-divider" />
              <button v-if="!isTextboxMark" class="sr-style-btn" :class="{ active: state.shapeFilled }" title="填充" @click.stop="state.shapeFilled = !state.shapeFilled"><svg><use xlink:href="#lucide-paint-bucket" /></svg></button>
            </div>
            <div v-else-if="!isInkMark" class="sr-styles">
              <button v-for="s in STYLES" v-show="(!s.pdfOnly && !s.epubOnly) || (s.pdfOnly && isPdf) || (s.epubOnly && !isPdf)" :key="s.type" class="sr-style-btn" :class="{ active: state.style === s.type }" @click.stop="state.style = s.type">
                <span class="sr-style-icon" :data-type="s.type">{{ s.text }}</span>
              </button>
            </div>
          </div>
          <div class="sr-actions">
            <button @click.stop="handleCopyMark" class="sr-btn-secondary">复制</button>
            <button @click.stop="handleSave" class="sr-btn-primary">保存</button>
            <button @click.stop="handleCancel" class="sr-btn-secondary">取消</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { showMessage } from 'siyuan'
import type { HighlightColor, Mark, MarkManager } from '@/core/MarkManager'
import { COLORS, STYLES, getColorMap } from '@/core/MarkManager'
import { PDF_SHAPE_COLORS, PDF_SHAPE_OPTIONS } from '@/core/pdf/shape'
import { hideFloat, openBlock, showFloat } from '@/utils/copy'
import { jump } from '@/utils/jump'
import Translate from './Translate.vue'

interface MarkSelection {
  text: string
  location: { format: 'pdf' | 'epub'; cfi?: string; section?: number; page?: number; rects?: any[] }
}

const props = defineProps<{
  manager: MarkManager | null
  i18n?: Record<string, string>
  pdfViewer?: any
  reader?: any
  currentView?: any
  ttsController?: any
  ttsConfig?: any
  quickMarkMode?: boolean
  quickMarkColor?: HighlightColor
  quickMarkStyle?: 'highlight' | 'underline' | 'outline' | 'dotted' | 'dashed' | 'double' | 'squiggly'
  can?: any
  showUpgrade?: any
}>()

const emit = defineEmits<{
  copy: [text: string, selection: any]
  dict: [text: string, x: number, y: number, selection: any]
  copyMark: [mark: Mark]
}>()

const SHAPES = PDF_SHAPE_OPTIONS
const colors = getColorMap()
const shapeColors = PDF_SHAPE_COLORS
const noteRef = ref<HTMLTextAreaElement>()
const sendSearch = ref('')
const sendDocs = ref<any[]>([])
let quickMarkCooldown = false

const state = reactive({
  showMenu: false,
  showCard: false,
  showTranslate: false,
  showSendMenu: false,
  isEditing: false,
  x: 0,
  y: 0,
  selection: null as MarkSelection | null,
  currentMark: null as Mark | null,
  text: '',
  note: '',
  color: 'yellow' as HighlightColor,
  style: 'highlight' as 'highlight' | 'underline' | 'outline' | 'dotted' | 'dashed' | 'double' | 'squiggly',
  shapeType: 'rect' as 'rect' | 'circle' | 'triangle' | 'textbox',
  shapeFilled: false,
})

const selectionPos = computed(() => state.selection?.location?.cfi || state.selection?.location?.page || state.selection?.location?.section)
const isPdf = computed(() => (state.selection?.location.format || state.currentMark?.format) === 'pdf')
const isShapeMark = computed(() => state.currentMark?.type === 'shape')
const isInkMark = computed(() => state.currentMark?.type === 'ink')
const isTextboxMark = computed(() => isShapeMark.value && state.shapeType === 'textbox')
const quickDocs = computed(() => (window as any).__sireader_settings?.quickSendDocs || [])
const currentColor = computed(() => state.currentMark?.type === 'shape' || state.currentMark?.type === 'ink' || state.color.startsWith('#') ? state.color : colors[state.color] || '#ffeb3b')
const colorOptions = computed(() => (state.currentMark?.type === 'shape' || state.currentMark?.type === 'ink')
  ? shapeColors.map(color => ({ key: color, value: color, bg: color }))
  : COLORS.map(color => ({ key: color.color, value: color.color, bg: color.bg })))

const clampPos = (x: number, y: number, w: number, h: number) => {
  const rect = document.querySelector('.reader-container')?.getBoundingClientRect()
  const box = rect
    ? { left: rect.left + 16, right: rect.right - 16, top: rect.top + 16, bottom: rect.bottom - 16 }
    : { left: 16, right: innerWidth - 16, top: 16, bottom: innerHeight - 16 }
  const pad = 10
  return {
    x: Math.max(box.left + w / 2 + pad, Math.min(x, box.right - w / 2 - pad)),
    y: y + h + pad * 2 > box.bottom ? Math.max(box.top + pad * 2, y - h - pad) : y + pad,
  }
}
const menuPosition = computed(() => {
  const { x, y } = clampPos(state.x, state.y, 240, 50)
  return { left: `${x}px`, top: `${y}px`, transform: 'translate(-50%,0)' }
})
const cardPosition = computed(() => {
  const { x, y } = clampPos(state.x, state.y, 340, state.isEditing ? 420 : 180)
  return { left: `${x}px`, top: `${y}px`, transform: 'translate(-50%,0)' }
})
const sendMenuPosition = computed(() => {
  const quickHeight = quickDocs.value.length * 40
  const searchHeight = sendDocs.value.length ? Math.min(sendDocs.value.length, 5) * 40 : 60
  const { x, y } = clampPos(state.x, state.y + 60, 280, quickHeight + searchHeight + 40)
  return { left: `${x}px`, top: `${y}px`, transform: 'translate(-50%,0)' }
})

const markText = (mark: any) => mark.text || (mark.type === 'shape' ? (mark.shapeType === 'textbox' ? '' : '形状标注') : mark.type === 'ink' ? '墨迹标注' : '')
const markData = (mark: any, extra: Record<string, any> = {}) => ({
  currentMark: mark,
  text: markText(mark),
  note: mark.note || '',
  color: mark.color || (mark.type === 'ink' ? '#ff0000' : 'yellow'),
  style: mark.style || 'highlight',
  shapeType: mark.shapeType || 'rect',
  shapeFilled: mark.shapeType === 'textbox' ? false : !!mark.filled,
  ...extra,
})
const selectionArgs = () => {
  const loc = state.selection?.location
  return selectionPos.value && loc ? [selectionPos.value, state.text.trim(), state.color, state.style, loc.rects, (loc as any).textOffset] as const : null
}
const addSelectionMark = async (text: string, color: HighlightColor, style: typeof state.style) => {
  const args = selectionArgs()
  return args && props.manager ? await props.manager.addHighlight(args[0], text.trim(), color, style, args[4], args[5]) : null
}
const focusNote = () => nextTick(() => {
  noteRef.value?.focus()
  noteRef.value?.setSelectionRange?.(noteRef.value.value.length, noteRef.value.value.length)
})
const hideMenus = () => {
  state.showMenu = false
  state.showSendMenu = false
}
const openCard = (extra: Record<string, any>) => Object.assign(state, { showCard: true, showMenu: false, showSendMenu: false, ...extra })
const openSelectionEditor = () => {
  if (!state.selection) return
  openCard({ currentMark: null, text: state.selection.text, note: '', isEditing: true })
  focusNote()
}
const closeAll = () => {
  props.ttsController?.cancelLoop()
  sendSearch.value = ''
  sendDocs.value = []
  Object.assign(state, { showMenu: false, showCard: false, showTranslate: false, showSendMenu: false, isEditing: false, selection: null, currentMark: null })
}

const openSelectionPanel = async (selection: MarkSelection, x: number, y: number) => {
  Object.assign(state, { selection, x, y })
  if (props.quickMarkMode) return await handleCopy(props.quickMarkColor, props.quickMarkStyle)
  Object.assign(state, { showMenu: true, showCard: false, showSendMenu: false, currentMark: null, isEditing: false, text: selection.text, note: '' })
}
const openMarkPanel = (mark: Mark, x: number, y: number, edit = false) => {
  openCard({ ...markData(mark, { x, y, isEditing: edit }) })
  if (edit) focusNote()
}

const showShapeCard = (shape: any, pdfViewer: any) => {
  if (quickMarkCooldown) return
  const layer = document.querySelector(`.pdf-shape-layer[data-page="${shape.page}"]`) as HTMLElement | null
  const page = pdfViewer?.getPages?.().get(shape.page)
  if (!layer || !page) return
  const viewport = page.getViewport({ scale: pdfViewer.getScale(), rotation: pdfViewer.getRotation() })
  const [x1, y1, x2, y2] = shape.rect
  const p1 = viewport.convertToViewportRectangle([x1, y1, x1, y1])
  const p2 = viewport.convertToViewportRectangle([x2, y2, x2, y2])
  const rect = layer.getBoundingClientRect()
  openMarkPanel(shape, rect.left + (p1[0] + p2[0]) / 2, rect.top + Math.max(p1[1], p2[1]) + 10)
}
const showAnnotationCard = (mark: any) => {
  if (quickMarkCooldown) return
  const el = document.querySelector(`[data-id="${mark.id}"]`) as HTMLElement | null
  if (!el) return
  const rect = el.getBoundingClientRect()
  openMarkPanel(mark, rect.left + rect.width / 2, rect.bottom)
}

const getCoords = (rect: DOMRect, doc: Document) => {
  const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
  if (!iframe) return { x: rect.left, y: rect.top }
  const box = iframe.getBoundingClientRect()
  return { x: (rect.left > box.width ? rect.left % box.width : rect.left) + box.left, y: rect.top + box.top }
}
const checkSelection = (doc?: Document, e?: MouseEvent) => {
  if (e && (e.target as HTMLElement).closest('.sr-popup-panel,.mark-menu,[data-note-marker]')) return
  const process = (targetDoc: Document, index?: number) => {
    const selection = targetDoc.defaultView?.getSelection()
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      if (state.selection) {
        props.ttsController?.cancelLoop()
        state.selection = null
      }
      return false
    }
    try {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const cfi = index !== undefined ? props.reader?.getView().getCFI(index, range) : undefined
      const { x, y } = getCoords(rect, targetDoc)
      openSelectionPanel({ text: selection.toString().trim(), location: { format: props.pdfViewer ? 'pdf' : 'epub', cfi } }, x + (index === undefined ? rect.width / 2 : 0), y)
      return true
    } catch {
      return false
    }
  }
  if (props.reader) {
    const contents = props.reader.getView().renderer?.getContents?.()
    if (!contents) return
    for (const { doc: targetDoc, index } of contents) if (process(targetDoc, index)) return
  } else if (props.currentView && doc) process(doc)
}

const setupAnnotationListeners = () => {
  if (!props.reader || !props.manager) return
  props.reader.getView().addEventListener('show-annotation', ((e: CustomEvent) => {
    if (quickMarkCooldown) return
    const { value, range } = e.detail
    const mark = props.manager?.getAll().find(item => item.cfi === value)
    if (!mark) return
    try {
      const rect = range.getBoundingClientRect()
      const { x, y } = getCoords(rect, range.startContainer.ownerDocument)
      openMarkPanel(mark, x, y + rect.height + 10)
    } catch {}
  }) as EventListener)
}
const handleGlobalEdit = (e: Event) => {
  const detail = (e as CustomEvent).detail
  detail?.item && openMarkPanel(detail.item, detail.position?.x, detail.position?.y, true)
}

onMounted(() => {
  setupAnnotationListeners()
  window.addEventListener('sireader:edit-mark', handleGlobalEdit)
})
onUnmounted(() => {
  window.removeEventListener('sireader:edit-mark', handleGlobalEdit)
})

defineExpose({ openSelectionPanel, openMarkPanel, closeAll, showShapeCard, showAnnotationCard, checkSelection, setupAnnotationListeners, showMenu: openSelectionPanel, showCard: openMarkPanel })

const handleCopy = async (color?: HighlightColor, style?: typeof state.style) => {
  if (!state.selection) return
  const mark = await addSelectionMark(state.selection.text, color || 'blue', style || 'highlight')
  if (mark) emit('copyMark', mark)
  if (!props.quickMarkMode) return closeAll()
  quickMarkCooldown = true
  setTimeout(() => { quickMarkCooldown = false }, 300)
  window.getSelection()?.removeAllRanges()
}
const toggleSendMenu = () => {
  state.showSendMenu = !state.showSendMenu
  if (state.showSendMenu) {
    sendSearch.value = ''
    sendDocs.value = []
  }
}
const searchSendDocs = async () => {
  const keyword = sendSearch.value.trim()
  if (!keyword) return sendDocs.value = []
  try { sendDocs.value = await (await import('@/composables/useSetting')).searchDocs(keyword) } catch { sendDocs.value = [] }
}
const createMark = async () => {
  return state.selection ? await addSelectionMark(state.selection.text, props.quickMarkColor || 'blue', props.quickMarkStyle || 'highlight') : null
}
const handleSendToDoc = async (docId: string) => {
  if (props.can && !props.can('quick-send')) return props.showUpgrade?.('快捷发送')
  if (!docId) return
  const mark = await createMark()
  if (mark) await (await import('@/utils/copy')).sendMarkToDoc(mark, docId, { bookUrl: (window as any).__currentBookUrl || '', isPdf: isPdf.value, showMsg: (msg: string, type?: string) => showMessage(msg, type === 'error' ? 2000 : 1500, type as any), i18n: props.i18n, marks: props.manager })
  closeAll()
}
const handleCopyText = () => {
  if (!state.selection) return
  navigator.clipboard.writeText(state.selection.text).then(() => showMessage(props.i18n?.copied || '已复制', 1000))
  closeAll()
}
const handleSpeak = () => {
  if (!state.selection || !props.ttsController) return
  if (props.can && !props.can('tts')) return props.showUpgrade?.('TTS朗读')
  props.ttsController.speak(state.selection.text, props.ttsConfig)
  hideMenus()
}
const handleDict = async () => {
  if (!state.selection) return
  const { openDict } = await import('@/utils/dictionary')
  openDict(state.selection.text, state.x, state.y, { text: state.selection.text, cfi: state.selection.location?.cfi, section: state.selection.location?.section, page: state.selection.location?.page, rects: state.selection.location?.rects })
  hideMenus()
}
const handleTranslate = () => {
  if (props.can && !props.can('translate')) return props.showUpgrade?.('翻译')
  hideMenus()
  state.showTranslate = true
}
const handleEdit = () => {
  state.isEditing = true
  focusNote()
}
const handleCopyMark = () => state.currentMark ? emit('copyMark', state.currentMark) : emit('copy', state.text)
const handleOpenBlock = () => state.currentMark?.blockId && openBlock(state.currentMark.blockId)
const handleShowFloat = (e: MouseEvent) => state.currentMark?.blockId && showFloat(state.currentMark.blockId, e.target as HTMLElement)
const goToMark = () => {
  if (!state.currentMark) return
  jump(state.currentMark, (window as any).__activeView, (window as any).__activeReader, props.manager)
  closeAll()
}
const handleSave = async () => {
  if (!props.manager) return
  try {
    if (state.currentMark) {
      const updates: any = { note: state.note.trim() || undefined, color: state.color }
      if (state.currentMark.type === 'shape') Object.assign(updates, { shapeType: state.shapeType, filled: isTextboxMark.value ? false : state.shapeFilled, text: isTextboxMark.value ? (state.text.trim() || '文本框') : undefined })
      else if (state.currentMark.type === 'ink') Object.assign(updates, { text: state.text.trim() || state.currentMark.text })
      else Object.assign(updates, { text: state.text.trim(), style: state.style })
      const { saveMarkEdit } = await import('@/utils/copy')
      await saveMarkEdit(state.currentMark, updates, { marks: props.manager, bookUrl: (window as any).__currentBookUrl || '', isPdf: isPdf.value, reader: (window as any).__activeReader, pdfViewer: (window as any).__activeView?.viewer, shapeCache: new Map() })
      Object.assign(state.currentMark, updates)
      showMessage(props.i18n?.saved || '已保存', 1000)
      state.isEditing = false
      handleCopyMark()
      return
    }
    const args = selectionArgs()
    const pos = args?.[0]
    if (!pos) return showMessage('无法获取位置信息', 2000, 'error')
    const mark = state.note.trim() ? await props.manager.addNote(pos, state.note.trim(), ...args.slice(1)) : await props.manager.addHighlight(...args)
    if (mark) emit('copyMark', mark)
    closeAll()
  } catch {
    showMessage(props.i18n?.saveError || '保存失败', 2000, 'error')
  }
}
const handleDelete = async () => {
  if (!props.manager || !state.currentMark) return
  try {
    if (await props.manager.deleteMark(state.currentMark)) {
      showMessage(props.i18n?.deleted || '已删除', 1000)
      closeAll()
    } else showMessage('删除失败：未找到标注', 2000, 'error')
  } catch {
    showMessage(props.i18n?.deleteError || '删除失败', 2000, 'error')
  }
}
const handleCancel = () => state.currentMark ? openCard({ ...markData(state.currentMark, { isEditing: false }) }) : closeAll()
const handleImport = async () => {
  if (!state.currentMark) return
  const { importMark } = await import('@/utils/copy')
  await importMark(state.currentMark, { bookUrl: (window as any).__currentBookUrl || '', isPdf: isPdf.value, showMsg: (msg: string, type?: string) => showMessage(msg, type === 'error' ? 2000 : 1500, type as any), i18n: props.i18n, marks: props.manager })
}
</script>

<style scoped lang="scss">
.mark-overlay{position:fixed;inset:0;z-index:949;background:transparent}
.mark-menu{position:fixed;z-index:950;display:flex;gap:4px;padding:6px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);button{width:32px;height:32px;padding:0;border:none;background:transparent;border-radius:6px;cursor:pointer;transition:all .15s;color:var(--b3-theme-on-surface);display:flex;align-items:center;justify-content:center;svg{width:16px;height:16px}&:hover{background:var(--b3-list-hover);color:var(--b3-theme-primary)}}}
.send-menu{flex-direction:column;width:280px;max-height:400px;overflow-y:auto;button{width:100%;height:auto;padding:8px;justify-content:flex-start;border-radius:0;border-bottom:1px solid var(--b3-border-color);font-size:12px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;&:last-child{border-bottom:none}}}
.send-input{margin:8px;width:calc(100% - 16px)}
.send-empty{padding:16px 8px;text-align:center;color:var(--b3-theme-on-surface-variant);font-size:12px;opacity:.6}
.send-item:hover{background:var(--b3-list-hover)}
.sr-popup-panel{position:fixed;z-index:10002!important;width:340px;max-width:340px;pointer-events:auto;cursor:default}
.sr-popup-panel .sr-main{padding:12px;border-left:4px solid;border-radius:8px}
.sr-popup-panel .sr-note{margin-bottom:8px;cursor:text}
.sr-popup-panel .sr-btns{position:static;opacity:1;gap:8px}
.sr-popup-panel .sr-btns button{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1px solid var(--b3-border-color);border-radius:4px;background:transparent}
.sr-popup-panel .sr-btns button svg{width:14px;height:14px;display:block}
.sr-popup-panel .sr-style-btn{width:36px;height:32px}
.sr-popup-panel .sr-style-btn svg{width:16px;height:16px}
.toolbar-divider{width:1px;height:24px;background:var(--b3-border-color);margin:0 4px}
</style>
