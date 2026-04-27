<template>
  <div
    ref="toolbarRef"
    v-motion
    :initial="{ opacity: 0, y: fixed ? -20 : 0, x: fixed ? 0 : 100 }"
    :enter="{ opacity: 1, y: 0, x: 0 }"
    class="pdf-toolbar"
    :class="{ fixed }"
    :style="fixed ? {} : { top: pos.y + 'px', right: pos.x + 'px' }"
  >
    <div class="toolbar-row">
      <template v-if="expanded">
        <div class="toolbar-group">
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="缩小" @click.stop="zoomOut"><svg><use xlink:href="#lucide-zoom-out" /></svg></button>
          <select v-model="zoomMode" class="b3-tooltips b3-tooltips__s" aria-label="缩放模式" @change="handleZoomMode" @mousedown.stop>
            <option value="custom">{{ zoomPercent }}%</option>
            <option value="fit-width">适应宽度</option>
            <option value="fit-page">适应页面</option>
          </select>
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="放大" @click.stop="zoomIn"><svg><use xlink:href="#lucide-zoom-in" /></svg></button>
        </div>
        <span class="toolbar-divider" />
        <div class="toolbar-group">
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="向左旋转" @click.stop="rotateLeft"><svg><use xlink:href="#lucide-rotate-ccw-square" /></svg></button>
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="向右旋转" @click.stop="rotateRight"><svg><use xlink:href="#lucide-rotate-cw-square" /></svg></button>
        </div>
        <span class="toolbar-divider" />
        <div class="toolbar-group">
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'text' }" aria-label="文本选择" @click.stop="setToolMode('text')"><svg><use xlink:href="#lucide-square-mouse-pointer" /></svg></button>
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'hand' }" aria-label="手形工具" @click.stop="setToolMode('hand')"><svg><use xlink:href="#lucide-hand" /></svg></button>
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'ink' }" aria-label="墨迹标注" @click.stop="toggleInk"><svg><use xlink:href="#lucide-brush" /></svg></button>
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: toolMode === 'shape' }" aria-label="形状标注" @click.stop="toggleShape"><svg><use xlink:href="#iconShapes" /></svg></button>
        </div>
        <span class="toolbar-divider" />
        <div class="toolbar-group">
          <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="更多操作" @click.stop="showMore = !showMore"><svg><use xlink:href="#iconMore" /></svg></button>
        </div>
        <span v-if="!fixed" class="toolbar-divider" />
      </template>
      <button v-if="!fixed" class="toolbar-btn b3-tooltips b3-tooltips__s" :aria-label="expanded ? '收起工具栏' : '展开工具栏'" @click.stop="expanded = !expanded" @mousedown="startDrag">
        <svg><use :xlink:href="expanded ? '#iconClose' : '#iconMenu'" /></svg>
      </button>
    </div>

    <div v-if="expanded && toolMode === 'ink'" v-motion :initial="{ opacity: 0, height: 0 }" :enter="{ opacity: 1, height: 'auto' }" class="toolbar-row ink-row">
      <div class="toolbar-group">
        <button v-for="c in colors" :key="c" class="ink-color b3-tooltips b3-tooltips__s" :class="{ active: inkColor === c }" :style="{ background: c }" :aria-label="`墨迹颜色 ${c}`" @click.stop="inkColor = c" />
      </div>
      <span class="toolbar-divider" />
      <div class="toolbar-group">
        <div class="ink-width-control">
          <input v-model.number="inkWidth" type="range" min="1" max="10" class="ink-slider" aria-label="墨迹粗细" @mousedown.stop />
          <span class="ink-width-value">{{ inkWidth }}</span>
        </div>
      </div>
      <span class="toolbar-divider" />
      <div class="toolbar-group">
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: inkEraser }" aria-label="橡皮擦" @click.stop="toggleEraser"><svg><use xlink:href="#lucide-eraser" /></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="撤销墨迹" @click.stop="inkUndo"><svg><use xlink:href="#lucide-undo-2" /></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="清空墨迹" @click.stop="inkClear"><svg><use xlink:href="#lucide-brush-cleaning" /></svg></button>
      </div>
    </div>

    <div v-if="expanded && toolMode === 'shape'" v-motion :initial="{ opacity: 0, height: 0 }" :enter="{ opacity: 1, height: 'auto' }" class="toolbar-row ink-row">
      <div class="toolbar-group">
        <button v-for="s in shapes" :key="s.type" class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: shapeType === s.type }" :aria-label="s.label" @click.stop="shapeType = s.type"><svg><use :xlink:href="s.icon" /></svg></button>
      </div>
      <span class="toolbar-divider" />
      <div class="toolbar-group">
        <button v-for="c in shapeColors" :key="c" class="ink-color b3-tooltips b3-tooltips__s" :class="{ active: shapeColor === c }" :style="{ background: c }" :aria-label="`形状颜色 ${c}`" @click.stop="shapeColor = c" />
      </div>
      <span class="toolbar-divider" />
      <div class="toolbar-group">
        <button v-if="shapeType !== 'textbox'" class="toolbar-btn b3-tooltips b3-tooltips__s" :class="{ active: shapeFilled }" aria-label="填充" @click.stop="shapeFilled = !shapeFilled"><svg><use xlink:href="#lucide-paint-bucket" /></svg></button>
        <div class="ink-width-control">
          <input v-model.number="shapeWidth" type="range" min="1" max="10" class="ink-slider" aria-label="形状粗细" @mousedown.stop />
          <span class="ink-width-value">{{ shapeWidth }}</span>
        </div>
      </div>
      <span class="toolbar-divider" />
      <div class="toolbar-group">
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="撤销形状" @click.stop="shapeUndo"><svg><use xlink:href="#lucide-undo-2" /></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__s" aria-label="清空形状" @click.stop="shapeClear"><svg><use xlink:href="#lucide-brush-cleaning" /></svg></button>
      </div>
    </div>
  </div>

  <Transition name="fade">
    <div v-if="showMore" class="pdf-menu" @click="showMore = false">
      <button class="b3-tooltips b3-tooltips__w" aria-label="打印 PDF" @click="print"><svg><use xlink:href="#iconFile" /></svg>打印</button>
      <button class="b3-tooltips b3-tooltips__w" aria-label="下载 PDF" @click="download"><svg><use xlink:href="#iconDownload" /></svg>下载</button>
      <button class="b3-tooltips b3-tooltips__w" aria-label="导出图片" @click="exportImages"><svg><use xlink:href="#iconImage" /></svg>导出图片</button>
      <button class="b3-tooltips b3-tooltips__w" aria-label="查看 PDF 信息" @click="showMetadata = true"><svg><use xlink:href="#iconInfo" /></svg>信息</button>
    </div>
  </Transition>

  <Teleport to="body">
    <div v-if="showMetadata" class="pdf-meta-overlay" @click="showMetadata = false">
      <div v-motion-pop class="pdf-meta-dialog" @click.stop>
        <div class="pdf-meta-header">
          <h3>文档信息</h3>
          <button class="b3-tooltips b3-tooltips__s" aria-label="关闭信息面板" @click="showMetadata = false"><svg><use xlink:href="#iconClose" /></svg></button>
        </div>
        <div class="pdf-meta-body">
          <div v-if="metadata" class="pdf-meta-grid">
            <div v-for="(item, i) in metaItems" :key="i" v-motion-slide-visible-once-left class="pdf-meta-item">
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
import { computed, ref, watch } from 'vue'
import type { PDFViewer } from '@/core/pdf/viewer'
import type { PDFSearch } from '@/core/pdf/search'
import type { PDFMetadata } from '@/core/pdf'
import type { PdfToolbarSettings } from '@/composables/useSetting'
import { PDF_SHAPE_COLORS, PDF_SHAPE_OPTIONS } from '@/core/pdf/shape'

