<template>
  <div
    ref="toolbarRef"
    v-motion
    :initial="{ opacity: 0, y: fixed ? -20 : 0, x: fixed ? 0 : 100 }"
    :enter="{ opacity: 1, y: 0, x: 0 }"
    class="pdf-toolbar"
    :class="{ fixed, compact: !expanded && !fixed }"
    :style="fixed ? {} : { top: pos.y + 'px', right: pos.x + 'px' }"
  >
    <div v-if="fixed || expanded" class="toolbar-main">
      <div class="toolbar-group toolbar-group--zoom">
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="缩小" @click.stop="zoomOut"><svg><use xlink:href="#lucide-zoom-out" /></svg></button>
        <select v-model="zoomMode" class="toolbar-select b3-tooltips b3-tooltips__s" aria-label="缩放模式" @change="handleZoomMode" @mousedown.stop>
          <option value="custom">{{ zoomPercent }}%</option>
          <option value="fit-width">适应宽度</option>
        </select>
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="放大" @click.stop="zoomIn"><svg><use xlink:href="#lucide-zoom-in" /></svg></button>
      </div>

      <span class="toolbar-divider" />

      <div class="toolbar-group">
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="向左旋转" @click.stop="rotateLeft"><svg><use xlink:href="#lucide-rotate-ccw-square" /></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="向右旋转" @click.stop="rotateRight"><svg><use xlink:href="#lucide-rotate-cw-square" /></svg></button>
      </div>

      <span class="toolbar-divider" />

      <div class="toolbar-group toolbar-group--tools">
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'text' }" aria-label="文本选择" @click.stop="setToolMode('text')"><svg><use xlink:href="#lucide-square-mouse-pointer" /></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'hand' }" aria-label="手形工具" @click.stop="setToolMode('hand')"><svg><use xlink:href="#lucide-hand" /></svg></button>

        <div class="toolbar-anchor">
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'ink' || activePopup === 'ink' }" aria-label="墨迹标注" @click.stop="togglePopup('ink')"><svg><use xlink:href="#lucide-brush" /></svg></button>
          <Transition name="fade">
            <div v-if="activePopup === 'ink'" class="toolbar-popover" @click.stop>
              <div class="popover-row popover-row--stack">
                <span class="popover-title">颜色</span>
                <div class="popover-content popover-colors">
                  <button v-for="c in colors" :key="c" class="ink-color" :class="{ active: inkColor === c }" :style="{ background: c }" :aria-label="`墨迹颜色 ${c}`" @click.stop="inkColor = c" />
                </div>
              </div>
              <div class="popover-row popover-row--stack">
                <span class="popover-title">粗细</span>
                <div class="popover-content">
                  <div class="range-control">
                    <input v-model.number="inkWidth" type="range" min="1" max="10" class="ink-slider" aria-label="墨迹粗细" @mousedown.stop />
                    <span class="range-value">{{ inkWidth }}</span>
                  </div>
                </div>
              </div>
              <div class="popover-actions">
                <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: inkEraser }" aria-label="橡皮擦" @click.stop="toggleEraser"><svg><use xlink:href="#lucide-eraser" /></svg></button>
                <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="撤销墨迹" @click.stop="inkUndo"><svg><use xlink:href="#lucide-undo-2" /></svg></button>
                <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="清空墨迹" @click.stop="inkClear"><svg><use xlink:href="#lucide-brush-cleaning" /></svg></button>
              </div>
            </div>
          </Transition>
        </div>

        <div class="toolbar-anchor">
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'shape' || activePopup === 'shape' }" aria-label="形状标注" @click.stop="togglePopup('shape')"><svg><use xlink:href="#iconShapes" /></svg></button>
          <Transition name="fade">
            <div v-if="activePopup === 'shape'" class="toolbar-popover toolbar-popover--wide" @click.stop>
              <div class="popover-row popover-row--stack">
                <span class="popover-title">形状</span>
                <div class="popover-content">
                  <button v-for="s in shapes" :key="s.type" class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: shapeType === s.type }" :aria-label="s.label" @click.stop="setShapeType(s.type)"><svg><use :xlink:href="s.icon" /></svg></button>
                  <button v-if="shapeType !== 'textbox'" class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: shapeFilled }" aria-label="填充" @click.stop="shapeFilled = !shapeFilled"><svg><use xlink:href="#lucide-paint-bucket" /></svg></button>
                </div>
              </div>
              <div class="popover-row popover-row--stack">
                <span class="popover-title">颜色</span>
                <div class="popover-content popover-colors">
                  <button v-for="c in shapeColors" :key="c" class="ink-color" :class="{ active: shapeColor === c }" :style="{ background: c }" :aria-label="`形状颜色 ${c}`" @click.stop="shapeColor = c" />
                </div>
              </div>
              <div class="popover-row popover-row--stack">
                <span class="popover-title">描边</span>
                <div class="popover-content">
                  <div class="range-control">
                    <input v-model.number="shapeWidth" type="range" min="1" max="10" class="ink-slider" aria-label="形状粗细" @mousedown.stop />
                    <span class="range-value">{{ shapeWidth }}</span>
                  </div>
                </div>
              </div>
              <div class="popover-actions">
                <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="撤销形状" @click.stop="shapeUndo"><svg><use xlink:href="#lucide-undo-2" /></svg></button>
                <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="清空形状" @click.stop="shapeClear"><svg><use xlink:href="#lucide-brush-cleaning" /></svg></button>
              </div>
            </div>
          </Transition>
        </div>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-anchor">
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: activePopup === 'more' }" aria-label="更多操作" @click.stop="togglePopup('more')"><svg><use xlink:href="#iconMore" /></svg></button>
        <Transition name="fade">
          <div v-if="activePopup === 'more'" class="toolbar-popover toolbar-menu" @click.stop>
            <button class="toolbar-menu-item" aria-label="打印 PDF" @click.stop="print"><svg><use xlink:href="#iconFile" /></svg><span>打印</span></button>
            <button class="toolbar-menu-item" aria-label="下载 PDF" @click.stop="download"><svg><use xlink:href="#iconDownload" /></svg><span>下载</span></button>
            <button class="toolbar-menu-item" aria-label="导出图片" @click.stop="exportImages"><svg><use xlink:href="#iconImage" /></svg><span>导图</span></button>
            <button class="toolbar-menu-item" aria-label="OCR 当前页" @click.stop="ocrPage"><svg><use xlink:href="#iconSearch" /></svg><span>OCR</span></button>
            <button class="toolbar-menu-item" aria-label="查看 PDF 信息" @click.stop="openMetadata"><svg><use xlink:href="#iconInfo" /></svg><span>信息</span></button>
          </div>
        </Transition>
      </div>
    </div>

    <button
      v-if="!fixed"
      class="toolbar-handle toolbar-btn b3-tooltips b3-tooltips__s"
      :aria-label="expanded ? '收起工具栏' : '展开工具栏'"
      @click.stop="toggleExpanded"
      @mousedown="startDrag"
    >
      <svg><use :xlink:href="expanded ? '#iconClose' : '#iconMenu'" /></svg>
    </button>
  </div>

  <Teleport to="body">
    <div v-if="showMetadata" class="pdf-meta-overlay" @click="showMetadata = false">
      <div v-motion-pop class="pdf-meta-dialog" @click.stop>
        <div class="pdf-meta-header">
          <h3>文档信息</h3>
          <button class="b3-tooltips b3-tooltips__s" aria-label="关闭信息面板" @click="showMetadata = false"><svg><use xlink:href="#iconClose" /></svg></button>
        </div>
        <div class="pdf-meta-body">
          <div v-if="metadata" class="pdf-meta-grid">
            <div v-for="(item, i) in metaItems" :key="i" class="pdf-meta-item">
              <span class="label">{{ item.label }}</span>
              <span class="value">{{ item.value }}</span>
            </div>
          </div>
          <div v-else class="pdf-meta-loading">加载中...</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PDFViewer } from '@/core/pdf/viewer'
