<template>
  <Teleport to="body">
    <!-- 遮罩：捕获外部点击 -->
    <div v-if="state.showMenu||state.showCard||state.showSendMenu" class="mark-overlay" @click="closeAll"/>
    
    <!-- 选择菜单：一行三按钮 -->
    <div v-if="state.showMenu" class="mark-menu" :style="menuPosition" @click.stop>
      <button @click="handleMark" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.note||'笔记'"><svg><use xlink:href="#lucide-square-pen"/></svg></button>
      <button @click="()=>handleCopy()" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.mark||'标注'"><svg><use xlink:href="#iconMark"/></svg></button>
      <button @click="toggleSendMenu" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.sendTo||'发送到'"><svg><use xlink:href="#lucide-send"/></svg></button>
      <button @click="handleCopyText" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.copy||'复制'"><svg><use xlink:href="#iconCopy"/></svg></button>
      <button v-if="props.ttsConfig?.enabled" @click="handleSpeak" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.ttsPlay||'朗读'"><svg><use xlink:href="#iconPlay"/></svg></button>
      <button @click="handleDict" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.dict||'词典'"><svg><use xlink:href="#iconLanguage"/></svg></button>
      <button @click="handleTranslate" class="b3-tooltips b3-tooltips__s" :aria-label="i18n?.translate||'翻译'"><svg><use xlink:href="#iconTranslate"/></svg></button>
    </div>
    
    <!-- 发送到文档菜单 -->
    <div v-if="state.showSendMenu" class="mark-menu send-menu" :style="sendMenuPosition" @click.stop>
      <button v-for="doc in quickDocs" :key="doc.id" @click="()=>handleSendToDoc(doc.id)" class="send-item">{{doc.name}}</button>
      <input v-model="sendSearch" @input="searchSendDocs" :placeholder="i18n?.searchDocPlaceholder||'搜索文档...'" class="b3-text-field send-input"/>
      <div v-if="!sendDocs.length" class="send-empty">{{sendSearch?'无结果':'输入关键字搜索'}}</div>
      <button v-for="doc in sendDocs" :key="doc.id" @click="()=>handleSendToDoc(doc.path?.split('/').pop()?.replace('.sy','')||doc.id)" class="send-item">{{doc.hPath||doc.content||'无标题'}}</button>
    </div>
    
    <!-- 翻译弹窗 -->
    <Translate :show="state.showTranslate" :text="state.selection?.text||''" :x="state.x" :y="state.y" @close="state.showTranslate=false"/>
    
    <!-- 标注卡片 -->
    <div v-if="state.showCard" v-motion :initial="{opacity:0,y:5}" :enter="{opacity:1,y:0}" class="sr-card" :style="cardPosition" @click.stop>
      <div class="sr-main" :style="{borderLeftColor:currentColor}">
        <!-- 查看模式 -->
        <template v-if="!state.isEditing">
          <div class="sr-title" @click="goToMark">{{state.text||'无内容'}}</div>
          <div v-if="state.note" class="sr-note" @click.stop="handleEdit">{{state.note}}</div>
          <div class="sr-btns">
            <button @click.stop="handleCopyMark" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n.copy||'复制'"><svg><use xlink:href="#iconCopy"/></svg></button>
            <button @click.stop="handleEdit" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n.edit||'编辑'"><svg><use xlink:href="#iconEdit"/></svg></button>
            <button v-if="state.currentMark?.blockId" @click.stop="handleOpenBlock" @mouseenter="handleShowFloat" @mouseleave="hideFloat" class="b3-tooltips b3-tooltips__nw" aria-label="打开块"><svg><use xlink:href="#iconRef"/></svg></button>
            <button v-else @click.stop="handleImport" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n.import||'导入'"><svg><use xlink:href="#iconDownload"/></svg></button>
            <button @click.stop="handleDelete" class="b3-tooltips b3-tooltips__nw" :aria-label="i18n.delete||'删除'"><svg><use xlink:href="#iconTrashcan"/></svg></button>
          </div>
        </template>
        
        <!-- 编辑模式 -->
        <template v-else>
          <!-- 标注文本 -->
          <div v-if="state.currentMark?.type!=='shape'" class="sr-title" contenteditable @blur="e=>state.text=(e.target as HTMLElement).textContent||''" v-html="state.text"></div>
          <div v-else class="sr-title">{{state.text}}</div>
          
          <!-- 笔记输入 -->
          <textarea ref="noteRef" v-model="state.note" placeholder="添加笔记..." class="sr-note-input"/>
          
          <!-- 样式选项 -->
          <div class="sr-options">
            <!-- 颜色选择 -->
            <div class="sr-colors">
              <button v-for="c in COLORS" :key="c.color" class="sr-color-btn" :class="{active:state.color===c.color}" :style="{background:c.bg}" @click.stop="state.color=c.color"/>
            </div>
            
            <!-- 形状样式（PDF） -->
            <div v-if="state.currentMark?.type==='shape'" class="sr-styles">
              <button v-for="s in SHAPES" :key="s.type" class="sr-style-btn" :class="{active:state.shapeType===s.type}" @click.stop="state.shapeType=s.type" :title="s.name"><svg style="width:16px;height:16px"><use :xlink:href="s.icon"/></svg></button>
              <span class="toolbar-divider"/>
              <button class="sr-style-btn" :class="{active:state.shapeFilled}" @click.stop="state.shapeFilled=!state.shapeFilled" title="填充"><svg style="width:16px;height:16px"><use xlink:href="#lucide-paint-bucket"/></svg></button>
            </div>
            
            <!-- 文本样式 -->
            <div v-else class="sr-styles">
              <button v-for="s in STYLES" v-show="(!s.pdfOnly&&!s.epubOnly)||(s.pdfOnly&&isPdf)||(s.epubOnly&&!isPdf)" :key="s.type" class="sr-style-btn" :class="{active:state.style===s.type}" @click.stop="state.style=s.type">
                <span class="sr-style-icon" :data-type="s.type">{{s.text}}</span>
              </button>
            </div>
          </div>
          
          <!-- 操作按钮 -->
          <div class="sr-actions">
            <button @click.stop="handleCopyMark">复制</button>
            <button @click.stop="handleSave" class="primary">保存</button>
            <button @click.stop="handleCancel">取消</button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { showMessage } from 'siyuan'
