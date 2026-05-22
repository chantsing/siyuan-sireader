<template>
  <div ref="containerRef" class="reader-container" tabindex="0" :style="{'--toolbar-opacity':(1-((currentSettings?.toolbarOpacity??70)/100))*.55}">
    <ReaderSplash v-if="showOpeningSplash" ref="readerSplashRef" :book-info="props.bookInfo" :file-name="props.file?.name" status="opening" />
    <div v-if="loading" class="reader-loading"><div class="spinner"></div><div>{{ error || '加载中...' }}</div></div>
    <div v-if="(showToc||showSearch)&&!loading" class="reader-overlay" @click="closePanels"/>
    <PdfToolbar v-if="isPdfMode&&pdfViewer&&pdfSearcher" :viewer="pdfViewer" :searcher="pdfSearcher" :file-size="pdfSource?.byteLength" :fixed="pdfToolbarFixed" :settings="currentSettings?.pdfToolbar" @update-settings="handlePdfToolbarSettingsUpdate" @print="handlePrint" @download="handleDownload" @export-images="handleExportImages" @ink-toggle="handleInkToggle" @ink-color="handleInkColor" @ink-width="handleInkWidth" @ink-undo="handleInkUndo" @ink-clear="handleInkClear" @ink-eraser="handleInkEraser" @shape-toggle="handleShapeToggle" @shape-type="handleShapeType" @shape-color="handleShapeColor" @shape-width="handleShapeWidth" @shape-filled="handleShapeFilled" @shape-undo="handleShapeUndo" @shape-clear="handleShapeClear"/>
    <div ref="viewerContainerRef" class="viewer-container" :class="{'has-pdf-toolbar':isPdfMode,'has-fixed-toolbar':isPdfMode&&pdfToolbarFixed}"></div>
    <Transition name="toc-popup">
      <div v-if="showToc&&!loading" class="reader-toc-popup" @click.stop>
        <DockShell :active-tab="tocMode" nav-position="top" :tabs="tocTabs" @update:activeTab="tocMode = $event as any">
          <component :is="tocPane" v-bind="tocPaneProps" />
        </DockShell>
      </div>
    </Transition>
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
      <div class="reader-toolbar" :class="{'is-visible':toolbarVisible}">
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
  <MarkPanel ref="markPanelRef" :manager="markManager" :pdf-viewer="pdfViewer" :reader="reader" :current-view="currentView" :i18n="i18n" :tts-controller="ttsController" :tts-config="currentSettings?.tts" :quick-mark-mode="quickMarkMode" :quick-mark-color="COLORS[quickMarkColor].color" :quick-mark-style="quickMarkStyle" :can="can" :show-upgrade="showUpgrade" @copy="(text,sel)=>handleCopy({text,cfi:sel?.cfi,page:sel?.page,section:sel?.section,rects:sel?.rects,textOffset:sel?.textOffset})" @dict="handleOpenDict" @copy-mark-only="handleCopyToClipboard" />
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { showMessage } from 'siyuan'
import type { Plugin } from 'siyuan'
import type { ReaderSettings, PdfToolbarSettings } from '@/composables/useSetting'
import { settingsManager } from '@/composables/useSetting'
import { openDict as openDictDialog } from '@/utils/dictionary'
import { createReader, type FoliateReader } from '@/core/epub/reader'
import { setActiveReader, clearActiveReader } from '@/core/epub/state'
import type { FoliateView } from '@/core/epub/types'
import { COLORS, STYLES, createMarkManager, type MarkManager } from '@/core/MarkManager'
import { createInkToolManager, type InkToolManager } from '@/core/pdf/ink'
import { createShapeToolManager, type ShapeToolManager } from '@/core/pdf/shape'
import { initPdfAnnotationEvents, initPdfAnnotationRender } from '@/core/pdf/annotation'
import { saveMobilePosition, getMobilePosition, isMobile } from '@/utils/mobile'
import PdfToolbar from './PdfToolbar.vue'
import MarkPanel from './MarkPanel.vue'
import ReaderToc from './ReaderToc.vue'
import ReaderMarks from './ReaderMarks.vue'
import Settings from './Settings.vue'
import ReaderSplash from './ui/ReaderSplash.vue'
import DockShell from './ui/DockShell.vue'
import { gotoPDF, gotoEPUB, restorePosition as restorePos, initJump } from '@/utils/jump'
import { copyMark as copyMarkUtil } from '@/utils/copy'
import { createKeyboardHandler, setupEpubKeyboard } from '@/utils/keyboard'
import { TTSController } from '@/services/TTSPlayer'
import { useLicense } from '@/composables/useLicense'
const props = defineProps<{ file?: File; plugin: Plugin; settings?: ReaderSettings; url?: string; blockId?: string; bookInfo?: any; onReaderReady?: (r: FoliateReader) => void; i18n?: any }>()
const i18n = computed(() => props.i18n || {})
const { can, showUpgrade } = useLicense(i18n.value)
const currentSettings = ref(props.settings)
const getSettings = () => currentSettings.value || props.settings
const pdfToolbarFixed = computed(() => currentSettings.value?.pdfToolbarStyle === 'fixed')
const showOpeningSplash = computed(() => !!props.file || !(props.bookInfo?.progress > 0 || props.bookInfo?.pos?.cfi || props.bookInfo?.pos?.page || props.bookInfo?.pos?.chapter))
const tocTabs = computed(() => [
  { id: 'toc', icon: 'lucide-scroll-text', tip: i18n.value.toc || 'TOC' },
  { id: 'mark', icon: 'lucide-square-pen', tip: i18n.value.annotation || i18n.value.mark || 'Marks' },
  { id: 'settings', icon: 'lucide-settings-2', tip: i18n.value.settings || 'Settings' },
])
const tocPane = computed(() => tocMode.value === 'toc' ? ReaderToc : tocMode.value === 'mark' ? ReaderMarks : Settings)
const tocPaneProps = computed(() => tocMode.value === 'settings'
  ? { modelValue: currentSettings.value!, i18n: i18n.value, onSave: saveReaderSettings, 'onUpdate:modelValue': updateSettingsState }
  : { i18n: i18n.value })
