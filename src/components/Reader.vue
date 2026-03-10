<template>
  <div ref="containerRef" class="reader-container" tabindex="0" :style="{'--toolbar-opacity':1-((currentSettings?.toolbarOpacity??70)/100)}">
    <div v-if="loading" class="reader-loading"><div class="spinner"></div><div>{{ error || '加载中...' }}</div></div>
    
    <!-- 遮罩：捕获外部点击关闭弹窗 -->
    <div v-if="(showToc||showSearch)&&!loading" class="reader-overlay" @click="showToc=false;showSearch=false"/>
    
    <!-- PDF 工具栏 -->
    <PdfToolbar v-if="isPdfMode&&pdfViewer&&pdfSearcher" :viewer="pdfViewer" :searcher="pdfSearcher" :file-size="pdfSource?.byteLength" :fixed="pdfToolbarFixed" @print="handlePrint" @download="handleDownload" @export-images="handleExportImages" @ink-toggle="handleInkToggle" @ink-color="handleInkColor" @ink-width="handleInkWidth" @ink-undo="handleInkUndo" @ink-clear="handleInkClear" @ink-eraser="handleInkEraser" @shape-toggle="handleShapeToggle" @shape-type="handleShapeType" @shape-color="handleShapeColor" @shape-width="handleShapeWidth" @shape-filled="handleShapeFilled" @shape-undo="handleShapeUndo" @shape-clear="handleShapeClear"/>
    
    <div ref="viewerContainerRef" class="viewer-container" :class="{'has-pdf-toolbar':isPdfMode,'has-fixed-toolbar':isPdfMode&&pdfToolbarFixed}"></div>
    
    <!-- 目录弹窗 -->
    <Transition name="toc-popup">
      <div v-if="showToc&&!loading" class="reader-toc-popup" @click.stop>
        <ReaderToc v-model:mode="tocMode" :i18n="i18n" />
      </div>
    </Transition>
    
    <!-- 底部工具栏组 -->
    <div v-if="!loading" class="reader-toolbar-group">
      <div v-if="showSearch" class="reader-panel" @click.stop>
        <input v-model="searchQuery" class="search-input" :placeholder="i18n.searchPlaceholder||'搜索...'" @keydown.enter="handleSearch" @keydown.esc="showSearch=false" ref="searchInputRef">
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" @click="handleSearch" aria-label="搜索"><svg><use xlink:href="#iconSearch"/></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" @click="handleSearchPrev" :disabled="!hasSearchResults" aria-label="上一个"><svg><use xlink:href="#iconUp"/></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" @click="handleSearchNext" :disabled="!hasSearchResults" aria-label="下一个"><svg><use xlink:href="#iconDown"/></svg></button>
        <span class="search-count">{{ searchCount }}</span>
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" @click="handleSearchClear" aria-label="清除"><svg><use xlink:href="#iconClose"/></svg></button>
      </div>
      
      <div v-if="showQuickMark" class="reader-panel" @click.stop>
        <div class="mark-colors">
          <button v-for="(c,i) in COLORS" :key="c.color" class="mark-color-btn" :class="{active:quickMarkColor===i}" :style="{background:c.bg}" @click="quickMarkColor=i"/>
        </div>
        <span class="panel-divider"/>
        <div class="mark-styles">
          <button v-for="s in STYLES.filter(s=>(!s.pdfOnly||isPdfMode)&&(!s.epubOnly||!isPdfMode))" :key="s.type" class="mark-style-btn" :class="{active:quickMarkStyle===s.type}" @click="quickMarkStyle=s.type">
            <span :data-type="s.type">{{s.text}}</span>
          </button>
        </div>
      </div>
      
      <div class="reader-toolbar">
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" @click.stop="handlePrev" :aria-label="i18n.prevChapter||'上一章'"><svg><use xlink:href="#iconLeft"/></svg></button>
        <div v-if="isPdfMode" class="toolbar-page-nav" @click.stop>
          <input v-model.number="pageInput" @keydown.enter="handlePageJump" type="number" :min="1" :max="totalPages" class="page-input">
          <span class="page-total">/ {{totalPages}}</span>
        </div>
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" @click.stop="handleNext" :aria-label="i18n.nextChapter||'下一章'"><svg><use xlink:href="#iconRight"/></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" @click.stop="openToc" :aria-label="i18n.toc||'目录'"><svg><use xlink:href="#iconList"/></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" :class="{active:hasBookmark}" @click.stop="toggleBookmark" :aria-label="hasBookmark?(i18n.removeBookmark||'删除书签'):(i18n.addBookmark||'添加书签')"><svg><use xlink:href="#iconBookmark"/></svg></button>
        <button class="toolbar-btn b3-tooltips b3-tooltips__n" :class="{active:showSearch}" @click.stop="toggleSearch" :aria-label="i18n.search||'搜索'"><svg><use xlink:href="#iconSearch"/></svg></button>
        <button class="toolbar-btn toolbar-mark-btn b3-tooltips b3-tooltips__n" :class="{active:quickMarkMode}" @click.stop="toggleQuickMark" :aria-label="quickMarkMode?'退出快速标注':'快速标注'">
          <svg><use xlink:href="#iconMark"/></svg>
          <span class="mark-indicator" :style="{background:COLORS[quickMarkColor].bg}"></span>
        </button>
        <button v-if="ttsEnabled" class="toolbar-btn b3-tooltips b3-tooltips__n" :class="{active:ttsPlaying}" @click.stop="toggleTTS" :aria-label="ttsPlaying?(i18n.ttsPause||'暂停朗读'):(i18n.ttsPlay||'开始朗读')"><svg><use :xlink:href="ttsPlaying?'#iconPause':'#iconPlay'"/></svg></button>
        <button v-if="isMobile()" class="toolbar-btn b3-tooltips b3-tooltips__n" @click.stop="handleClose" aria-label="关闭"><svg><use xlink:href="#iconClose"/></svg></button>
      </div>
    </div>
  </div>
  
  <!-- 统一标注弹窗 -->
  <MarkPanel ref="markPanelRef" :manager="markManager" :pdf-viewer="pdfViewer" :reader="reader" :current-view="currentView" :i18n="i18n" :tts-controller="ttsController" :tts-config="currentSettings?.tts" :quick-mark-mode="quickMarkMode" :quick-mark-color="COLORS[quickMarkColor].color" :quick-mark-style="quickMarkStyle" :can="can" :show-upgrade="showUpgrade" @copy="(text,sel)=>handleCopy({text,cfi:sel?.cfi,page:sel?.page,section:sel?.section,rects:sel?.rects,textOffset:sel?.textOffset})" @dict="handleOpenDict" @copy-mark="handleCopy" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { showMessage } from 'siyuan'