import type { MarkManager, Mark, HighlightColor } from '@/core/MarkManager'
import { COLORS, STYLES, getColorMap } from '@/core/MarkManager'
import { openBlock, showFloat, hideFloat } from '@/utils/copy'
import { jump } from '@/utils/jump'
import Translate from './Translate.vue'

interface MarkSelection { text: string; location: { format: 'pdf'|'epub'; cfi?: string; section?: number; page?: number; rects?: any[] } }

const props = defineProps<{ manager: MarkManager|null; i18n?: Record<string,string>; pdfViewer?: any; reader?: any; currentView?: any; ttsController?: any; ttsConfig?: any; quickMarkMode?: boolean; quickMarkColor?: HighlightColor; quickMarkStyle?: 'highlight'|'underline'|'outline'|'dotted'|'dashed'|'double'|'squiggly'; can?: any; showUpgrade?: any }>()
const emit = defineEmits<{ 
  copy: [text: string, selection: any]; 
  dict: [text: string, x: number, y: number, selection: any]; 
  copyMark: [mark: Mark] 
}>()

const SHAPES = [
  { type: 'rect', name: '矩形', icon: '#iconSquareDashed' },
  { type: 'circle', name: '圆形', icon: '#iconCircleDashed' },
  { type: 'triangle', name: '三角形', icon: '#iconTriangleDashed' }
] as const

const colors = getColorMap()
const noteRef = ref<HTMLTextAreaElement>()
let quickMarkCooldown = false
const state = reactive({
  showMenu: false, showCard: false, showTranslate: false, showSendMenu: false, isEditing: false, x: 0, y: 0,
  selection: null as MarkSelection|null, currentMark: null as Mark|null,
  text: '', note: '', color: 'yellow' as HighlightColor,
  style: 'highlight' as 'highlight'|'underline'|'outline'|'dotted'|'dashed'|'double'|'squiggly',
  shapeType: 'rect' as 'rect'|'circle'|'triangle', shapeFilled: false
})
const sendSearch = ref('')
const sendDocs = ref<any[]>([])

// 当前选择状态（用于复制链接）
let currentSelection: { text: string; cfi?: string; section?: number; page?: number; rects?: any[]; textOffset?: number } | null = null