import type { PDFSearch } from '@/core/pdf/search'
import type { PDFMetadata } from '@/core/pdf'
import type { PdfToolbarSettings } from '@/composables/useSetting'
import { PDF_SHAPE_COLORS, PDF_SHAPE_OPTIONS } from '@/core/pdf/shape'

type ToolMode = 'text' | 'hand' | 'ink' | 'shape'
type PopupMode = 'ink' | 'shape' | 'more' | null
type ZoomMode = PdfToolbarSettings['zoomMode']
type LegacyZoomMode = ZoomMode | 'fit-page'

const props = defineProps<{ viewer: PDFViewer; searcher: PDFSearch; fileSize?: number; fixed?: boolean; settings?: PdfToolbarSettings }>()
const emit = defineEmits([
  'print', 'download', 'export-images', 'ocr-page',
  'ink-toggle', 'ink-color', 'ink-width', 'ink-undo', 'ink-clear', 'ink-save', 'ink-eraser',
  'shape-toggle', 'shape-type', 'shape-color', 'shape-width', 'shape-filled', 'shape-undo', 'shape-clear',
  'update-settings'
])

const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#000000']
const shapes = PDF_SHAPE_OPTIONS
const shapeColors = PDF_SHAPE_COLORS

const expanded = ref(false)
const scale = ref(props.viewer.getScale())
const rotation = ref(0 as 0 | 90 | 180 | 270)
const zoomMode = ref<ZoomMode>('fit-width')
const toolMode = ref<ToolMode>('text')
const activePopup = ref<PopupMode>(null)
const inkEraser = ref(false)
const inkColor = ref('#ff0000')
const inkWidth = ref(2)
const shapeType = ref<'rect' | 'circle' | 'triangle' | 'textbox'>('rect')
const shapeColor = ref('#ff0000')
const shapeWidth = ref(2)
const shapeFilled = ref(false)
const showMetadata = ref(false)
const metadata = ref<PDFMetadata | null>(null)
const toolbarRef = ref<HTMLElement>()
const pos = ref({ x: 16, y: 52 })