const props = defineProps<{ viewer: PDFViewer; searcher: PDFSearch; fileSize?: number; fixed?: boolean; settings?: PdfToolbarSettings }>()
const emit = defineEmits([
  'print', 'download', 'export-images',
  'ink-toggle', 'ink-color', 'ink-width', 'ink-undo', 'ink-clear', 'ink-save', 'ink-eraser',
  'shape-toggle', 'shape-type', 'shape-color', 'shape-width', 'shape-filled', 'shape-undo', 'shape-clear',
  'update-settings'
])

const expanded = ref(false)
const scale = ref(props.viewer.getScale())
const rotation = ref(0 as 0 | 90 | 180 | 270)
const zoomMode = ref<'custom' | 'fit-width' | 'fit-page'>('fit-width')
const toolMode = ref<'text' | 'hand' | 'ink' | 'shape'>('text')
const showMore = ref(false)
const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#000000']
const inkEraser = ref(false)
const inkColor = ref('#ff0000')
const inkWidth = ref(2)
const shapeType = ref<'rect' | 'circle' | 'triangle' | 'textbox'>('rect')
const shapeColor = ref('#ff0000')
const shapeWidth = ref(2)
const shapeFilled = ref(false)
const shapes = PDF_SHAPE_OPTIONS
const shapeColors = PDF_SHAPE_COLORS
const showMetadata = ref(false)
const metadata = ref<PDFMetadata | null>(null)
const toolbarRef = ref<HTMLElement>()
const pos = ref({ x: 16, y: 52 })