// 计算属性
const currentColor = computed(() => colors[state.color] || '#ffeb3b')
const isPdf = computed(() => (state.selection?.location.format || state.currentMark?.format) === 'pdf')
const quickDocs = computed(() => (window as any).__sireader_settings?.quickSendDocs || [])
const getBounds=()=>{const r=document.querySelector('.reader-container')?.getBoundingClientRect();return r?{left:r.left+16,right:r.right-16,top:r.top+16,bottom:r.bottom-16}:{left:16,right:innerWidth-16,top:16,bottom:innerHeight-16}}
const clampPos=(x:number,y:number,w:number,h:number)=>{const{left:l,right:r,top:t,bottom:b}=getBounds(),p=10;return{x:Math.max(l+w/2+p,Math.min(x,r-w/2-p)),y:y+h+p*2>b?Math.max(t+p*2,y-h-p):y+p}}
const menuPosition=computed(()=>{const{x,y}=clampPos(state.x,state.y,240,50);return{left:`${x}px`,top:`${y}px`,transform:'translate(-50%,0)'}})
const cardPosition=computed(()=>{const{x,y}=clampPos(state.x,state.y,340,state.isEditing?420:180);return{left:`${x}px`,top:`${y}px`,transform:'translate(-50%,0)'}})
const sendMenuPosition=computed(()=>{const qh=quickDocs.value.length*40;const sh=sendDocs.value.length?Math.min(sendDocs.value.length,5)*40:60;const h=qh+sh+40;const{x,y}=clampPos(state.x,state.y+60,280,h);return{left:`${x}px`,top:`${y}px`,transform:'translate(-50%,0)'}})


// 显示菜单/卡片
const showMenu = async(sel: MarkSelection, x: number, y: number) => {
  currentSelection = { text: sel.text, cfi: sel.location.cfi, section: sel.location.section, page: sel.location.page, rects: sel.location.rects, textOffset: (sel.location as any).textOffset }
  Object.assign(state, { selection: sel, x, y })
  if(props.quickMarkMode){
    await handleCopy(props.quickMarkColor,props.quickMarkStyle)
    return
  }
  Object.assign(state, { showMenu: true, showCard: false, showSendMenu: false })
}
const showCard = (mark: Mark, x: number, y: number, edit = false) => {
  Object.assign(state, {
    currentMark: mark, text: mark.text || (mark.type === 'shape' ? '形状标注' : ''), note: mark.note || '',
    color: mark.color || 'yellow', style: mark.style || 'highlight', shapeType: mark.shapeType || 'rect',
    shapeFilled: mark.filled || false, x, y, isEditing: edit, showCard: true
  })
  if (edit) nextTick(() => noteRef.value?.focus())
}
const closeAll = () => {
  props.ttsController?.cancelLoop()
  currentSelection = null
  sendSearch.value = ''
  sendDocs.value = []
  Object.assign(state, { showMenu: false, showCard: false, showTranslate: false, showSendMenu: false, isEditing: false, selection: null, currentMark: null })
}

// 形状标注点击处理（PDF）
const showShapeCard = (shape: any, pdfViewer: any) => {
  if(quickMarkCooldown)return
  const el = document.querySelector(`.pdf-shape-layer[data-page="${shape.page}"]`)
  if (!el || !pdfViewer) return
  const r = el.getBoundingClientRect()
  const page = pdfViewer.getPages().get(shape.page)
  if (!page) return
  const viewport = page.getViewport({ scale: pdfViewer.getScale(), rotation: pdfViewer.getRotation() })
  const [x1, y1, x2, y2] = shape.rect
  const b1 = viewport.convertToViewportRectangle([x1, y1, x1, y1])
  const b2 = viewport.convertToViewportRectangle([x2, y2, x2, y2])
  const x = r.left + (b1[0] + b2[0]) / 2
  const y = r.top + Math.max(b1[1], b2[1]) + 10
  showCard(shape, x, y, false)
}

// PDF 文本标注点击处理
const showAnnotationCard = (annotation: any) => {
  if(quickMarkCooldown)return
  const el = document.querySelector(`[data-id="${annotation.id}"]`)
  if (!el) return
  const r = el.getBoundingClientRect()
  showCard(annotation, r.left + r.width / 2, r.bottom, false)
}

// 工具函数：获取坐标（iframe转换）
const getCoords = (rect: DOMRect, doc: Document) => {
  const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null
  if (!iframe) return { x: rect.left, y: rect.top }
  const ir = iframe.getBoundingClientRect()
  return { x: (rect.left > ir.width ? rect.left % ir.width : rect.left) + ir.left, y: rect.top + ir.top }
}