let pdfToolbarSaveTimer:any
const updateSettingsState=(settings:ReaderSettings)=>{
  currentSettings.value=settings
  ;(window as any).__sireader_settings=settings
}
const saveReaderSettings=async()=>{const settings=currentSettings.value||props.settings;settings&&await settingsManager.save(settings)}
const closePanels=()=>{showToc.value=false;showSearch.value=false}
const queueSettingsSave=(settings:ReaderSettings)=>{
  clearTimeout(pdfToolbarSaveTimer)
  pdfToolbarSaveTimer=setTimeout(()=>settingsManager.save(settings).catch(()=>{}),200)
}
const hasSettingChanged=(prev:any,next:any,keys:string[])=>keys.some(key=>JSON.stringify(prev?.[key])!==JSON.stringify(next?.[key]))
const getBookName=()=>props.bookInfo?.title||props.file?.name||'book'
const handlePdfToolbarSettingsUpdate=(toolbar:PdfToolbarSettings)=>{
  const base=(currentSettings.value||props.settings)
  if(!base)return
  const next={...base,pdfToolbar:{...base.pdfToolbar,...toolbar}}
  updateSettingsState(next)
  queueSettingsSave(next)
}
const markPanelRef = ref()
const markManager = ref<MarkManager | null>(null)
const handleSettingsUpdate=async(e:Event)=>{
  const s=(e as CustomEvent).detail
  const prev=currentSettings.value
  updateSettingsState(s)
  hasSettingChanged(prev,s,['theme','customTheme','textSettings','paragraphSettings','layoutSettings','visualSettings','viewMode','pageAnimation'])&&reader?.updateSettings?.(s)
  hasSettingChanged(prev,s,['theme','customTheme','textSettings','paragraphSettings','layoutSettings','visualSettings','viewMode','pdfToolbarStyle'])&&pdfViewer.value&&await pdfViewer.value.updateTheme(s)
  JSON.stringify(prev?.tts)!==JSON.stringify(s?.tts)&&await syncTTS()
}
const containerRef = ref<HTMLElement>()
const viewerContainerRef = ref<HTMLElement>()
const readerSplashRef = ref<{ dismiss: () => void; cleanup: () => void; isVisible: () => boolean } | null>(null)
const loading = ref(true)
const error = ref('')
const hasBookmark = ref(false)
const currentBookUrl = ref('')
let readerFocused = false
let touchStartX=0,touchStartY=0
const touchTargets = new Set<EventTarget>()
const canHandleTouchPaging=()=>isMobile()&&isPdfMode.value
const resetTouch=()=>{touchStartX=0;touchStartY=0}
const isTouchActionTarget=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('.reader-toolbar-group,.reader-toc-popup,.mark-menu,.sr-popup-panel,.pdf-toolbar,.pdf-menu,input,textarea,button,select,a,[contenteditable="true"]')
const toggleMobileToolbar=()=>isMobile()&&(mobileToolbarVisible.value=!mobileToolbarVisible.value)
const handleTapZone=(x:number)=>{if(!isMobile()||isPdfMode.value||getSettings()?.viewMode==='scroll')return;const third=(containerRef.value?.clientWidth||window.innerWidth)/3;if(x<third)return handlePrev();if(x>third*2)return handleNext();toggleMobileToolbar()}
const handleTouchStart=(e:TouchEvent)=>{if(canHandleTouchPaging()&&e.touches.length===1){touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY}}
const handleTouchEnd=(e:TouchEvent)=>{if(!canHandleTouchPaging()||!touchStartX)return;const{clientX:x,clientY:y}=e.changedTouches[0],dx=x-touchStartX,dy=y-touchStartY;resetTouch();if(isTouchActionTarget(e.target))return;if(Math.abs(dx)>=50&&Math.abs(dx)>Math.abs(dy))return dx>0?handlePrev():handleNext();if(Math.abs(dx)<=30&&Math.abs(dy)<=30)handleTapZone(x)}
const touchPagingEvents:[string,EventListener,AddEventListenerOptions?][]=[['touchstart',handleTouchStart as EventListener,{capture:true,passive:true}],['touchend',handleTouchEnd as EventListener,{capture:true,passive:true}]]
const bindTouchPaging=(target:EventTarget|null|undefined)=>{if(!isMobile()||!target||touchTargets.has(target))return;touchTargets.add(target);touchPagingEvents.forEach(([type,handler,options])=>target.addEventListener(type,handler,options))}
const unbindTouchPaging=()=>{touchTargets.forEach(target=>touchPagingEvents.forEach(([type,handler])=>target.removeEventListener(type,handler,true)));touchTargets.clear()}
const pdfViewer = ref<any>(null)
const pdfSearcher = ref<any>(null)
const currentView = ref<any>(null)
const pageInput = ref(1)
const totalPages = ref(0)
const showSearch = ref(false)
const showToc = ref(false)
const showQuickMark = ref(false)
const mobileToolbarVisible = ref(false)
const toolbarVisible = computed(() => mobileToolbarVisible.value || showSearch.value || showToc.value || showQuickMark.value)
const quickMarkMode = ref(false)
const quickMarkColor = ref(0)
const quickMarkStyle = ref<'highlight'|'underline'|'outline'|'dotted'|'dashed'|'double'|'squiggly'>('highlight')
const tocMode = ref<'toc' | 'mark' | 'settings'>('toc')
const searchQuery = ref('')
const searchResults = ref<any[]>([])
const searchCurrentIndex = ref(0)
let reader: FoliateReader | null = null
let pdfSource: ArrayBuffer | null = null
let pdfBinarySource: Blob | null = null
let inkToolManager: InkToolManager | null = null
let shapeToolManager: ShapeToolManager | null = null
const bindPdfToolManagers=(manager:any,ink:InkToolManager,shape:ShapeToolManager)=>{
  manager.inkManager=ink
  manager.shapeManager=shape
}
const togglePdfToolManagers=async(ink:boolean,shape:boolean)=>{
  await inkToolManager?.toggle(ink)
  await shapeToolManager?.toggle(shape)
}
const updatePdfToolbarToolMode=(toolMode:'text'|'hand'|'ink'|'shape')=>{
  const base=currentSettings.value||props.settings
  if(!base||base.pdfToolbar?.toolMode===toolMode)return
  const next={...base,pdfToolbar:{...base.pdfToolbar,toolMode}}
  updateSettingsState(next)
  queueSettingsSave(next)
}
const setPdfToolActive=async(type:'ink'|'shape',active:boolean)=>{
  if(!active)return type==='ink'?await inkToolManager?.toggle(false):await shapeToolManager?.toggle(false)
  if(type==='ink'){
    await shapeToolManager?.toggle(false)
    await inkToolManager?.toggle(true)
    return
  }
  await inkToolManager?.toggle(false)
  await shapeToolManager?.toggle(true)
}
const exitPdfAnnotationTool=async()=>{
  await togglePdfToolManagers(false,false)
  updatePdfToolbarToolMode('text')
}
const finishPdfAnnotation=async(item:any,x?:number,y?:number,edit?:boolean)=>{
  await exitPdfAnnotationTool()
  edit&&item&&markPanelRef.value?.showCard(item,x,y,true)
}
const withCurrentPdfPage=(fn:(page:number)=>Promise<void>|void)=>{
  const page=pdfViewer.value?.getCurrentPage()
  return page?fn(page):undefined
}
const ttsController = new TTSController()
const ttsEnabled = computed(() => currentSettings.value?.tts?.enabled || false)
const ttsPlaying = computed(() => ttsController.isActive.value && !ttsController.paused.value)
const toggleTTS = () => {if (!can.value('tts')) return showUpgrade('TTS朗读'); ttsController.toggle(() => reader, currentSettings.value?.tts)}
const syncTTS = async () => ttsController.sync(currentSettings.value?.tts?.enabled || false)
const marks=computed(()=>markManager.value)
const isPdfMode=computed(()=>!!pdfViewer.value)
const hasSearchResults=computed(()=>searchResults.value.length>0)
const searchCount=computed(()=>isPdfMode.value?(searchResults.value.length?`${searchCurrentIndex.value+1}/${searchResults.value.length}`:'0/0'):(searchResults.value.length?`${searchResults.value.length}`:'0'))
const initPdfMode=async(bookUrl:string,onProgress:()=>Promise<void>,loadFile:()=>Promise<File|null>,bookshelfManager:any)=>{
  const{PDFViewer,PDFSearch}=await import('@/core/pdf')
  const container=viewerContainerRef.value!
  const showAnn=(a:any)=>markPanelRef.value?.showAnnotationCard(a)
  const viewer=new PDFViewer({container,scale:1.5,onPageChange:onProgress,onAnnotationClick:showAnn})
  ;(window as any).__pdfViewer=viewer
  ;(container as any).__pdfViewer=viewer
  getSettings()&&viewer.applyTheme(getSettings()!)
  const file=await loadFile()
  pdfBinarySource=file||null
  pdfSource=file?await file.arrayBuffer():null as any
  if(!pdfSource)throw new Error('未提供PDF文件')
  const searcher=new PDFSearch()
  await viewer.open(pdfSource.slice(0))
  await viewer.fitWidth()
  searcher.setPDF(viewer.getPDF()!)
  ;(window as any).__pdfDoc=viewer.getPDF()
  searcher.extractAllText().catch(()=>{})
  const view=await viewer.createView()
  const manager=createMarkManager({format:'pdf',plugin:props.plugin,bookUrl,bookName:getBookName(),onAnnotationClick:showAnn,pdfViewer:viewer})
  await manager.init()
  await bookshelfManager.restoreProgress(bookUrl,null,viewer)
  const handleShapeClick=(shape:any)=>markPanelRef.value?.showShapeCard(shape,viewer)
  const ink=createInkToolManager(container,props.plugin,bookUrl,getBookName(),viewer)
  const shape=createShapeToolManager(container,props.plugin,bookUrl,getBookName(),handleShapeClick,viewer)
  await ink.init()
  await shape.init()
  bindPdfToolManagers(manager,ink,shape)
  const cleanupEvents=initPdfAnnotationEvents(container,viewer,manager,(data,anchor)=>markPanelRef.value?.showMenu(data,anchor))
  const cleanupRender=initPdfAnnotationRender(viewer,manager,ink,shape)
  container.addEventListener('keydown',handleKeydown)
  pdfViewer.value=viewer
  pdfSearcher.value=searcher
  markManager.value=manager
  inkToolManager=ink
  shapeToolManager=shape
  currentView.value={...view,isPdf:true,marks:manager,cleanup:()=>{cleanupEvents();cleanupRender();container.removeEventListener('keydown',handleKeydown)}}
  updatePageInfo()
  setActiveReader(currentView.value,null,getSettings())
}
const init=async()=>{
  if(!containerRef.value)return
  try{
    loading.value=true
    error.value=''
    const bookUrl=props.bookInfo?.url||props.url||(props.file?`file://${props.file.name}`:`book-${Date.now()}`)
    currentBookUrl.value=bookUrl
    ;(window as any).__currentBookUrl=bookUrl
    const isPdf=props.file?.name.endsWith('.pdf')||props.bookInfo?.format==='pdf'
    const{bookshelfManager}=await import('@/core/bookshelf')
    const onProgress=async()=>{updateBookmarkState();await bookshelfManager.updateProgressAuto(bookUrl,reader,pdfViewer.value,currentView.value);updatePageInfo()}
    const loadFile=async()=>{
      if(props.file)return props.file
      const path=props.bookInfo?.path
      if(!path)return null
      return await bookshelfManager.loadFile(path)
    }
    if(isPdf){
      await initPdfMode(bookUrl,onProgress,loadFile,bookshelfManager)
    }else{
      reader=createReader({container:viewerContainerRef.value!,settings:getSettings()!,plugin:props.plugin})
      await reader.open(props.file||props.url||await loadFile()||await Promise.reject(new Error('未提供书籍')))
      const view=reader.getView()
      markManager.value=createMarkManager({format:'epub',view,plugin:props.plugin,bookUrl,bookName:getBookName(),reader})
      await markManager.value.init()
      ;(view as any).marks=markManager.value
      await bookshelfManager.restoreProgress(bookUrl,reader)
      reader.on('relocate',onProgress)
      setupEpubKeyboard(
        reader,
        handleKeydown,
        (doc,e)=>markPanelRef.value?.checkSelection(doc,e),
        x=>handleTapZone(x),
        ()=>reader?.goLeft(),
        ()=>reader?.goRight()
      )
      currentView.value=view
      setActiveReader(view,reader,getSettings())
      props.onReaderReady?.(reader)
    }
    await syncTTS()
    markPanelRef.value?.setupAnnotationListeners()
  }catch(e){
    error.value=e instanceof Error?e.message:'加载失败'
    markPanelRef.value?.closeAll()
  }finally{
    loading.value=false
    await restorePos(getBookUrl(),reader,pdfViewer.value,getMobilePosition)
    props.bookInfo?.pos?.cfi&&initJump(props.bookInfo.pos.cfi,currentBookUrl.value)
  }
}
const handleCopy=(item:any)=>{
  if(typeof item==='string'||!item.id&&item.text){const loc=isPdfMode.value?null:reader?.getLocation();item={text:item.text||item,cfi:item.cfi,page:item.page,chapter:loc?.tocItem?.label||loc?.tocItem?.title,id:''}}
  copyMarkUtil(item,{bookUrl:getBookUrl(),bookInfo:props.bookInfo,settings:getSettings(),reader,pdfViewer:pdfViewer.value,showMsg:(msg:string)=>showMessage(msg,1000)})
}
const handleCopyToClipboard=(item:any)=>{
  if(typeof item==='string'||!item.id&&item.text){const loc=isPdfMode.value?null:reader?.getLocation();item={text:item.text||item,cfi:item.cfi,page:item.page,chapter:loc?.tocItem?.label||loc?.tocItem?.title,id:''}}
  copyMarkUtil(item,{bookUrl:getBookUrl(),bookInfo:props.bookInfo,settings:{...(getSettings()||{}),noteInsertTarget:'clipboard'},reader,pdfViewer:pdfViewer.value,showMsg:(msg:string)=>showMessage(msg,1000)})
}
const handleOpenDict=(text:string,x:number,y:number,selection:any)=>selection&&openDictDialog(text,x,y,selection)
const isEpubScrollMode=()=>getSettings()?.viewMode==='scroll'
const flipPage=(dir:'prev'|'next')=>{
  if(dir==='next'&&readerSplashRef.value?.isVisible())return readerSplashRef.value.dismiss()
  ttsController.destroy()
  if(isPdfMode.value)return currentView.value?.nav?.[dir]?.()
  if(reader)return isEpubScrollMode() ? reader[dir]() : reader[dir==='prev'?'goLeft':'goRight']()
  return currentView.value?.[dir]?.()||currentView.value?.[dir==='prev'?'goLeft':'goRight']?.()
}
const handlePrev=()=>flipPage('prev')
const handleNext=()=>flipPage('next')
const handlePageJump=()=>{ttsController.destroy();const p=Math.max(1,Math.min(totalPages.value,pageInput.value||1));pageInput.value=p;pdfViewer.value?.goToPage(p)}
const updatePageInfo=()=>pdfViewer.value&&(totalPages.value=pdfViewer.value.getPageCount(),pageInput.value=pdfViewer.value.getCurrentPage())
const searchInputRef=ref<HTMLInputElement>()
const toggleSearch=()=>{showSearch.value=!showSearch.value;showSearch.value&&(showQuickMark.value=quickMarkMode.value=false,setTimeout(()=>searchInputRef.value?.focus(),100))}
const toggleQuickMark=()=>{if(!can.value('quick-mark'))return showUpgrade('快速标注');showQuickMark.value=!showQuickMark.value;showQuickMark.value&&(showSearch.value=false);quickMarkMode.value=showQuickMark.value}
const syncSearchNav=(r:any,page?:number)=>{
  if(!r)return
  searchCurrentIndex.value=isPdfMode.value?pdfSearcher.value.getCurrentIndex():reader.searchManager.getCurrentIndex()
  page&&pdfViewer.value?.goToPage(page)
}
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
const moveSearch=(dir:'next'|'prev')=>syncSearchNav(isPdfMode.value?pdfSearcher.value?.[dir]():reader?.[dir==='next'?'nextSearchResult':'prevSearchResult'](),isPdfMode.value?pdfSearcher.value?.getCurrent()?.page:undefined)
const handleSearchNext=()=>moveSearch('next')
const handleSearchPrev=()=>moveSearch('prev')
const handleSearchClear=()=>{searchQuery.value='';searchResults.value=[];searchCurrentIndex.value=0;pdfSearcher.value?.clear();reader?.clearSearch();showSearch.value=false}
const handlePrint=async()=>pdfBinarySource&&(await import('@/core/pdf')).printPDF(pdfBinarySource)
const handleDownload=async()=>pdfBinarySource&&(await import('@/core/pdf')).downloadPDF(pdfBinarySource,props.file?.name||props.bookInfo?.title||'document.pdf')
const handleExportImages=async()=>pdfViewer.value&&(await import('@/core/pdf')).exportAsImages(pdfViewer.value.getPDF()!)
const handleInkToggle=async(a:boolean)=>setPdfToolActive('ink',a)
const handleInkColor=async(c:string)=>inkToolManager?.setConfig({color:c})
const handleInkWidth=async(w:number)=>inkToolManager?.setConfig({width:w})
const handleInkEraser=async(a:boolean)=>inkToolManager?.setConfig(a?{color:'#fff',width:20}:{color:'#f00',width:2})
const handleInkUndo=async()=>inkToolManager?.undo()
const handleInkClear=async()=>inkToolManager?.clear()
const handleShapeToggle=async(a:boolean)=>setPdfToolActive('shape',a)
const handleShapeType=async(t:string)=>shapeToolManager?.setConfig({shapeType:t})
const handleShapeColor=async(c:string)=>shapeToolManager?.setConfig({color:c})
const handleShapeWidth=async(w:number)=>shapeToolManager?.setConfig({width:w})
const handleShapeFilled=async(f:boolean)=>shapeToolManager?.setConfig({filled:f})
const handleShapeUndo=async()=>withCurrentPdfPage(page=>shapeToolManager?.undo(page))
const handleShapeClear=async()=>withCurrentPdfPage(page=>shapeToolManager?.clear(page))
const updateBookmarkState=()=>hasBookmark.value=!!markManager.value?.hasBookmark?.()
const toggleBookmark=async()=>{try{hasBookmark.value=await marks.value?.toggleBookmark?.();window.dispatchEvent(new CustomEvent('sireader:marks-updated'))}catch(e:any){showMessage(e.message||'操作失败',2000,'error')}}
const getBookUrl=()=>currentBookUrl.value||props.bookInfo?.url||props.url||''
const savePosition=()=>isMobile()&&getBookUrl()&&saveMobilePosition(getBookUrl(),isPdfMode.value?{page:pdfViewer.value?.getCurrentPage()}:{cfi:reader?.getLocation()?.cfi})
const syncReaderFocus=(focused:boolean)=>{const bookUrl=getBookUrl();if(!bookUrl||readerFocused===focused)return;readerFocused=focused;window.dispatchEvent(new CustomEvent(focused?'reader:focus':'reader:blur',{detail:{bookUrl}}))}
const hasReaderFocus=()=>!!containerRef.value&&containerRef.value.contains(document.activeElement)
const handleFocusIn=()=>syncReaderFocus(true)
const handleFocusOut=()=>setTimeout(()=>syncReaderFocus(hasReaderFocus()),0)
const handleWindowBlur=()=>syncReaderFocus(false)
const handleWindowFocus=()=>syncReaderFocus(hasReaderFocus())
const handleVisibilityChange=()=>syncReaderFocus(!document.hidden&&hasReaderFocus())
const openToc=()=>{showToc.value=!showToc.value}
const handleClose=()=>{savePosition();window.dispatchEvent(new CustomEvent('reader:mobile-close'))}
const handlePdfZoomIn=()=>pdfViewer.value?.setScale(pdfViewer.value.getScale()+.25)
const handlePdfZoomOut=()=>pdfViewer.value?.setScale(pdfViewer.value.getScale()-.25)
const handlePdfZoomReset=()=>pdfViewer.value?.setScale(1.5)
const handlePdfRotate=()=>pdfViewer.value?.setRotation(((pdfViewer.value.getRotation()+90)%360)as 0|90|180|270)
const handlePdfSearch=()=>window.dispatchEvent(new CustomEvent('pdf:toggle-search'))
const handlePdfFirstPage=()=>pdfViewer.value?.goToPage(1)
const handlePdfLastPage=()=>pdfViewer.value?.goToPage(pdfViewer.value.getPageCount())
const handlePdfPageUp=handlePrev
const handlePdfPageDown=handleNext
const handleGoto=(e:CustomEvent)=>{
  const{cfi,id,bookUrl}=e.detail
  if(bookUrl&&bookUrl!==currentBookUrl.value)return
  ttsController.destroy()
  if(!cfi)return
  if(isPdfMode.value){
    const page=cfi.startsWith('#page-')?parseInt(cfi.slice(6)):/^\d+$/.test(cfi)?parseInt(cfi):0
    page&&gotoPDF(page,id,pdfViewer.value,markManager.value,shapeToolManager)
  }else gotoEPUB(cfi,id,reader,markManager.value)
}
const handleUndo=()=>markManager.value?.undo()
const handleKeydown=createKeyboardHandler({handlePrev,handleNext,handleUndo,handlePdfFirstPage,handlePdfLastPage,handlePdfPageUp,handlePdfPageDown,handlePdfRotate,handlePdfZoomIn,handlePdfZoomOut,handlePdfZoomReset,handlePdfSearch,handlePrint},()=>isPdfMode.value,()=>readerFocused)
const events=[['sireaderSettingsUpdated',handleSettingsUpdate],['sireader:goto',handleGoto],['sireader:toggleBookmark',toggleBookmark],['sireader:quickNote',async()=>{try{if(!currentView.value||!containerRef.value?.isConnected)return;if((window as any).__sireader_active_view&&(window as any).__sireader_active_view!==currentView.value)return;const { openNoteTargetFloat } = await import('@/utils/copy');await openNoteTargetFloat(getBookUrl(),getSettings(),containerRef.value!)}catch(e:any){showMessage(e?.message||'打开目标文档失败',2000,'error')}}],['sireader:prevPage',handlePrev],['sireader:nextPage',handleNext],['sireader:pdfZoomIn',handlePdfZoomIn],['sireader:pdfZoomOut',handlePdfZoomOut],['sireader:pdfZoomReset',handlePdfZoomReset],['sireader:pdfRotate',handlePdfRotate],['sireader:pdfSearch',handlePdfSearch],['sireader:pdfPrint',handlePrint],['sireader:pdfFirstPage',handlePdfFirstPage],['sireader:pdfLastPage',handlePdfLastPage],['sireader:pdfPageUp',handlePdfPageUp],['sireader:pdfPageDown',handlePdfPageDown]]as const
const suppressError=(e:PromiseRejectionEvent)=>/createTreeWalker|destroy/.test(e.reason?.message||'')&&e.preventDefault()
const setupTabObserver=()=>{if(isMobile())return;let el=containerRef.value?.parentElement;while(el){if(el.hasAttribute('data-id')){const h=document.querySelector(`li[data-type="tab-header"][data-id="${el.getAttribute('data-id')}"]`);if(h){const obs=new MutationObserver(ms=>ms.forEach(m=>{if(m.type!=='attributes'||m.attributeName!=='class')return;const focused=(m.target as HTMLElement).classList.contains('item--focus');focused&&setActiveReader(currentView.value,reader,getSettings());focused&&window.dispatchEvent(new CustomEvent('sireader:tab-switched'));syncReaderFocus(focused&&hasReaderFocus())}));obs.observe(h,{attributes:true,attributeFilter:['class']});(containerRef.value as any).__observer=obs;break}}el=el.parentElement}}
const handleShapeCreated=async(e:CustomEvent)=>{const{shape,x,y,edit}=e.detail;await finishPdfAnnotation(shape,x,y,edit)}
const handleInkCreated=async(e:CustomEvent)=>{const{ink,x,y,edit}=e.detail||{};await finishPdfAnnotation(ink,x,y,edit)}
onMounted(()=>{init();containerRef.value?.focus();events.forEach(([e,h])=>window.addEventListener(e,h as any));window.addEventListener('unhandledrejection',suppressError);window.addEventListener('shape-created',handleShapeCreated as any);window.addEventListener('ink-created',handleInkCreated as any);window.addEventListener('blur',handleWindowBlur);window.addEventListener('focus',handleWindowFocus);document.addEventListener('visibilitychange',handleVisibilityChange);setupTabObserver();const c=containerRef.value;c&&(c.addEventListener('focusin',handleFocusIn),c.addEventListener('focusout',handleFocusOut),c.addEventListener('keydown',handleKeydown));bindTouchPaging(c);bindTouchPaging(viewerContainerRef.value);window.dispatchEvent(new CustomEvent('reader:open',{detail:{bookUrl:getBookUrl()}}));syncReaderFocus(true)})
onUnmounted(async()=>{syncReaderFocus(false);window.dispatchEvent(new CustomEvent('reader:close'));savePosition();clearTimeout(pdfToolbarSaveTimer);readerSplashRef.value?.cleanup();clearActiveReader();await markManager.value?.destroy();try{reader?.destroy();currentView.value?.cleanup?.();currentView.value?.viewer?.destroy?.()}catch{};inkToolManager?.destroy?.();shapeToolManager?.destroy?.();ttsController.destroy();setTimeout(()=>viewerContainerRef.value&&(viewerContainerRef.value.innerHTML=''),50);events.forEach(([e,h])=>window.removeEventListener(e,h as any));window.removeEventListener('unhandledrejection',suppressError);window.removeEventListener('shape-created',handleShapeCreated as any);window.removeEventListener('ink-created',handleInkCreated as any);window.removeEventListener('blur',handleWindowBlur);window.removeEventListener('focus',handleWindowFocus);document.removeEventListener('visibilitychange',handleVisibilityChange);(containerRef.value as any)?.__observer?.disconnect();const c=containerRef.value;c&&(c.removeEventListener('focusin',handleFocusIn),c.removeEventListener('focusout',handleFocusOut),c.removeEventListener('keydown',handleKeydown));unbindTouchPaging();const{bookshelfManager}=await import('@/core/bookshelf');await bookshelfManager.flush();bookshelfManager.cleanup()})
</script>
<style scoped lang="scss">
.reader-container{position:relative;width:100%;height:100%;outline:none;user-select:text;-webkit-user-select:text;isolation:isolate;display:flex;flex-direction:column;background:var(--b3-theme-background)}
.reader-overlay{position:absolute;inset:0;z-index:999;background:transparent}
.viewer-container{flex:1;position:relative;overflow:auto;background:var(--b3-theme-background);
  &.has-fixed-toolbar{padding-top:40px}
}
.reader-loading{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:16px;color:var(--b3-theme-on-background);z-index:10;pointer-events:none}
.spinner{width:48px;height:48px;border:4px solid var(--b3-theme-primary-lighter);border-top-color:var(--b3-theme-primary);border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.reader-toolbar-group{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:1001;&:hover>*{opacity:1}}
.reader-toolbar,.reader-panel{display:flex;align-items:center;gap:2px;padding:3px 4px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:6px;box-shadow:0 2px 8px #0002;opacity:var(--toolbar-opacity);transition:opacity .2s}
.reader-toolbar.is-visible,.reader-panel.is-visible{opacity:1}
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
.reader-toc-popup{position:absolute;bottom:60px;left:50%;transform:translateX(-50%);width:min(420px,92vw);height:min(520px,72vh);background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:0 4px 20px #0003;z-index:1002;overflow:hidden}
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