let cleanup: Function | null = null
let applyingSettings = false

const zoomPercent = computed(() => Math.round(scale.value * 100))
const formatSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(2)} KB` : `${(b / 1048576).toFixed(2)} MB`
const normalizeZoomMode = (mode?: LegacyZoomMode): ZoomMode => mode === 'custom' ? 'custom' : 'fit-width'

const metaItems = computed(() => {
  if (!metadata.value) return []
  const m = metadata.value
  const fmt = (d: Date) => d.toLocaleString('zh-CN')
  return [
    { label: '标题', value: m.title || '无' },
    { label: '作者', value: m.author || '无' },
    { label: '主题', value: m.subject || '无' },
    { label: '关键词', value: m.keywords || '无' },
    { label: '创建者', value: m.creator || '无' },
    { label: '生产者', value: m.producer || '无' },
    { label: '页数', value: m.pageCount },
    { label: 'PDF 版本', value: m.pdfVersion || '无' },
    m.fileSize && { label: '文件大小', value: formatSize(m.fileSize) },
    m.creationDate && { label: '创建日期', value: fmt(m.creationDate) },
    m.modificationDate && { label: '修改日期', value: fmt(m.modificationDate) }
  ].filter(Boolean)
})

const emitSettings = () => {
  if (applyingSettings) return
  emit('update-settings', {
    expanded: expanded.value,
    zoomMode: zoomMode.value,
    scale: scale.value,
    rotation: rotation.value,
    toolMode: toolMode.value,
    inkColor: inkColor.value,
    inkWidth: inkWidth.value,
    shapeType: shapeType.value,
    shapeColor: shapeColor.value,
    shapeWidth: shapeWidth.value,
    shapeFilled: shapeFilled.value,
    position: { ...pos.value }
  })
}

const emitMode = (mode: ToolMode) => {
  if (applyingSettings) return
  emit('ink-toggle', mode === 'ink')
  emit('shape-toggle', mode === 'shape')
}

const closePopup = () => { activePopup.value = null }
const togglePopup = (name: Exclude<PopupMode, null>) => {
  activePopup.value = activePopup.value === name ? null : name
  if (name === 'ink') applyMode(toolMode.value === 'ink' ? 'hand' : 'ink', false)
  if (name === 'shape') applyMode(toolMode.value === 'shape' ? 'hand' : 'shape', false)
  emitSettings()
}

const applyContainerMode = (mode: ToolMode) => {
  cleanup?.()
  cleanup = null
  const container = props.viewer['container']
  if (!container) return
  if (mode === 'hand') {
    Object.assign(container.style, { cursor: 'grab', userSelect: 'none' })
    let drag = false
    let startX = 0
    let startY = 0
    let left = 0
    let top = 0
    const down = (e: MouseEvent) => {
      if (e.button) return
      drag = true
      container.style.cursor = 'grabbing'
      startX = e.pageX
      startY = e.pageY
      left = container.scrollLeft
      top = container.scrollTop
      e.preventDefault()
    }
    const move = (e: MouseEvent) => {
      if (!drag) return
      container.scrollLeft = left - (e.pageX - startX)
      container.scrollTop = top - (e.pageY - startY)
    }
    const up = () => {
      drag = false
      if (toolMode.value === 'hand') container.style.cursor = 'grab'
    }
    container.addEventListener('mousedown', down)
    container.addEventListener('mousemove', move)
    container.addEventListener('mouseup', up)
    container.addEventListener('mouseleave', up)
    cleanup = () => {
      container.removeEventListener('mousedown', down)
      container.removeEventListener('mousemove', move)
      container.removeEventListener('mouseup', up)
      container.removeEventListener('mouseleave', up)
    }
    return
  }
  Object.assign(container.style, { cursor: mode === 'text' ? 'text' : 'default', userSelect: mode === 'text' ? 'text' : 'none' })
}

const applyMode = (mode: ToolMode, syncPopup = true, force = false) => {
  if (!force && toolMode.value === mode) return
  toolMode.value = mode
  applyContainerMode(mode)
  emitMode(mode)
  if (syncPopup && mode !== 'ink' && mode !== 'shape') closePopup()
}

const applyToolbarSettings = async (settings?: PdfToolbarSettings) => {
  if (!settings) return
  const nextZoomMode = normalizeZoomMode(settings.zoomMode as LegacyZoomMode)
  const prevZoomMode = zoomMode.value
  const prevScale = scale.value
  const prevRotation = rotation.value
  const sameState =
    expanded.value === (!!props.fixed || settings.expanded) &&
    zoomMode.value === nextZoomMode &&
    scale.value === settings.scale &&
    rotation.value === settings.rotation &&
    toolMode.value === settings.toolMode &&
    inkColor.value === settings.inkColor &&
    inkWidth.value === settings.inkWidth &&
    shapeType.value === settings.shapeType &&
    shapeColor.value === settings.shapeColor &&
    shapeWidth.value === settings.shapeWidth &&
    shapeFilled.value === settings.shapeFilled &&
    pos.value.x === settings.position.x &&
    pos.value.y === settings.position.y
  if (sameState) return
  applyingSettings = true
  expanded.value = !!props.fixed || settings.expanded
  zoomMode.value = nextZoomMode
  scale.value = settings.scale
  rotation.value = settings.rotation
  inkColor.value = settings.inkColor
  inkWidth.value = settings.inkWidth
  shapeType.value = settings.shapeType
  shapeColor.value = settings.shapeColor
  shapeWidth.value = settings.shapeWidth
  shapeFilled.value = settings.shapeFilled
  pos.value = { ...settings.position }
  if (shapeType.value === 'textbox') shapeFilled.value = false
  applyMode(settings.toolMode, true, true)
  const zoomChanged = prevZoomMode !== zoomMode.value || (zoomMode.value === 'custom' && prevScale !== settings.scale)
  if (zoomChanged) {
    if (zoomMode.value === 'fit-width') await props.viewer.fitWidth()
    else await props.viewer.setScale(scale.value)
  }
  if (prevRotation !== settings.rotation) await props.viewer.setRotation(rotation.value)
  scale.value = props.viewer.getScale()
  rotation.value = props.viewer.getRotation()
  applyingSettings = false
}

const handleViewerScaleChange = (e: Event) => {
  if (applyingSettings) return
  scale.value = props.viewer.getScale()
  zoomMode.value = normalizeZoomMode((e as CustomEvent).detail?.mode)
  emitSettings()
}

const zoomIn = async () => {
  zoomMode.value = 'custom'
  await props.viewer.setScale(scale.value + 0.25)
}

const zoomOut = async () => {
  zoomMode.value = 'custom'
  await props.viewer.setScale(Math.max(0.25, scale.value - 0.25))
}

const handleZoomMode = async () => {
  if (zoomMode.value === 'fit-width') await props.viewer.fitWidth()
  else await props.viewer.setScale(scale.value)
}

const rotateLeft = async () => {
  rotation.value = ((rotation.value - 90 + 360) % 360) as 0 | 90 | 180 | 270
  await props.viewer.setRotation(rotation.value)
  emitSettings()
}

const rotateRight = async () => {
  rotation.value = ((rotation.value + 90) % 360) as 0 | 90 | 180 | 270
  await props.viewer.setRotation(rotation.value)
  emitSettings()
}

const setToolMode = (mode: 'text' | 'hand') => {
  applyMode(mode)
  emitSettings()
}

const setShapeType = (type: typeof shapeType.value) => {
  shapeType.value = type
  if (type === 'textbox') shapeFilled.value = false
  emit('shape-type', type)
  emitSettings()
}

const toggleExpanded = () => {
  expanded.value = !expanded.value
  if (!expanded.value) closePopup()
}

const toggleEraser = () => {
  inkEraser.value = !inkEraser.value
  emit('ink-eraser', inkEraser.value)
}

const inkUndo = () => emit('ink-undo')
const inkClear = () => emit('ink-clear')
const shapeUndo = () => emit('shape-undo')
const shapeClear = () => emit('shape-clear')
const print = () => { closePopup(); emit('print') }
const download = () => { closePopup(); emit('download') }
const exportImages = () => { closePopup(); emit('export-images') }
const ocrPage = () => { closePopup(); emit('ocr-page') }
const openMetadata = () => { closePopup(); showMetadata.value = true }

const startDrag = (e: MouseEvent) => {
  if (props.fixed) return
  e.preventDefault()
  const el = toolbarRef.value!
  const rect = el.getBoundingClientRect()
  const parent = el.offsetParent as HTMLElement
  const parentRect = parent.getBoundingClientRect()
  const startX = e.clientX
  const startY = e.clientY
  const offsetX = parentRect.right - rect.right
  const offsetY = rect.top - parentRect.top
  const move = (event: MouseEvent) => {
    const x = offsetX - (event.clientX - startX)
    const y = offsetY + (event.clientY - startY)
    pos.value = {
      x: Math.max(0, Math.min(parentRect.width - rect.width, x)),
      y: Math.max(0, Math.min(parentRect.height - rect.height, y))
    }
    emitSettings()
  }
  const up = () => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

const handleOutsidePointer = (e: Event) => {
  const target = e.target as Node | null
  if (showMetadata.value) return
  if (toolbarRef.value?.contains(target)) return
  closePopup()
}

watch(() => props.settings, settings => { void applyToolbarSettings(settings) }, { immediate: true, deep: true })
watch(() => props.fixed, v => { if (v) expanded.value = true }, { immediate: true })
watch(inkColor, v => emit('ink-color', v))
watch(inkWidth, v => emit('ink-width', v))
watch(shapeColor, v => emit('shape-color', v))
watch(shapeWidth, v => emit('shape-width', v))
watch(shapeFilled, v => emit('shape-filled', v))
watch(shapeType, v => {
  if (v === 'textbox') shapeFilled.value = false
  emit('shape-type', v)
  emitSettings()
})
watch(expanded, v => {
  if (!v && (toolMode.value === 'ink' || toolMode.value === 'shape')) applyMode('hand')
  if (!v) closePopup()
  emitSettings()
})
watch(showMetadata, async v => {
  if (v && !metadata.value) {
    const { getMetadata } = await import('@/core/pdf')
    metadata.value = await getMetadata(props.viewer.getPDF()!, props.fileSize)
  }
})

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer, true)
  props.viewer['container']?.addEventListener('pdf-scale-change', handleViewerScaleChange)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer, true)
  props.viewer['container']?.removeEventListener('pdf-scale-change', handleViewerScaleChange)
})
</script>

<style scoped lang="scss">
.pdf-toolbar{position:absolute;display:flex;flex-direction:column;gap:0;min-width:0;padding:6px;background:color-mix(in srgb, var(--b3-theme-surface) 94%, transparent);border:1px solid color-mix(in srgb, var(--b3-border-color) 82%, transparent);border-radius:12px;box-shadow:0 12px 28px #00000016;backdrop-filter:blur(12px);z-index:1000;user-select:none;&.fixed{top:0;left:0;right:0;padding:8px 12px;border-top:none;border-left:none;border-right:none;border-radius:0;box-shadow:0 4px 14px #00000010;}&.compact{border-radius:999px;}}
.toolbar-main{display:flex;align-items:center;gap:6px;min-width:0;overflow:visible;}
.toolbar-group{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto;min-width:0;}
.toolbar-group--tools{padding:2px;background:color-mix(in srgb, var(--b3-theme-background) 76%, transparent);border:1px solid color-mix(in srgb, var(--b3-border-color) 68%, transparent);border-radius:999px;}
.toolbar-group--zoom .toolbar-select{min-width:108px}
.toolbar-spacer{flex:1 1 auto;min-width:8px}
.toolbar-divider{width:1px;height:22px;flex:0 0 auto;background:color-mix(in srgb, var(--b3-border-color) 72%, transparent)}
.toolbar-anchor{position:relative;display:inline-flex;align-items:center}
.toolbar-handle{align-self:flex-end;border-radius:999px}
.toolbar-select{height:30px;padding:0 10px;border:1px solid var(--b3-border-color);border-radius:999px;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);font-size:12px;cursor:pointer;&:focus{outline:none;border-color:var(--b3-theme-primary)}}
.toolbar-popover{position:absolute;top:34px;right:0;min-width:164px;padding:4px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:7px;box-shadow:0 8px 24px #0002;z-index:1002;}
.toolbar-popover--wide{min-width:196px}
.popover-row,.popover-actions{display:flex;align-items:center;gap:6px;}
.popover-row + .popover-row,.popover-row + .popover-actions{margin-top:2px}
.popover-row{padding:4px 6px;border-radius:5px;}
.popover-row--stack{flex-direction:column;align-items:stretch;gap:4px;}
.popover-title{font-size:10px;font-weight:600;color:var(--b3-theme-on-surface-variant);line-height:1;}
.popover-content{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;flex-wrap:wrap;}
.popover-colors{gap:6px}
.popover-actions{justify-content:flex-end;padding:2px 6px 0;}
.ink-color{width:14px;height:14px;padding:0;border:2px solid transparent;border-radius:50%;cursor:pointer;transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease;&:hover{transform:scale(1.08)}&.active{transform:scale(1.12);border-color:var(--b3-theme-on-surface);box-shadow:0 0 0 2px var(--b3-theme-surface);}}
.range-control{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto;justify-content:space-between;}
.ink-slider{width:88px;height:4px;-webkit-appearance:none;background:var(--b3-border-color);border-radius:999px;outline:none;&::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;background:var(--b3-theme-primary);border-radius:50%;cursor:pointer;}&::-moz-range-thumb{width:14px;height:14px;background:var(--b3-theme-primary);border:none;border-radius:50%;cursor:pointer;}}
.range-value{min-width:16px;text-align:center;font-size:10px;font-weight:700;color:var(--b3-theme-on-surface);}
.toolbar-menu{min-width:176px;padding:4px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;}
.toolbar-menu-item{width:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:56px;padding:8px 6px;border:none;background:transparent;border-radius:5px;cursor:pointer;text-align:center;color:var(--b3-theme-on-surface);font-size:11px;transition:background .15s ease, color .15s ease;svg{width:14px;height:14px;}span{flex:0 0 auto;line-height:1.1;}&:hover{background:var(--b3-list-hover);color:var(--b3-theme-primary);}}
.pdf-meta-overlay{position:fixed;inset:0;background:#0008;display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(2px)}
.pdf-meta-dialog{background:var(--b3-theme-surface);border-radius:8px;box-shadow:0 8px 32px #0003;max-width:560px;width:90%;max-height:80vh;display:flex;flex-direction:column}
.pdf-meta-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--b3-border-color);h3{margin:0;font-size:15px;font-weight:600}button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:4px;cursor:pointer;svg{width:14px;height:14px}&:hover{background:var(--b3-list-hover)}}}
.pdf-meta-body{padding:18px;overflow-y:auto}
.pdf-meta-grid{display:grid;gap:10px}
.pdf-meta-item{display:flex;gap:10px;padding:8px;border-radius:4px;&:hover{background:var(--b3-list-hover)}.label{min-width:75px;font-weight:500;font-size:13px;color:var(--b3-theme-on-surface-variant)}.value{flex:1;font-size:13px;color:var(--b3-theme-on-surface);word-break:break-all}}
.pdf-meta-loading{text-align:center;padding:40px;color:var(--b3-theme-on-surface-variant);font-size:13px}
.fade-enter-active,.fade-leave-active{transition:opacity .15s}
.fade-enter-from,.fade-leave-to{opacity:0}
</style>