let cleanup: Function | null = null
let applyingSettings = false

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

const emitMode = (mode: 'text' | 'hand' | 'ink' | 'shape') => {
  emit('ink-toggle', mode === 'ink')
  emit('shape-toggle', mode === 'shape')
}

const applyContainerMode = (mode: 'text' | 'hand' | 'ink' | 'shape') => {
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

const applyMode = (mode: 'text' | 'hand' | 'ink' | 'shape') => {
  toolMode.value = mode
  applyContainerMode(mode)
  emitMode(mode)
}

const applyToolbarSettings = async (settings?: PdfToolbarSettings) => {
  if (!settings) return
  const sameState =
    expanded.value === (!!props.fixed || settings.expanded) &&
    zoomMode.value === settings.zoomMode &&
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
  zoomMode.value = settings.zoomMode
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
  applyMode(settings.toolMode)
  if (zoomMode.value === 'fit-width') await props.viewer.fitWidth()
  else if (zoomMode.value === 'fit-page') await props.viewer.fitPage()
  else await props.viewer.setScale(scale.value)
  await props.viewer.setRotation(rotation.value)
  scale.value = props.viewer.getScale()
  rotation.value = props.viewer.getRotation()
  applyingSettings = false
}

watch(() => props.settings, settings => { void applyToolbarSettings(settings) }, { immediate: true, deep: true })
watch(() => props.fixed, v => v && (expanded.value = true), { immediate: true })

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

const zoomPercent = computed(() => Math.round(scale.value * 100))
const formatSize = (b: number) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(2)} KB` : `${(b / 1048576).toFixed(2)} MB`
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

const syncScale = () => { scale.value = props.viewer.getScale(); emitSettings() }
const zoomIn = async () => { zoomMode.value = 'custom'; await props.viewer.setScale(scale.value + 0.25); syncScale() }
const zoomOut = async () => { zoomMode.value = 'custom'; await props.viewer.setScale(Math.max(0.25, scale.value - 0.25)); syncScale() }
const handleZoomMode = async () => {
  if (zoomMode.value === 'fit-width') await props.viewer.fitWidth()
  else if (zoomMode.value === 'fit-page') await props.viewer.fitPage()
  else await props.viewer.setScale(scale.value)
  syncScale()
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
const print = () => emit('print')
const download = () => emit('download')
const exportImages = () => emit('export-images')

const setToolMode = (mode: 'text' | 'hand') => {
  applyMode(mode)
  emitSettings()
}

const toggleInk = () => {
  applyMode(toolMode.value === 'ink' ? 'hand' : 'ink')
  emitSettings()
}
const toggleShape = () => {
  applyMode(toolMode.value === 'shape' ? 'hand' : 'shape')
  emitSettings()
}
const toggleEraser = () => { inkEraser.value = !inkEraser.value; emit('ink-eraser', inkEraser.value) }
const inkUndo = () => emit('ink-undo')
const inkClear = () => emit('ink-clear')
const shapeUndo = () => emit('shape-undo')
const shapeClear = () => emit('shape-clear')

watch(inkColor, v => emit('ink-color', v))
watch(inkWidth, v => emit('ink-width', v))
watch(shapeType, v => {
  if (v === 'textbox') shapeFilled.value = false
  emit('shape-type', v)
  emitSettings()
})
watch(shapeColor, v => emit('shape-color', v))
watch(shapeWidth, v => emit('shape-width', v))
watch(shapeFilled, v => emit('shape-filled', v))
watch(expanded, v => { if (!v && (toolMode.value === 'ink' || toolMode.value === 'shape')) applyMode('hand'); emitSettings() })
watch(showMetadata, async v => {
  if (v && !metadata.value) {
    const { getMetadata } = await import('@/core/pdf')
    metadata.value = await getMetadata(props.viewer.getPDF()!, props.fileSize)
  }
})
</script>

<style scoped lang="scss">
.pdf-toolbar{
  position:absolute;display:inline-flex;flex-direction:column;gap:4px;padding:4px;
  background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:6px;
  box-shadow:0 2px 8px #0002;z-index:1000;user-select:none;
  &.fixed{
    top:0;left:0;right:0;transform:none;flex-direction:row;border-radius:0;
    border-left:none;border-right:none;border-top:none;box-shadow:0 1px 3px #0001;
    .toolbar-row{flex-wrap:wrap;justify-content:center}
    .ink-row{border-top:none;border-left:1px solid var(--b3-border-color);padding-top:0;padding-left:6px;margin-left:4px}
  }
}
.toolbar-row{display:flex;align-items:center;gap:4px;select{height:28px;padding:0 8px;border:1px solid var(--b3-border-color);border-radius:4px;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);font-size:12px;cursor:pointer;&:focus{outline:none;border-color:var(--b3-theme-primary)}}}
.toolbar-group{display:inline-flex;align-items:center;gap:4px;flex-wrap:nowrap;white-space:nowrap;flex:0 0 auto}
.toolbar-divider{flex:0 0 auto}
.ink-row{border-top:1px solid var(--b3-border-color);padding-top:6px;margin-top:0}
.ink-color{width:16px;height:16px;padding:0;border:2px solid transparent;border-radius:50%;cursor:pointer;transition:all .15s;flex-shrink:0;&:hover{transform:scale(1.1);box-shadow:0 2px 4px #0003}&.active{border-color:var(--b3-theme-on-surface);transform:scale(1.15);box-shadow:0 0 0 2px var(--b3-theme-surface),0 2px 6px #0004}}
.ink-width-control{display:flex;align-items:center;gap:6px}
.ink-slider{width:80px;height:4px;-webkit-appearance:none;background:var(--b3-border-color);border-radius:2px;outline:none;&::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;background:var(--b3-theme-primary);border-radius:50%;cursor:pointer;box-shadow:0 1px 3px #0003;transition:all .15s;&:hover{transform:scale(1.2);box-shadow:0 2px 6px #0004}}&::-moz-range-thumb{width:14px;height:14px;background:var(--b3-theme-primary);border-radius:50%;cursor:pointer;border:none;box-shadow:0 1px 3px #0003}}
.ink-width-value{font-size:11px;font-weight:600;color:var(--b3-theme-on-surface);min-width:16px;text-align:center}
.pdf-menu{position:absolute;top:56px;right:16px;min-width:140px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:6px;box-shadow:0 2px 8px #0002;padding:4px;z-index:100;button{width:100%;display:flex;align-items:center;gap:6px;padding:6px 10px;border:none;background:transparent;border-radius:4px;cursor:pointer;text-align:left;color:var(--b3-theme-on-surface);font-size:12px;transition:all .15s;svg{width:14px;height:14px}&:hover{background:var(--b3-list-hover)}}}
.pdf-meta-overlay{position:fixed;inset:0;background:#0008;display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(2px)}
.pdf-meta-dialog{background:var(--b3-theme-surface);border-radius:8px;box-shadow:0 8px 32px #0003;max-width:560px;width:90%;max-height:80vh;display:flex;flex-direction:column}
.pdf-meta-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--b3-border-color);h3{margin:0;font-size:15px;font-weight:600}button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:4px;cursor:pointer;transition:all .15s;svg{width:14px;height:14px}&:hover{background:var(--b3-list-hover);transform:scale(1.1)}&:active{transform:scale(.95)}}}
.pdf-meta-body{padding:18px;overflow-y:auto}
.pdf-meta-grid{display:grid;gap:10px}
.pdf-meta-item{display:flex;gap:10px;padding:8px;border-radius:4px;transition:background .15s;&:hover{background:var(--b3-list-hover)}.label{min-width:75px;font-weight:500;font-size:13px;color:var(--b3-theme-on-surface-variant)}.value{flex:1;font-size:13px;color:var(--b3-theme-on-surface);word-break:break-all}}
.pdf-meta-loading{text-align:center;padding:40px;color:var(--b3-theme-on-surface-variant);font-size:13px}
.fade-enter-active,.fade-leave-active{transition:opacity .15s}
.fade-enter-from,.fade-leave-to{opacity:0}
</style>