import type { Plugin } from 'siyuan'
import type { ReaderSettings } from '@/composables/useSetting'
import { openDict as openDictDialog } from '@/utils/dictionary'
import { createReader, type FoliateReader, setActiveReader, clearActiveReader } from '@/core/epub'
import type { FoliateView } from '@/core/epub/types'
import { COLORS, STYLES, createMarkManager, type MarkManager } from '@/core/MarkManager'
import { createInkToolManager, type InkToolManager } from '@/core/pdf/ink'
import { createShapeToolManager, type ShapeToolManager } from '@/core/pdf/shape'
import { initPdfAnnotationEvents, initPdfAnnotationRender } from '@/core/pdf/annotation'
import { saveMobilePosition, getMobilePosition, isMobile } from '@/utils/mobile'
import PdfToolbar from './PdfToolbar.vue'
import MarkPanel from './MarkPanel.vue'
import ReaderToc from './ReaderToc.vue'
import { gotoPDF, gotoEPUB, restorePosition as restorePos, initJump } from '@/utils/jump'
import { copyMark as copyMarkUtil } from '@/utils/copy'
import { createKeyboardHandler, setupEpubKeyboard } from '@/utils/keyboard'
import { TTSController } from '@/services/TTSPlayer'
import { useLicense } from '@/composables/useLicense'

const props = defineProps<{ file?: File; plugin: Plugin; settings?: ReaderSettings; url?: string; blockId?: string; bookInfo?: any; onReaderReady?: (r: FoliateReader) => void; i18n?: any }>()

const i18n = computed(() => props.i18n || {})
const { can, showUpgrade } = useLicense(props.plugin, i18n.value)
const currentSettings = ref(props.settings)
const pdfToolbarFixed = computed(() => currentSettings.value?.pdfToolbarStyle === 'fixed')

// 标注面板引用
const markPanelRef = ref()
const markManager = ref<MarkManager | null>(null)

// 监听设置更新
const handleSettingsUpdate = async (e: Event) => {
  const settings = (e as CustomEvent).detail
  currentSettings.value = settings
  ;(window as any).__sireader_settings = settings
  reader?.updateSettings?.(settings)
  pdfViewer.value && await pdfViewer.value.updateTheme(settings)
  await syncTTS()
}