// EPUB 文本选择检测
const checkSelection = (doc?: Document, e?: MouseEvent) => {
  if (e && (e.target as HTMLElement).closest('.mark-card,.mark-selection-menu,[data-note-marker]')) return
  
  const processSelection = (doc: Document, index?: number) => {
    const sel = doc.defaultView?.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      state.selection && (props.ttsController?.cancelLoop(), state.selection = null)
      return false
    }
    try {
      const range = sel.getRangeAt(0), rect = range.getBoundingClientRect()
      const { x, y } = getCoords(rect, doc)
      const text = sel.toString().trim()
      const cfi = index !== undefined ? props.reader?.getView().getCFI(index, range) : undefined
      
      currentSelection = { text, cfi }
      showMenu({ text, location: { format: props.pdfViewer ? 'pdf' : 'epub', cfi } }, x + (index === undefined ? rect.width / 2 : 0), y)
      return true
    } catch (err) {
      return false
    }
  }
  
  if (props.reader) {
    const c = props.reader.getView().renderer?.getContents?.()
    if (!c) return
    for (const { doc, index } of c) if (processSelection(doc, index)) return
  } else if (props.currentView && doc && processSelection(doc)) return
}

// EPUB 标注点击监听器
const setupAnnotationListeners = () => {
  if (!props.reader || !props.manager) return
  props.reader.getView().addEventListener('show-annotation', ((e: CustomEvent) => {
    if(quickMarkCooldown)return
    const { value, range } = e.detail
    const mark = props.manager?.getAll().find(m => m.cfi === value)
    if (!mark) return
    try {
      const rect = range.getBoundingClientRect()
      const { x, y } = getCoords(rect, range.startContainer.ownerDocument)
      showCard(mark, x, y + rect.height + 10, false)
    } catch {}
  }) as EventListener)
}

// 全局编辑事件处理
const handleGlobalEdit = (e: Event) => {
  const d = (e as CustomEvent).detail
  d?.item && showCard(d.item, d.position?.x, d.position?.y, true)
}

// 初始化监听器
const initListeners = () => {
  setupAnnotationListeners()
  window.addEventListener('sireader:edit-mark', handleGlobalEdit)
}

// 清理监听器
const cleanupListeners = () => {
  window.removeEventListener('sireader:edit-mark', handleGlobalEdit)
}

// 生命周期
onMounted(initListeners)
onUnmounted(cleanupListeners)

defineExpose({ showMenu, showCard, closeAll, showShapeCard, showAnnotationCard, checkSelection, setupAnnotationListeners })

// 选择菜单操作
const handleMark=()=>{if(!state.selection)return;Object.assign(state,{currentMark:null,text:state.selection.text,note:'',isEditing:true,showMenu:false,showCard:true});nextTick(()=>noteRef.value?.focus())}
const handleCopy=async(color?:HighlightColor,style?:MarkStyle)=>{if(!state.selection||!props.manager)return;const pos=state.selection.location?.cfi||state.selection.location?.page||state.selection.location?.section;if(!pos)return;const loc=state.selection.location;const mark=await props.manager.addHighlight(pos,state.selection.text.trim(),color||'blue',style||'highlight',loc.rects,loc.textOffset);if(mark)emit('copyMark',mark);if(props.quickMarkMode){quickMarkCooldown=true;setTimeout(()=>quickMarkCooldown=false,300);window.getSelection()?.removeAllRanges()}else closeAll()}
const toggleSendMenu=()=>{state.showSendMenu=!state.showSendMenu;state.showSendMenu&&(sendSearch.value='',sendDocs.value=[])}
const searchSendDocs=async()=>{const k=sendSearch.value.trim();if(!k)return sendDocs.value=[];try{sendDocs.value=await(await import('@/composables/useSetting')).searchDocs(k)}catch{sendDocs.value=[]}}
const createMark=async()=>{if(!state.selection||!props.manager)return null;const pos=state.selection.location?.cfi||state.selection.location?.page||state.selection.location?.section;if(!pos)return null;return await props.manager.addHighlight(pos,state.selection.text.trim(),props.quickMarkColor||'blue',props.quickMarkStyle||'highlight',state.selection.location.rects,state.selection.location.textOffset)}
const handleSendToDoc=async(docId:string)=>{if(props.can&&!props.can('quick-send'))return props.showUpgrade?.('快捷发送');if(!docId)return;const mark=await createMark();if(mark)await(await import('@/utils/copy')).sendMarkToDoc(mark,docId,{bookUrl:(window as any).__currentBookUrl||'',isPdf:isPdf.value,showMsg:(m:string,t?:string)=>showMessage(m,t==='error'?2000:1500,t as any),i18n:props.i18n,marks:props.manager});closeAll()}
const handleCopyText=()=>{if(!state.selection)return;navigator.clipboard.writeText(state.selection.text).then(()=>showMessage(props.i18n?.copied||'已复制',1000));closeAll()}
const handleSpeak=()=>{if(!state.selection||!props.ttsController)return;if(props.can&&!props.can('tts'))return props.showUpgrade?.('TTS朗读');props.ttsController.speak(state.selection.text,props.ttsConfig);state.showMenu=false}
const handleDict=async()=>{if(!state.selection)return;const{openDict}=await import('@/utils/dictionary');openDict(state.selection.text,state.x,state.y,{text:state.selection.text,cfi:state.selection.location?.cfi,section:state.selection.location?.section,page:state.selection.location?.page,rects:state.selection.location?.rects});state.showMenu=false}
const handleTranslate=()=>{if(props.can&&!props.can('translate'))return props.showUpgrade?.('翻译');state.showMenu=false;state.showTranslate=true}

// 卡片操作
const handleEdit=()=>{state.isEditing=true;nextTick(()=>noteRef.value?.focus())}
const handleCopyMark=()=>state.currentMark?emit('copyMark',state.currentMark):emit('copy',state.text)
const handleOpenBlock=()=>state.currentMark?.blockId&&openBlock(state.currentMark.blockId)
const handleShowFloat=(e:MouseEvent)=>state.currentMark?.blockId&&showFloat(state.currentMark.blockId,e.target as HTMLElement)
const goToMark=()=>{state.currentMark&&(jump(state.currentMark,(window as any).__activeView,(window as any).__activeReader,props.manager),closeAll())}

const handleSave=async()=>{
  if(!props.manager)return
  try{
    if(state.currentMark){
      const updates:any={note:state.note.trim()||undefined,color:state.color}
      if(state.currentMark.type==='shape')Object.assign(updates,{shapeType:state.shapeType,filled:state.shapeFilled})
      else Object.assign(updates,{text:state.text.trim(),style:state.style})
      const{saveMarkEdit}=await import('@/utils/copy')
      await saveMarkEdit(state.currentMark,updates,{marks:props.manager,bookUrl:(window as any).__currentBookUrl||'',isPdf:isPdf.value,reader:(window as any).__activeReader,pdfViewer:(window as any).__activeView?.viewer,shapeCache:new Map()})
      showMessage(props.i18n?.saved||'已保存',1000)
      state.isEditing=false
      handleCopyMark()
    }else if(state.selection){
      const pos=state.selection.location?.cfi||state.selection.location?.page||state.selection.location?.section
      if(!pos)return showMessage('无法获取位置信息',2000,'error')
      const loc=state.selection.location,args=[pos,state.text.trim(),state.color,state.style,loc.rects,loc.textOffset]
      const mark=state.note.trim()?await props.manager.addNote(pos,state.note.trim(),...args.slice(1)):await props.manager.addHighlight(...args)
      if(mark)emit('copyMark',mark)
      closeAll()
    }
  }catch(e){showMessage(props.i18n?.saveError||'保存失败',2000,'error')}
}

const handleDelete = async () => {
  if (!props.manager || !state.currentMark) return
  try {
    await props.manager.deleteMark(state.currentMark)?(showMessage(props.i18n?.deleted||'已删除',1000),closeAll()):showMessage('删除失败：未找到标注',2000,'error')
  } catch (e) {
    showMessage(props.i18n?.deleteError||'删除失败', 2000, 'error')
  }
}

const handleCancel=()=>{state.currentMark?Object.assign(state,{text:state.currentMark.text||'',note:state.currentMark.note||'',color:state.currentMark.color||'yellow',style:state.currentMark.style||'highlight',isEditing:false}):closeAll()}

const handleImport = async () => {
  if (!state.currentMark) return
  const { importMark } = await import('@/utils/copy')
  await importMark(state.currentMark, { bookUrl: (window as any).__currentBookUrl||'', isPdf: isPdf.value, showMsg: (m: string, t?: string) => showMessage(m, t==='error'?2000:1500, t as any), i18n: props.i18n, marks: props.manager })
}
</script>