const containerRef = ref<HTMLElement>()
const viewerContainerRef = ref<HTMLElement>()
const loading = ref(true)
const error = ref('')
const hasBookmark = ref(false)

// 触摸滑动翻页
let touchStartX=0,touchStartY=0
const handleTouchStart=(e:TouchEvent)=>{if(!isMobile()||e.touches.length!==1)return;touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY}
const handleTouchEnd=(e:TouchEvent)=>{if(!isMobile()||!touchStartX)return;const dx=e.changedTouches[0].clientX-touchStartX,dy=e.changedTouches[0].clientY-touchStartY;if(Math.abs(dy)>Math.abs(dx)||Math.abs(dx)<50)return;dx>0?handlePrev():handleNext();touchStartX=0;touchStartY=0}

const pdfViewer = ref<any>(null)
const pdfSearcher = ref<any>(null)
const currentView = ref<any>(null)
const pageInput = ref(1)
const totalPages = ref(0)
const showSearch = ref(false)
const showToc = ref(false)
const showQuickMark = ref(false)
const quickMarkMode = ref(false)
const quickMarkColor = ref(0)
const quickMarkStyle = ref<'highlight'|'underline'|'outline'|'dotted'|'dashed'|'double'|'squiggly'>('highlight')
const tocMode = ref<'toc' | 'bookmark' | 'mark' | 'deck'>('toc')
const searchQuery = ref('')
const searchResults = ref<any[]>([])
const searchCurrentIndex = ref(0)
let reader: FoliateReader | null = null
let pdfSource: ArrayBuffer | null = null
let inkToolManager: InkToolManager | null = null
let shapeToolManager: ShapeToolManager | null = null

// TTS
const ttsController = new TTSController()
const ttsEnabled = computed(() => currentSettings.value?.tts?.enabled || false)
const ttsPlaying = computed(() => ttsController.isActive.value && !ttsController.paused.value)
const toggleTTS = () => {if (!can.value('tts')) return showUpgrade('TTS朗读'); ttsController.toggle(() => reader, currentSettings.value?.tts)}
const syncTTS = async () => ttsController.sync(currentSettings.value?.tts?.enabled || false)

// Computed
const marks=computed(()=>markManager.value)
const isPdfMode=computed(()=>!!pdfViewer.value)
const hasSearchResults=computed(()=>searchResults.value.length>0)
const searchCount=computed(()=>{
  if(isPdfMode.value){
    const total=searchResults.value.length
    return total>0?`${searchCurrentIndex.value+1}/${total}`:'0/0'
  }
  return searchResults.value.length>0?`${searchResults.value.length}`:'0'
});