<style scoped lang="scss">
@use './deck/deck.scss';
.mark-overlay{position:fixed;inset:0;z-index:949;background:transparent}
.mark-menu{position:fixed;z-index:950;display:flex;gap:4px;padding:6px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);button{width:32px;height:32px;padding:0;border:none;background:transparent;border-radius:6px;cursor:pointer;transition:all .15s;color:var(--b3-theme-on-surface);display:flex;align-items:center;justify-content:center;svg{width:16px;height:16px}&:hover{background:var(--b3-list-hover);color:var(--b3-theme-primary)}}}
.send-menu{flex-direction:column;width:280px;max-height:400px;overflow-y:auto;button{width:100%;height:auto;padding:8px;justify-content:flex-start;border-radius:0;border-bottom:1px solid var(--b3-border-color);font-size:12px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;&:last-child{border-bottom:none}}}
.send-input{margin:8px;width:calc(100% - 16px)}
.send-empty{padding:16px 8px;text-align:center;color:var(--b3-theme-on-surface-variant);font-size:12px;opacity:.6}
.send-item{&:hover{background:var(--b3-list-hover)}}
.sr-card{position:fixed;z-index:950;width:340px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.1)}
.sr-main{padding:12px;border-left:4px solid;border-radius:8px}
.sr-title{font-size:14px;font-weight:500;line-height:1.6;color:var(--b3-theme-on-surface);margin-bottom:8px;cursor:pointer;&[contenteditable]{font-size:14px;font-weight:600}}
.sr-note{font-size:14px;color:var(--b3-theme-on-surface);line-height:1.6;margin-bottom:8px;cursor:text}
.sr-btns{display:flex;gap:8px;button{width:32px;height:32px;padding:0;border:none;background:transparent;border:1px solid var(--b3-border-color);border-radius:4px;cursor:pointer;transition:all .15s;color:var(--b3-theme-on-surface);display:flex;align-items:center;justify-content:center;svg{width:14px;height:14px}&:hover{background:var(--b3-list-hover);border-color:var(--b3-theme-primary);color:var(--b3-theme-primary)}}}
.sr-note-input{width:100%;min-height:60px;padding:8px;border:1px solid var(--b3-border-color);border-radius:4px;font-size:14px;line-height:1.6;resize:vertical;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);margin-bottom:8px;&:focus{outline:none;border-color:var(--b3-theme-primary)}}
.sr-options{margin-bottom:12px}
.sr-colors{display:flex;gap:6px;margin-bottom:8px}
.sr-color-btn{width:28px;height:28px;border:2px solid transparent;border-radius:50%;cursor:pointer;transition:all .15s;padding:0;&.active{border-color:var(--b3-theme-on-surface);transform:scale(1.1);box-shadow:0 2px 8px rgba(0,0,0,.2)}&:hover{transform:scale(1.05)}}
.sr-styles{display:flex;gap:4px;.toolbar-divider{width:1px;height:24px;background:var(--b3-border-color);margin:0 4px}}
.sr-style-btn{width:36px;height:32px;display:flex;align-items:center;justify-content:center;border:1px solid var(--b3-border-color);background:transparent;border-radius:4px;cursor:pointer;transition:all .15s;color:var(--b3-theme-on-surface);.sr-style-icon{display:inline-block;font-size:14px;font-weight:500;line-height:1.4;padding:4px 0;min-width:16px;text-align:center;&[data-type="highlight"]{background:#ffeb3b;padding:2px 4px}&[data-type="underline"]{border-bottom:2px solid currentColor;padding-bottom:2px}&[data-type="outline"]{border:2px solid currentColor;padding:2px 4px}&[data-type="dotted"]{border-bottom:2px dotted currentColor;padding-bottom:2px}&[data-type="dashed"]{border-bottom:2px dashed currentColor;padding-bottom:2px}&[data-type="double"]{border-bottom:4px double currentColor;padding-bottom:1px}&[data-type="squiggly"]{text-decoration:underline wavy;text-decoration-thickness:2px;text-underline-offset:2px}}&.active{background:var(--b3-theme-primary-lightest);border-color:var(--b3-theme-primary);color:var(--b3-theme-primary)}&:hover{background:var(--b3-list-hover)}}
.sr-actions{display:flex;gap:8px;button{padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;transition:all .15s;border:1px solid var(--b3-border-color);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);&:hover{background:var(--b3-list-hover)}&.primary{background:var(--b3-theme-primary);color:white;border-color:var(--b3-theme-primary);&:hover{opacity:.9}}}}
</style>