// 初始化
const init=async()=>{
  if(!containerRef.value)return
  try{
    loading.value=true
    error.value=''
    const bookUrl=props.bookInfo?.url||props.url||(props.file?`file://${props.file.name}`:`book-${Date.now()}`)
    ;(window as any).__currentBookUrl=bookUrl
    const isPdf=props.file?.name.endsWith('.pdf')||props.bookInfo?.format==='pdf'
    const{bookshelfManager}=await import('@/core/bookshelf')
    const onProgress=async()=>{updateBookmarkState();await bookshelfManager.updateProgressAuto(bookUrl,reader,pdfViewer.value,currentView.value);updatePageInfo()}
    
    // 统一文件加载
    const loadFile=async()=>{
      if(props.file)return props.file
      const path=props.bookInfo?.path
      if(!path)return null
      return await bookshelfManager.loadFile(path)
    }
    
    if(isPdf){
      const{PDFViewer,PDFSearch}=await import('@/core/pdf')
      const showAnn=(a:any)=>markPanelRef.value?.showAnnotationCard(a)
      const viewer=new PDFViewer({container:viewerContainerRef.value!,scale:1.5,onPageChange:onProgress,onAnnotationClick:showAnn})
      
      // 暴露 PDF 查看器实例给 TTS
      ;(window as any).__pdfViewer = viewer
      ;(viewerContainerRef.value as any).__pdfViewer = viewer
      props.settings&&viewer.applyTheme(props.settings)
      const searcher=new PDFSearch()
      const file=await loadFile()
      pdfSource=file?await file.arrayBuffer():null as any
      if(!pdfSource)throw new Error('未提供PDF文件')
      await viewer.open(pdfSource)
      await viewer.fitWidth()
      searcher.setPDF(viewer.getPDF()!)
      ;(window as any).__pdfDoc=viewer.getPDF()
      searcher.extractAllText().catch(()=>{})
      
      const view=await viewer.createView()
      
      markManager.value=createMarkManager({format:'pdf',plugin:props.plugin,bookUrl,bookName:props.bookInfo?.title||props.file?.name||'book',onAnnotationClick:showAnn,pdfViewer:viewer})
      await markManager.value.init()
      await bookshelfManager.restoreProgress(bookUrl,null,viewer)
      
      currentView.value={...view,isPdf:true,marks:markManager.value}
      pdfViewer.value=viewer
      pdfSearcher.value=searcher
      
      inkToolManager=createInkToolManager(viewerContainerRef.value!,props.plugin,bookUrl,props.bookInfo?.title||props.file?.name||'book',viewer)
      const handleShapeClick=(shape:any)=>markPanelRef.value?.showShapeCard(shape,viewer)
      shapeToolManager=createShapeToolManager(viewerContainerRef.value!,props.plugin,bookUrl,props.bookInfo?.title||props.file?.name||'book',handleShapeClick,viewer)
      await inkToolManager.init()
      await shapeToolManager.init()
      ;(markManager.value as any).inkManager=inkToolManager
      ;(markManager.value as any).shapeManager=shapeToolManager
      updatePageInfo()
      setActiveReader(currentView.value,null,props.settings)
      
      // 初始化PDF标注（事件+渲染）
      const cleanupEvents = initPdfAnnotationEvents(viewerContainerRef.value!,viewer,markManager.value,(data,x,y)=>markPanelRef.value?.showMenu(data,x,y))
      const cleanupRender = initPdfAnnotationRender(viewer,markManager.value,inkToolManager,shapeToolManager)
      
      viewerContainerRef.value!.addEventListener('keydown',handleKeydown)
      currentView.value.cleanup=()=>{
        cleanupEvents()
        cleanupRender()
        viewerContainerRef.value?.removeEventListener('keydown',handleKeydown)
      }
    }else{
      reader=createReader({container:viewerContainerRef.value!,settings:props.settings!,plugin:props.plugin})
      
      // 在线书籍
      if(props.bookInfo?.format==='online'){
        const{loadOnlineBook}=await import('@/core/online')
        await loadOnlineBook(reader,props.bookInfo)
      }else{
        if(props.file){
          await reader.open(props.file)
        }else if(props.url){
          await reader.open(props.url)
        }else{
          const file=await loadFile()
          if(!file)throw new Error('未提供书籍')
          await reader.open(file)
        }
      }
      
      markManager.value=createMarkManager({format:'epub',view:reader.getView(),plugin:props.plugin,bookUrl,bookName:props.bookInfo?.title||props.file?.name||'book',reader})
      await markManager.value.init()
      ;(reader.getView() as any).marks=markManager.value
      await bookshelfManager.restoreProgress(bookUrl,reader,null)
      
      reader.on('relocate',()=>onProgress())
      reader.on('loaded',()=>{
        if(props.bookInfo?.pos?.cfi)initJump(props.bookInfo.pos.cfi)
      })
      setupEpubKeyboard(reader,handleKeydown,(doc,e)=>markPanelRef.value?.checkSelection(doc,e))
      currentView.value=reader.getView()
      setActiveReader(currentView.value,reader,props.settings)
      props.onReaderReady?.(reader)
    }

    await syncTTS()
    
    // 统一设置标注监听
    markPanelRef.value?.setupAnnotationListeners()
  }catch(e){
    error.value=e instanceof Error?e.message:'加载失败'
    markPanelRef.value?.closeAll()
  }finally{
    loading.value=false
    await restorePos(getBookUrl(),reader,pdfViewer.value,getMobilePosition)
  }
}


// 统一复制处理
const handleCopy=(item:any)=>{
  if(typeof item==='string'||!item.id&&item.text){const loc=isPdfMode.value?null:reader?.getLocation();item={text:item.text||item,cfi:item.cfi,page:item.page,chapter:loc?.tocItem?.label||loc?.tocItem?.title,id:''}}
  copyMarkUtil(item,{bookUrl:(window as any).__currentBookUrl||props.bookInfo?.url||props.url||'',bookInfo:props.bookInfo,settings:props.settings,reader,pdfViewer:pdfViewer.value,showMsg:(msg:string)=>showMessage(msg,1000)})
}

// 词典查询处理
const handleOpenDict=(text:string,x:number,y:number,selection:any)=>{
  if(selection)openDictDialog(text,x,y,selection)
}

// 导航
const handlePrev=()=>{
  ttsController.destroy()
  if(isPdfMode.value)return currentView.value?.nav?.prev?.()
  if(reader)return reader.prev()
  if(currentView.value?.prev)return currentView.value.prev()
  currentView.value?.goLeft?.()
}
const handleNext=()=>{
  ttsController.destroy()
  if(isPdfMode.value)return currentView.value?.nav?.next?.()
  if(reader)return reader.next()
  if(currentView.value?.next)return currentView.value.next()
  currentView.value?.goRight?.()
}
const handlePageJump=()=>{ttsController.destroy();const p=Math.max(1,Math.min(totalPages.value,pageInput.value||1));pageInput.value=p;pdfViewer.value?.goToPage(p)}
const updatePageInfo=()=>{if(!pdfViewer.value)return;totalPages.value=pdfViewer.value.getPageCount();pageInput.value=pdfViewer.value.getCurrentPage()}

// 搜索
const searchInputRef=ref<HTMLInputElement>()
const toggleSearch=()=>{showSearch.value=!showSearch.value;if(showSearch.value){showQuickMark.value=false;quickMarkMode.value=false;setTimeout(()=>searchInputRef.value?.focus(),100)}}
const toggleQuickMark=()=>{if(!can.value('quick-mark'))return showUpgrade('快速标注');showQuickMark.value=!showQuickMark.value;if(showQuickMark.value)showSearch.value=false;quickMarkMode.value=showQuickMark.value}
const handleSearch=async()=>{
  if(!searchQuery.value.trim())return
  if(isPdfMode.value&&pdfSearcher.value){
    searchResults.value=await pdfSearcher.value.search(searchQuery.value)
    searchCurrentIndex.value=0
    searchResults.value.length&&pdfViewer.value?.goToPage(pdfSearcher.value.getCurrent().page)
  }else if(reader?.searchManager){
    searchResults.value=[]
    for await(const r of reader.search(searchQuery.value))searchResults.value.push(r)
    searchCurrentIndex.value=searchResults.value.length?0:-1
  }
}
const handleSearchNext=()=>{
  if(isPdfMode.value&&pdfSearcher.value){const r=pdfSearcher.value.next();r&&(searchCurrentIndex.value=pdfSearcher.value.getCurrentIndex(),pdfViewer.value?.goToPage(r.page))}
  else if(reader?.searchManager){const r=reader.nextSearchResult();r&&(searchCurrentIndex.value=reader.searchManager.getCurrentIndex())}
}
const handleSearchPrev=()=>{
  if(isPdfMode.value&&pdfSearcher.value){const r=pdfSearcher.value.prev();r&&(searchCurrentIndex.value=pdfSearcher.value.getCurrentIndex(),pdfViewer.value?.goToPage(r.page))}
  else if(reader?.searchManager){const r=reader.prevSearchResult();r&&(searchCurrentIndex.value=reader.searchManager.getCurrentIndex())}
}
const handleSearchClear=()=>{searchQuery.value='';searchResults.value=[];searchCurrentIndex.value=0;pdfSearcher.value?.clear();reader?.clearSearch();showSearch.value=false}

// PDF 工具栏
const handlePrint=async()=>{if(pdfViewer.value){const{printPDF}=await import('@/core/pdf');await printPDF(pdfViewer.value.getPDF()!)}}
const handleDownload=async()=>{if(pdfSource){const{downloadPDF}=await import('@/core/pdf');await downloadPDF(pdfSource,props.file?.name||props.bookInfo?.title||'document.pdf')}}
const handleExportImages=async()=>{if(pdfViewer.value){const{exportAsImages}=await import('@/core/pdf');await exportAsImages(pdfViewer.value.getPDF()!)}}

// 墨迹工具
const handleInkToggle=async(a:boolean)=>{a&&await shapeToolManager?.toggle(false);await inkToolManager?.toggle(a)}
const handleInkColor=async(c:string)=>inkToolManager?.setConfig({color:c})
const handleInkWidth=async(w:number)=>inkToolManager?.setConfig({width:w})
const handleInkEraser=async(a:boolean)=>inkToolManager?.setConfig(a?{color:'#fff',width:20}:{color:'#f00',width:2})
const handleInkUndo=async()=>inkToolManager?.undo()
const handleInkClear=async()=>inkToolManager?.clear()

// 形状工具
const handleShapeToggle=async(a:boolean)=>{a&&await inkToolManager?.toggle(false);await shapeToolManager?.toggle(a)}
const handleShapeType=async(t:string)=>shapeToolManager?.setConfig({shapeType:t})
const handleShapeColor=async(c:string)=>shapeToolManager?.setConfig({color:c})
const handleShapeWidth=async(w:number)=>shapeToolManager?.setConfig({width:w})
const handleShapeFilled=async(f:boolean)=>shapeToolManager?.setConfig({filled:f})
const handleShapeUndo=async()=>{const p=pdfViewer.value?.getCurrentPage();p&&await shapeToolManager?.undo(p)}
const handleShapeClear=async()=>{const p=pdfViewer.value?.getCurrentPage();p&&await shapeToolManager?.clear(p)}

// 进度保存 & 书签
const updateBookmarkState=()=>hasBookmark.value=!!markManager.value?.hasBookmark?.()
const toggleBookmark=()=>{try{hasBookmark.value=marks.value?.toggleBookmark?.()}catch(e:any){showMessage(e.message||'操作失败',2000,'error')}}

// 位置管理
const getBookUrl=()=>(window as any).__currentBookUrl||props.bookInfo?.url||props.url||''
const savePosition=()=>{if(isMobile()){const url=getBookUrl();url&&saveMobilePosition(url,isPdfMode.value?{page:pdfViewer.value?.getCurrentPage()}:{cfi:reader?.getLocation()?.cfi})}}

// 打开目录/关闭
const openToc=()=>showToc.value=!showToc.value
const handleClose=()=>{savePosition();window.dispatchEvent(new CustomEvent('reader:close'))}

// 快捷键处理
const handlePdfZoomIn=()=>pdfViewer.value?.setScale(pdfViewer.value.getScale()+.25)
const handlePdfZoomOut=()=>pdfViewer.value?.setScale(pdfViewer.value.getScale()-.25)
const handlePdfZoomReset=()=>pdfViewer.value?.setScale(1.5)
const handlePdfRotate=()=>pdfViewer.value?.setRotation(((pdfViewer.value.getRotation()+90)%360)as 0|90|180|270)
const handlePdfSearch=()=>window.dispatchEvent(new CustomEvent('pdf:toggle-search'))
const handlePdfFirstPage=()=>pdfViewer.value?.goToPage(1)
const handlePdfLastPage=()=>pdfViewer.value?.goToPage(pdfViewer.value.getPageCount())
const handlePdfPageUp=()=>handlePrev()
const handlePdfPageDown=()=>handleNext()

const handleGoto=(e:CustomEvent)=>{ttsController.destroy();const{cfi,id}=e.detail;if(isPdfMode.value){if(cfi?.startsWith('#page-'))gotoPDF(parseInt(cfi.slice(6)),id,pdfViewer.value,markManager.value,shapeToolManager);else if(cfi&&/^\d+$/.test(cfi))gotoPDF(parseInt(cfi),id,pdfViewer.value,markManager.value,shapeToolManager)}else if(cfi)gotoEPUB(cfi,id,reader,markManager.value)}

// 快捷键
const handleUndo=()=>markManager.value?.undo()
const handleKeydown=createKeyboardHandler({handlePrev,handleNext,handleUndo,handlePdfFirstPage,handlePdfLastPage,handlePdfPageUp,handlePdfPageDown,handlePdfRotate,handlePdfZoomIn,handlePdfZoomOut,handlePdfZoomReset,handlePdfSearch,handlePrint},()=>!!pdfViewer.value)

// 生命周期
const events=[['sireaderSettingsUpdated',handleSettingsUpdate],['sireader:goto',handleGoto],['sireader:toggleBookmark',toggleBookmark],['sireader:prevPage',handlePrev],['sireader:nextPage',handleNext],['sireader:pdfZoomIn',handlePdfZoomIn],['sireader:pdfZoomOut',handlePdfZoomOut],['sireader:pdfZoomReset',handlePdfZoomReset],['sireader:pdfRotate',handlePdfRotate],['sireader:pdfSearch',handlePdfSearch],['sireader:pdfPrint',handlePrint],['sireader:pdfFirstPage',handlePdfFirstPage],['sireader:pdfLastPage',handlePdfLastPage],['sireader:pdfPageUp',handlePdfPageUp],['sireader:pdfPageDown',handlePdfPageDown]]as const

const suppressError=(e:PromiseRejectionEvent)=>/createTreeWalker|destroy/.test(e.reason?.message||'')&&e.preventDefault()

const setupTabObserver=()=>{if(isMobile())return;let el=containerRef.value?.parentElement;while(el){if(el.hasAttribute('data-id')){const h=document.querySelector(`li[data-type="tab-header"][data-id="${el.getAttribute('data-id')}"]`);if(h){const obs=new MutationObserver(ms=>ms.forEach(m=>m.type==='attributes'&&m.attributeName==='class'&&(m.target as HTMLElement).classList.contains('item--focus')&&(setActiveReader(currentView.value,reader,props.settings),window.dispatchEvent(new CustomEvent('sireader:tab-switched')))));obs.observe(h,{attributes:true,attributeFilter:['class']});(containerRef.value as any).__observer=obs}break}el=el.parentElement}}

// 形状创建后自动显示编辑窗口
const handleShapeCreated=(e:CustomEvent)=>{const{shape,x,y,edit}=e.detail;markPanelRef.value&&edit&&markPanelRef.value.showCard(shape,x,y,true)}

onMounted(() => {
  // 清理之前可能的全局状态
  clearActiveReader()
  // 清理可能的全局变量
  ;(window as any).__sireader_active_view = null
  ;(window as any).__sireader_active_reader = null
  ;(window as any).__sireader_settings = null
  ;(window as any).__currentBookUrl = null
  ;(window as any).__pdfViewer = null
  ;(window as any).__pdfDoc = null
  
  init()
  containerRef.value?.focus()
  
  events.forEach(([e, h]) => window.addEventListener(e, h as any))
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('unhandledrejection', suppressError)
  window.addEventListener('shape-created', handleShapeCreated as any)
  
  setupTabObserver()
  
  if (isMobile() && containerRef.value) {
    containerRef.value.addEventListener('touchstart', handleTouchStart)
    containerRef.value.addEventListener('touchend', handleTouchEnd)
  }
  
  const bookUrl = props.bookInfo?.url || props.url || (props.file ? `file://${props.file.name}` : `book-${Date.now()}`)
  window.dispatchEvent(new CustomEvent('reader:open', { detail: { bookUrl } }))
})

onUnmounted(async () => {
  window.dispatchEvent(new CustomEvent('reader:close'))
  savePosition()
  
  // 清理全局状态
  clearActiveReader()
  // 清理全局变量
  ;(window as any).__sireader_active_view = null
  ;(window as any).__sireader_active_reader = null
  ;(window as any).__sireader_settings = null
  ;(window as any).__currentBookUrl = null
  ;(window as any).__pdfViewer = null
  ;(window as any).__pdfDoc = null
  
  // 清理资源
  await markManager.value?.destroy()
  try {
    reader?.destroy()
    currentView.value?.cleanup?.()
    currentView.value?.viewer?.destroy?.()
  } catch {}
  
  inkToolManager?.destroy?.()
  shapeToolManager?.destroy?.()
  ttsController.destroy()
  
  // 清理DOM和事件监听器
  setTimeout(() => {
    if (viewerContainerRef.value) {
      viewerContainerRef.value.innerHTML = ''
      // 清理可能的ResizeObserver引用
      const view = viewerContainerRef.value.querySelector('foliate-view')
      if (view) {
        const observer = (view as any).__resizeObserver
        if (observer) observer.disconnect()
      }
    }
  }, 50)
  
  events.forEach(([e, h]) => window.removeEventListener(e, h as any))
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('unhandledrejection', suppressError)
  window.removeEventListener('shape-created', handleShapeCreated as any)
  
  containerRef.value && (containerRef.value as any).__observer?.disconnect()
  
  if (isMobile() && containerRef.value) {
    containerRef.value.removeEventListener('touchstart', handleTouchStart)
    containerRef.value.removeEventListener('touchend', handleTouchEnd)
  }
})
</script>

<style scoped lang="scss">
.reader-container{position:relative;width:100%;height:100%;outline:none;user-select:text;-webkit-user-select:text;isolation:isolate;display:flex;flex-direction:column;background:var(--b3-theme-background)}
.reader-overlay{position:fixed;inset:0;z-index:999;background:transparent}
.viewer-container{flex:1;position:relative;overflow:auto;background:var(--b3-theme-background);
  &.has-fixed-toolbar{padding-top:40px}
}
.reader-loading{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:16px;color:var(--b3-theme-on-background);z-index:10;pointer-events:none}
.spinner{width:48px;height:48px;border:4px solid var(--b3-theme-primary-lighter);border-top-color:var(--b3-theme-primary);border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.reader-toolbar-group{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:1001;&:hover>*{opacity:1}}
.reader-toolbar,.reader-panel{display:flex;align-items:center;gap:2px;padding:3px 4px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:6px;box-shadow:0 2px 8px #0002;opacity:var(--toolbar-opacity);transition:opacity .2s}
.toolbar-btn{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:4px;cursor:pointer;transition:all .15s;svg{width:14px;height:14px}&:hover{background:var(--b3-list-hover)}&.active{background:var(--b3-theme-primary-lightest);color:var(--b3-theme-primary)}}
.toolbar-mark-btn{position:relative;.mark-indicator{position:absolute;right:2px;bottom:2px;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--b3-theme-surface);box-shadow:0 0 0 .5px var(--b3-border-color)}}
.toolbar-page-nav{display:flex;align-items:center;gap:3px;padding:0 4px;font-size:11px;color:var(--b3-theme-on-surface)}
.page-input{width:36px;height:22px;padding:0 3px;border:none;background:var(--b3-theme-background-light);color:var(--b3-theme-on-surface);font-size:11px;text-align:center;border-radius:3px;transition:background .15s;&:focus{outline:none;background:var(--b3-theme-background)}&::-webkit-inner-spin-button,&::-webkit-outer-spin-button{display:none}}
.page-total{opacity:.7}
.search-input{width:160px;height:22px;padding:0 6px;border:none;background:var(--b3-theme-background-light);color:var(--b3-theme-on-surface);font-size:11px;border-radius:3px;transition:background .15s;&:focus{outline:none;background:var(--b3-theme-background)}}
.search-count{font-size:11px;color:var(--b3-theme-on-surface-variant);min-width:40px;text-align:center;opacity:.7}
.panel-divider{width:1px;height:20px;background:var(--b3-border-color)}
.mark-colors,.mark-styles{display:flex;gap:3px}
.mark-color-btn{width:24px;height:24px;border:2px solid transparent;border-radius:50%;cursor:pointer;transition:all .15s;padding:0;&.active{border-color:var(--b3-theme-on-surface);transform:scale(1.1)}&:hover{transform:scale(1.05)}}
.mark-style-btn{width:28px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid var(--b3-border-color);background:transparent;border-radius:4px;cursor:pointer;transition:all .15s;color:var(--b3-theme-on-surface);font-size:12px;font-weight:600;&.active{background:var(--b3-theme-primary-lightest);border-color:var(--b3-theme-primary);color:var(--b3-theme-primary)}&:hover{background:var(--b3-list-hover)}span[data-type="underline"]{text-decoration:underline}span[data-type="outline"]{border:1px solid currentColor;padding:0 2px}span[data-type="dotted"]{border-bottom:2px dotted currentColor}span[data-type="dashed"]{border-bottom:2px dashed currentColor}span[data-type="double"]{border-bottom:3px double currentColor}span[data-type="squiggly"]{text-decoration:underline wavy}}
.reader-toc-popup{position:absolute;bottom:60px;left:50%;transform:translateX(-50%);width:min(360px,90vw);max-height:min(480px,70vh);background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:0 4px 20px #0003;z-index:1002;overflow:hidden;display:flex;flex-direction:column}
.toc-popup-enter-active,.toc-popup-leave-active{transition:all .2s}
.toc-popup-enter-from,.toc-popup-leave-to{opacity:0;transform:translate(-50%,10px)}
</style>

<style>
/* PDF 文本层选择优化 */
.textLayer{position:absolute;inset:0;line-height:1;overflow:clip;opacity:1;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;z-index:0}
.textLayer span{color:transparent;cursor:text;position:absolute;white-space:pre;transform-origin:0% 0%;z-index:1}
.textLayer::selection{background:rgba(0,150,255,0.6) !important}
.textLayer::-moz-selection{background:rgba(0,150,255,0.6) !important}
.textLayer.selecting{cursor:text}
.endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;user-select:none}
.textLayer.selecting .endOfContent{top:0}

/* PDF 搜索高亮 */
.textLayer mark.pdf-search-hl{background:#ff06;border-radius:2px}
.textLayer mark.pdf-search-current{background:#ff9800;color:#fff;box-shadow:0 0 0 2px #ff9800}

/* 选择模式下标注透明，避免阻挡文本选择 */
.pdf-selecting .pdf-highlight{pointer-events:none !important}
.pdf-selecting [data-note-marker]{pointer-events:none !important}

/* 标注闪烁动画 */
.pdf-highlight--flash{animation:flash 1.2s ease-in-out 1}
@keyframes flash{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.3;transform:scale(1.05)}
}
</style>