<template>
  <div class="sr-toc" @click="showFilterMenu=false">
    <!-- 工具栏 -->
    <div class="sr-toolbar">
      <input v-model="keyword" :placeholder="placeholders[mode]">
      <div v-if="mode==='mark'" class="sr-select">
        <button class="b3-tooltips b3-tooltips__sw" @click.stop="showFilterMenu=!showFilterMenu" :aria-label="filterLabel">
          <svg><use xlink:href="#lucide-sliders-horizontal"/></svg>
        </button>
        <Transition name="menu">
          <div v-if="showFilterMenu" class="sr-menu" @click.stop>
            <div class="sr-menu-section">{{ props.i18n?.color||'颜色' }}</div>
            <div v-for="c in filterOpts.colors" :key="c.value" :class="['sr-menu-item',{active:filter.color===c.value}]" @click="filter.color=c.value">
              <span v-if="c.bg" class="dot" :style="{background:c.bg}"></span>{{ c.label }}
            </div>
            <div class="sr-menu-divider"></div>
            <div class="sr-menu-section">{{ props.i18n?.sort||'排序' }}</div>
            <div v-for="s in filterOpts.sorts" :key="s.value" :class="['sr-menu-item',{active:filter.sort===s.value}]" @click="filter.sort=s.value">{{ s.label }}</div>
          </div>
        </Transition>
      </div>
      <button v-if="mode==='toc'&&isPdfMode" class="b3-tooltips b3-tooltips__sw" @click="showThumbnail=!showThumbnail" :aria-label="showThumbnail?'目录':'缩略图'">
        <svg><use :xlink:href="showThumbnail?'#lucide-scroll-text':'#lucide-panels-top-left'"/></svg>
      </button>
      <button v-if="mode==='deck'" class="b3-tooltips b3-tooltips__sw" @click="deckTab='cards'" :class="{active:deckTab==='cards'}" aria-label="卡片">
        <svg><use xlink:href="#lucide-square-star"/></svg>
      </button>
      <button v-if="mode==='deck'" class="b3-tooltips b3-tooltips__sw" @click="deckTab='packs'" :class="{active:deckTab==='packs'}" aria-label="卡组">
        <svg><use xlink:href="#lucide-shopping-bag"/></svg>
      </button>
      <button v-if="mode==='deck'" class="b3-tooltips b3-tooltips__sw" @click="deckTab='review'" :class="{active:deckTab==='review'}" aria-label="闪卡">
        <svg><use xlink:href="#lucide-zap"/></svg>
      </button>
      <button v-if="mode==='deck'" class="b3-tooltips b3-tooltips__sw" @click="deckTab='stats'" :class="{active:deckTab==='stats'}" aria-label="统计">
        <svg><use xlink:href="#lucide-chart-pie"/></svg>
      </button>
      <button v-if="mode==='deck'" class="b3-tooltips b3-tooltips__sw" @click="deckTab='settings'" :class="{active:deckTab==='settings'}" aria-label="设置">
        <svg><use xlink:href="#lucide-settings-2"/></svg>
      </button>
      <button v-if="mode==='bookmark'||mode==='mark'||mode==='toc'" class="b3-tooltips b3-tooltips__sw" @click="isReverse=!isReverse" :aria-label="isReverse?'倒序':'正序'">
        <svg><use :xlink:href="isReverse?'#lucide-arrow-up-1-0':'#lucide-arrow-down-0-1'"/></svg>
      </button>
    </div>

    <!-- 内容区 -->
    <div ref="contentRef" class="sr-content">
      <!-- 目录 -->
      <div v-show="mode==='toc'&&!showThumbnail" ref="tocRef"></div>
      
      <!-- PDF 缩略图（在目录模式内） -->
      <div v-show="mode==='toc'&&showThumbnail" ref="thumbContainer" class="sr-thumbnails">
        <div v-if="!isPdfMode" class="sr-empty">仅 PDF 支持缩略图</div>
        <div v-else v-for="i in pageCount" :key="i" :data-page="i" class="sr-thumb" @click="goToPage(i)">
          <img v-if="loadedThumbs[i]" :src="loadedThumbs[i]" :alt="`第 ${i} 页`">
          <div v-else class="sr-thumb-placeholder">{{ i }}</div>
          <div class="sr-thumb-label">{{ i }}</div>
        </div>
      </div>
      
      <Transition name="fade" mode="out-in">
        <!-- 书签 -->
        <div v-if="mode==='bookmark'" key="bookmark" class="sr-list">
          <div v-if="!list.length" class="sr-empty">{{ emptyText }}</div>
          <div v-else v-for="(item,i) in list" :key="item.id||i" class="sr-bookmark-item" @click="goTo(item)">
            {{ item.title||'无标题' }}
            <button class="sr-action-btn b3-tooltips b3-tooltips__nw" aria-label="删除书签" @click.stop="removeBookmark(item)">
              <svg><use xlink:href="#iconTrashcan"/></svg>
            </button>
          </div>
        </div>
        
        <!-- 标注和笔记 -->
        <div v-else-if="mode==='mark'" :key="mode" class="sr-list">
          <div v-if="!list.length" class="sr-empty">{{ emptyText }}</div>
          <template v-else v-for="(item,i) in list" :key="item.key||item.groupId||item.id||item.page||i">
            <!-- 分组头 -->
            <div v-if="item.isGroup" class="sr-card sr-group" @click="collapsed.has(item.key)?collapsed.delete(item.key):collapsed.add(item.key)">
              <span class="sr-bar" :class="{collapsed:collapsed.has(item.key)}"></span>
              <div class="sr-group-content">
                <span class="sr-group-title">{{ item.key }}</span>
                <span class="sr-group-count">{{ item.items.length }}</span>
              </div>
            </div>
            <!-- 分组内容或单项 -->
            <template v-for="(m,j) in (item.isGroup&&!collapsed.has(item.key)?item.items:[item.isGroup?null:item])" :key="m?.id||j">
              <div v-if="m" class="sr-card" :class="{'sr-card-edit':isEditing(m)}">
                <span class="sr-bar" :style="{background:m.type==='ink-group'?'#ff9800':m.type==='shape-group'?'#2196f3':(colors[isEditing(m)?editColor:m.color]||'var(--b3-theme-primary)')}"></span>
                <div class="sr-main">
                  <div class="sr-head">
                    <div v-if="m.chapter&&filter.sort==='time'" class="sr-chapter">{{ m.chapter }}</div>
                    <div v-if="(!m.type||m.type==='highlight'||m.type==='note')&&filter.sort==='time'" class="sr-time">{{ formatTime(m.timestamp||Date.now()) }}</div>
                    <button v-if="m.type==='ink-group'||m.type==='shape-group'" @click.stop="toggleExpand(m)" class="sr-expand-btn b3-tooltips b3-tooltips__nw" :aria-label="isExpanded(m)?'收起':'展开'">
                      <svg><use :xlink:href="isExpanded(m)?'#iconUp':'#iconDown'"/></svg>
                    </button>
                  </div>
                  <div v-if="isEditing(m)" class="sr-title" contenteditable @blur="e=>editText=e.target.textContent" v-html="editText"></div>
                  <div v-else class="sr-title" @click="(m.type==='ink-group'||m.type==='shape-group')?null:goTo(m)">{{ m.type==='ink-group'?'✏️':m.type==='shape-group'?'🔷':m.text||'无内容' }}<span v-if="m.type==='ink-group'||m.type==='shape-group'" class="sr-meta">第{{ m.page }}页 · {{ (m.inks||m.shapes).length }}项</span></div>
                  <textarea v-if="isEditing(m)" ref="editNoteRef" v-model="editNote" placeholder="添加笔记..." class="sr-note-input"/>
                  <div v-else-if="m.note" class="sr-note" @click.stop="startEdit(m)">{{ m.note }}</div>
                  <canvas v-if="m.type==='ink-group'" :data-page="m.page" class="sr-preview sr-group-preview" width="240" height="80"></canvas>
                  <template v-if="isEditing(m)&&showEditOptions(m)">
                    <div class="sr-options">
                      <div class="sr-colors">
                        <button v-for="c in COLORS" :key="c.color" class="sr-color-btn" :class="{active:editColor===c.color}" :style="{background:c.bg}" @click.stop="editColor=c.color"/>
                      </div>
                      <div v-if="m.type==='shape'" class="sr-styles">
                        <button v-for="s in shapes" :key="s.type" class="sr-style-btn" :class="{active:editShapeType===s.type}" @click.stop="editShapeType=s.type" :title="s.label">
                          <svg style="width:16px;height:16px"><use :xlink:href="s.icon"/></svg>
                        </button>
                      </div>
                      <div v-else class="sr-styles">
                        <button v-for="s in STYLES.filter(s=>!s.pdfOnly||isPdfMode)" :key="s.type" class="sr-style-btn" :class="{active:editStyle===s.type}" @click.stop="editStyle=s.type">
                          <span class="sr-style-icon" :data-type="s.type">{{ s.text }}</span>
                        </button>
                      </div>
                    </div>
                    <div class="sr-actions">
                      <button @click.stop="saveEdit(m)" class="sr-btn-primary">保存</button>
                      <button @click.stop="cancelEdit" class="sr-btn-secondary">取消</button>
                    </div>
                  </template>
                  <Transition name="expand">
                    <div v-if="isExpanded(m)" class="sr-sub-list">
                      <div v-for="sub in (m.inks||m.shapes)" :key="sub.id" class="sr-sub-item" :class="{'sr-card-edit':isEditing(sub)}">
                        <canvas v-if="m.type==='ink-group'" :data-ink-id="sub.id" class="sr-preview" width="240" height="40" @click.stop="isEditing(sub)?null:goTo(sub)"></canvas>
                        <canvas v-else :data-shape-id="sub.id" class="sr-preview" @click.stop="isEditing(sub)?null:goTo(sub)"></canvas>
                        <textarea v-if="isEditing(sub)" ref="editNoteRef" v-model="editNote" placeholder="添加笔记..." class="sr-note-input"/>
                        <div v-else-if="sub.note" class="sr-note" @click.stop="startEdit(sub)">{{ sub.note }}</div>
                        <template v-if="isEditing(sub)">
                          <div class="sr-options">
                            <div class="sr-colors">
                              <button v-for="c in COLORS" :key="c.color" class="sr-color-btn" :class="{active:editColor===c.color}" :style="{background:c.bg}" @click.stop="editColor=c.color"/>
                            </div>
                            <div v-if="sub.type==='shape'" class="sr-styles">
                              <button v-for="s in shapes" :key="s.type" class="sr-style-btn" :class="{active:editShapeType===s.type}" @click.stop="editShapeType=s.type" :title="s.label">
                                <svg style="width:16px;height:16px"><use :xlink:href="s.icon"/></svg>
                              </button>
                            </div>
                          </div>
                          <div class="sr-actions">
                            <button @click.stop="saveEdit(sub)" class="sr-btn-primary">保存</button>
                            <button @click.stop="cancelEdit" class="sr-btn-secondary">取消</button>
                          </div>
                        </template>
                        <div v-else class="sr-btns">
                          <button v-if="m.type==='shape-group'" @click.stop="copyMark(sub)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.copy||'复制'"><svg><use xlink:href="#iconCopy"/></svg></button>
                          <button v-if="m.type==='shape-group'" @click.stop="startEdit(sub)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.edit||'编辑'"><svg><use xlink:href="#iconEdit"/></svg></button>
                          <button v-if="sub.blockId" @click.stop="openBlock(sub.blockId)" @mouseenter="onBlockEnter($event,sub.blockId)" @mouseleave="hideFloat" class="b3-tooltips b3-tooltips__nw" aria-label="打开块"><svg><use xlink:href="#iconRef"/></svg></button>
                          <button v-else @click.stop="importMark(sub)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.import||'导入'"><svg><use xlink:href="#iconDownload"/></svg></button>
                          <button @click.stop="deleteMark(sub)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.delete||'删除'"><svg><use xlink:href="#iconTrashcan"/></svg></button>
                        </div>
                      </div>
                    </div>
                  </Transition>
                  <div v-if="!isEditing(m)&&(!m.type||m.type==='highlight'||m.type==='note')" class="sr-btns">
                    <button @click.stop="copyMark(m)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.copy||'复制'"><svg><use xlink:href="#iconCopy"/></svg></button>
                    <button @click.stop="startEdit(m)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.edit||'编辑'"><svg><use xlink:href="#iconEdit"/></svg></button>
                    <button v-if="m.blockId" @click.stop="openBlock(m.blockId)" @mouseenter="onBlockEnter($event,m.blockId)" @mouseleave="hideFloat" class="b3-tooltips b3-tooltips__nw" aria-label="打开块"><svg><use xlink:href="#iconRef"/></svg></button>
                    <button v-else @click.stop="importMark(m)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.import||'导入'"><svg><use xlink:href="#iconDownload"/></svg></button>
                    <button @click.stop="deleteMark(m)" class="b3-tooltips b3-tooltips__nw" :aria-label="props.i18n?.delete||'删除'"><svg><use xlink:href="#iconTrashcan"/></svg></button>
                  </div>
                </div>
              </div>
            </template>
          </template>
        </div>
        
        <!-- 卡包 -->
        <DeckHub v-else-if="mode==='deck'" key="deck" :keyword="keyword" :activeTab="deckTab" @update:activeTab="deckTab=$event"/>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { showMessage } from 'siyuan'
import DeckHub from './deck/DeckHub.vue'
import { COLORS, STYLES, getColorMap, formatTime } from '@/core/MarkManager'
import { useReaderState } from '@/core/epub'
import { jump } from '@/utils/jump'
import { copyMark as copyMarkUtil, openBlock, showFloat, hideFloat } from '@/utils/copy'
import { drawInk, renderInkCanvas as renderInkUtil } from '@/core/pdf/ink'
import { renderShapeCanvas as renderShapeUtil } from '@/core/pdf/shape'
import { bookshelfManager } from '@/core/bookshelf'

const props = withDefaults(defineProps<{ mode: 'toc'|'bookmark'|'mark'|'deck'; i18n?: any }>(), { i18n: () => ({}) })

// 响应式状态
const { activeView, activeReader } = useReaderState()
const goToLocation = async (location: string | number) => activeView.value?.goTo(location)

// ===== 状态 =====
const tocRef=ref<HTMLElement>(),contentRef=ref<HTMLElement>(),editNoteRef=ref<HTMLTextAreaElement>(),thumbContainer=ref<HTMLElement>()
const keyword=ref(''),showFilterMenu=ref(false),showThumbnail=ref(false)
const isReverse=ref(false),refreshKey=ref(0)
const deckTab=ref<'cards'|'packs'|'stats'|'review'|'settings'>('cards')
const filter=ref({color:'',sort:'time'}),collapsed=ref(new Set<string>())
const expandedGroup=ref<number|null>(null)
const editingId=ref<string|null>(null),editText=ref(''),editNote=ref(''),editColor=ref('yellow')
const editStyle=ref<'highlight'|'underline'|'outline'|'dotted'|'dashed'|'double'|'squiggly'>('highlight')
const editShapeType=ref<'rect'|'circle'|'triangle'>('rect')
const shapes=[{type:'rect',label:'矩形',icon:'#iconSquareDashed'},{type:'circle',label:'圆形',icon:'#iconCircleDashed'},{type:'triangle',label:'三角形',icon:'#iconTriangleDashed'}]
const loadedThumbs=ref<Record<number,string>>({})
const shapePreviewCache=new Map<string,string>()

// ===== 常量 =====
const colors=getColorMap()
const placeholders={toc:'搜索目录...',bookmark:'搜索书签...',mark:'搜索标注和笔记...',deck:'搜索 · 卡组: 标签: 状态: 属性:'}

// ===== Computed =====
const filterOpts=computed(()=>({
  colors:[{label:props.i18n?.all||'全部',value:''},...COLORS.map(c=>({label:c.name,value:c.color,bg:c.bg}))],
  sorts:[{label:props.i18n?.sortTime||'时间',value:'time'},{label:props.i18n?.sortDate||'日期',value:'date'},{label:props.i18n?.sortChapter||'章节',value:'chapter'}]
}))
const filterLabel=computed(()=>{
  const p=[]
  if(filter.value.color)p.push(COLORS.find(c=>c.color===filter.value.color)?.name)
  if(filter.value.sort!=='time')p.push(filterOpts.value.sorts.find(s=>s.value===filter.value.sort)?.label)
  return p.length?p.join(' · '):(props.i18n?.filter||'筛选')
})
const marks=computed(()=>activeReader.value?.marks||(activeView.value as any)?.marks)
const isPdfMode=computed(()=>(activeView.value as any)?.isPdf||false)
const pageCount=computed(()=>(activeView.value as any)?.pageCount||0)
const data=computed(()=>{
  refreshKey.value
  if(!marks.value)return{bookmarks:[],marks:[],notes:[]}
  const inks=marks.value.getInkAnnotations?.()||[]
  const inksByPage=inks.reduce((acc:any,ink:any)=>{
    if(!acc[ink.page])acc[ink.page]={page:ink.page,type:'ink-group',inks:[],timestamp:ink.timestamp,text:`墨迹标注 - 第${ink.page}页`}
    acc[ink.page].inks.push(ink)
    acc[ink.page].timestamp=Math.max(acc[ink.page].timestamp,ink.timestamp)
    return acc
  },{})
  const inkGroups=Object.values(inksByPage).map((g:any)=>({...g,groupId:`ink-${g.page}`}))
  const shapes=marks.value.getShapeAnnotations?.()||[]
  const shapesByPage=shapes.reduce((acc:any,shape:any)=>{
    if(!acc[shape.page])acc[shape.page]={page:shape.page,type:'shape-group',shapes:[],timestamp:shape.timestamp,text:`形状标注 - 第${shape.page}页`}
    acc[shape.page].shapes.push({...shape})
    acc[shape.page].timestamp=Math.max(acc[shape.page].timestamp,shape.timestamp)
    return acc
  },{})
  const shapeGroups=Object.values(shapesByPage).map((g:any)=>({...g,groupId:`shape-${g.page}`,shapes:[...g.shapes]}))
  return{bookmarks:marks.value.getBookmarks(),marks:[...marks.value.getAnnotations(filter.value.color as any),...inkGroups,...shapeGroups],notes:marks.value.getNotes()}
})
const list=computed(()=>{
  const kw=keyword.value.toLowerCase(),key={bookmark:'bookmarks',mark:'marks'}[props.mode]
  let items=(data.value[key]||[]).filter((m:any)=>!kw||(m.title||m.text||m.note||'').toLowerCase().includes(kw))
  if(props.mode==='mark'&&filter.value.sort!=='time'){
    const sortKey=filter.value.sort==='chapter'?'chapter':'date'
    items.sort((a:any,b:any)=>{
      const ka=sortKey==='chapter'?(a.chapter||'未分类'):formatTime(a.timestamp||0)
      const kb=sortKey==='chapter'?(b.chapter||'未分类'):formatTime(b.timestamp||0)
      return ka===kb?b.timestamp-a.timestamp:ka.localeCompare(kb)
    })
    const groups:any[]=[]
    items.forEach((m:any)=>{
      const key=sortKey==='chapter'?(m.chapter||'未分类'):formatTime(m.timestamp||0)
      let g=groups.find(g=>g.key===key)
      if(!g){g={key,items:[],isGroup:true};groups.push(g)}
      g.items.push(m)
    })
    return isReverse.value?[...groups].reverse():groups
  }
  return isReverse.value?[...items].reverse():items
})
const emptyText=computed(()=>keyword.value?`${props.i18n?.notFound||'未找到'}${placeholders[props.mode].replace(/搜索|\.\.\./g,'')}`:`${props.i18n?.empty||'暂无'}${placeholders[props.mode].replace(/搜索|\.\.\./g,'')}`)
// ===== 目录 =====
let tocView:any,relocateHandler:any,bookmarkObs:IntersectionObserver|null,tocInteract=0

const initToc=async()=>{
  if(props.mode!=='toc'||!tocRef.value)return
  cleanupToc()
  const view=activeView.value
  if(!view?.book?.toc?.length){isPdfMode.value&&(showThumbnail.value=true);return}
  try{
    const{createTOCView}=await import('foliate-js/ui/tree.js')
    const toc=isReverse.value?[...view.book.toc].reverse():view.book.toc
    tocView=createTOCView(toc,goToLocation)
    tocRef.value.innerHTML=''
    tocRef.value.appendChild(tocView.element)
    tocRef.value.addEventListener('scroll',()=>tocInteract=Date.now(),{passive:true})
    if(view?.addEventListener){
      relocateHandler=(e:any)=>Date.now()-tocInteract>1e4&&tocView?.setCurrentHref?.(e.detail?.tocItem?.href)
      view.addEventListener('relocate',relocateHandler)
    }
    requestAnimationFrame(()=>{Date.now()-tocInteract>1e4&&tocView?.setCurrentHref?.(view.lastLocation?.tocItem?.href);setTimeout(addBookmarks,100)})
  }catch(e){console.error('[TOC]',e)}
}

const cleanupToc=()=>{
  activeView.value?.removeEventListener?.('relocate',relocateHandler)
  tocRef.value?.removeEventListener('scroll',()=>tocInteract=Date.now())
  tocRef.value&&(tocRef.value.innerHTML='')
  bookmarkObs?.disconnect()
  relocateHandler=tocView=bookmarkObs=null
}

const addBookmarks=()=>{
  if(!tocRef.value||!marks.value)return
  bookmarkObs?.disconnect()
  const bks=data.value.bookmarks
  bookmarkObs=new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting)return
    const a=e.target as HTMLElement,h=a.getAttribute('href'),l=a.textContent?.trim()
    if(!h||!l||a.querySelector('.toc-bookmark-btn'))return
    const has=bks.some((b:any)=>b.title===l),btn=document.createElement('button')
    btn.className='toc-bookmark-btn b3-tooltips b3-tooltips__w'
    btn.innerHTML='<svg style="width:14px;height:14px"><use xlink:href="#iconBookmark"/></svg>'
    btn.setAttribute('aria-label',has?'移除书签':'添加书签')
    btn.onclick=e=>{e.stopPropagation();e.preventDefault();toggleBookmark(btn,h,l)}
    if(has){btn.style.opacity='1';btn.classList.add('has-bookmark')}
    a.style.position='relative';a.appendChild(btn);bookmarkObs?.unobserve(a)
  }),{root:tocRef.value,rootMargin:'100px'})
  tocRef.value.querySelectorAll('a[href]').forEach(a=>bookmarkObs?.observe(a))
}

const toggleBookmark=async(btn:HTMLButtonElement,href:string,label:string)=>{
  const view=activeView.value
  if(!marks.value||!view)return showMessage('书签功能未初始化',2000,'error')
  try{
    tocInteract=Date.now()
    btn.style.transform='translateY(-50%) scale(1.3)'
    await view.goTo(href)
    await new Promise(r=>setTimeout(r,200))
    const add=marks.value.toggleBookmark(undefined,undefined,label)
    btn.classList.toggle('has-bookmark',add)
    btn.style.opacity=add?'1':'0'
    btn.setAttribute('aria-label',add?'移除书签':'添加书签')
    btn.style.transform=`translateY(-50%) scale(${add?1.2:0.8})`
    setTimeout(()=>btn.style.transform='translateY(-50%) scale(1)',150)
    showMessage(add?'已添加':'已删除',1500,'info')
  }catch(e:any){
    btn.style.transform='translateY(-50%) scale(1)'
    showMessage(e.message||'操作失败',2000,'error')
  }
}

// ===== 操作 =====
const getKey=(m:any)=>m.id||m.cfi||(m.page?`${m.page}`:`section-${m.section}`)
const isEditing=(m:any)=>editingId.value===getKey(m)
const showEditOptions=(m:any)=>m.type==='shape'||m.type==='highlight'||m.type==='note'||!m.type
const showMsg=(msg:string,type='info')=>showMessage(msg,type==='error'?3000:1500,type as any)
const removeBookmark=(m:any)=>{marks.value?.deleteBookmark?.(getKey(m));showMsg('已删除');refreshKey.value++}
const startEdit=(m:any)=>{editingId.value=getKey(m);editText.value=m.text||'';editNote.value=m.note||'';editColor.value=m.color||'yellow';editStyle.value=m.style||'highlight';editShapeType.value=m.shapeType||'rect';nextTick(()=>editNoteRef.value?.focus?.())}
const cancelEdit=()=>editingId.value=null
const saveEdit=async(m:any)=>{
  try{
    const u:any={color:editColor.value,note:editNote.value.trim()||undefined}
    if(m.type==='shape')u.shapeType=editShapeType.value
    else{u.text=editText.value.trim();u.style=editStyle.value}
    const{saveMarkEdit}=await import('@/utils/copy')
    await saveMarkEdit(m,u,{marks:marks.value,bookUrl:getUrl(),isPdf:(activeView.value as any)?.isPdf||false,reader:activeReader.value,pdfViewer:(activeView.value as any)?.viewer,shapeCache})
    showMsg('已更新');editingId.value=null;refreshKey.value++
  }catch(e:any){showMsg(e.message||'保存失败','error')}
}
const importMark=async(m:any)=>{const{importMark:doImport}=await import('@/utils/copy');const u=getUrl();await doImport(m,{bookUrl:u||'',bookInfo:u?await bookshelfManager.getBook(u):null,isPdf:(activeView.value as any)?.isPdf||false,reader:activeReader.value,pdfViewer:(activeView.value as any)?.viewer,shapeCache,showMsg,i18n:props.i18n,marks:marks.value});refreshKey.value++}
const onBlockEnter=(e:MouseEvent,id:string)=>showFloat(id,e.target as HTMLElement)
const deleteMark=async(m:any)=>{if(!marks.value)return showMsg('标记系统未初始化','error');try{if(m.type==='shape-group'){for(const s of m.shapes||[])await marks.value.deleteMark(s);showMsg('已删除');refreshKey.value++;return}if(m.type==='ink-group'){for(const i of m.inks||[])await marks.value.deleteMark(i);showMsg('已删除');refreshKey.value++;return}if(await marks.value.deleteMark(m)){showMsg('已删除');refreshKey.value++}}catch{showMsg('删除失败','error')}}
const goTo=(m:any)=>jump(m,activeView.value,activeReader.value,marks.value)
const goToPage=(p:number)=>jump(p,activeView.value,activeReader.value,marks.value)
const preloadPage=(p:number)=>{const v=(activeView.value as any)?.viewer;if(v?.renderPage)v.renderPage(p)}
const toggleExpand=(m:any)=>{const id=m.groupId;expandedGroup.value=expandedGroup.value===id?null:id;if(expandedGroup.value){preloadPage(m.page);setTimeout(()=>{renderInkCanvas();renderShapeCanvas()},100)}}
const isExpanded=(m:any)=>expandedGroup.value===m.groupId

// ===== 状态管理 =====
const getUrl=()=>(window as any).__currentBookUrl
const updateBook=async(u:any)=>{const url=getUrl();if(!url)return;await bookshelfManager.updateBook(url,u)}
const loadState=async()=>{
  const b=await bookshelfManager.getBook(getUrl())
  if(!b)return
  filter.value={color:b.filterColor||'',sort:b.filterSort||'time'};isReverse.value=!!b.isReverse
}
const saveState=()=>updateBook({filterColor:filter.value.color,filterSort:filter.value.sort,isReverse:isReverse.value})

// ===== Canvas渲染 =====
const inkCache=new Map(),shapeCache=shapePreviewCache
const copyMark=(item:any)=>copyMarkUtil(item,{
  bookUrl:(window as any).__currentBookUrl||'',
  isPdf:(activeView.value as any)?.isPdf||false,
  reader:activeReader.value,
  pdfViewer:(activeView.value as any)?.viewer,
  settings:activeView.value?.settings,
  shapeCache,
  showMsg
})
const renderInkCanvas=()=>nextTick(()=>renderInkUtil(list.value,inkCache,drawInk))
const renderShapeCanvas=()=>nextTick(()=>renderShapeUtil(list.value,activeView.value,shapeCache,preloadPage))
watch([list,expandedGroup],()=>{inkCache.clear();renderInkCanvas();renderShapeCanvas()},{immediate:true})

// ===== 缩略图 =====
let thumbObs:IntersectionObserver
const initThumbs=()=>nextTick(()=>{
  thumbObs?.disconnect()
  const getThumbnail=(activeView.value as any)?.getThumbnail
  if(!showThumbnail.value||!isPdfMode.value||!pageCount.value||!getThumbnail)return
  thumbObs=new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting)return
    const p=+(e.target as HTMLElement).dataset.page!
    !loadedThumbs.value[p]&&getThumbnail(p).then((u:string)=>u&&(loadedThumbs.value[p]=u))
  }),{root:contentRef.value,rootMargin:'200px'})
  thumbContainer.value?.querySelectorAll('.sr-thumb').forEach(el=>thumbObs.observe(el))
})
watch([showThumbnail,()=>pageCount.value],()=>showThumbnail.value&&initThumbs())

// ===== 生命周期 =====
const refresh=()=>{refreshKey.value++}
const onMarks=()=>props.mode==='toc'?requestAnimationFrame(addBookmarks):refresh()
const onSwitch=()=>{props.mode==='toc'?requestAnimationFrame(initToc):refresh();loadState()}
watch(()=>activeView.value?.book,b=>b?.toc&&props.mode==='toc'?requestAnimationFrame(initToc):cleanupToc(),{immediate:true})
watch(()=>props.mode,onSwitch)
watch(isReverse,()=>{props.mode==='toc'&&requestAnimationFrame(initToc);saveState()})
watch(filter,saveState,{deep:true})
onMounted(()=>{window.addEventListener('sireader:marks-updated',onMarks);window.addEventListener('sireader:tab-switched',onSwitch);setTimeout(loadState,500)})
onUnmounted(()=>{cleanupToc();thumbObs?.disconnect();window.removeEventListener('sireader:marks-updated',onMarks);window.removeEventListener('sireader:tab-switched',onSwitch)})
</script>

<style scoped lang="scss">
@use './deck/deck.scss';
.sr-toc{display:flex;flex-direction:column;height:100%;overflow:hidden}
.dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.sr-menu-section{padding:6px 12px;font-size:11px;font-weight:600;color:var(--b3-theme-on-surface-variant);text-transform:uppercase;letter-spacing:.5px}
.sr-menu-divider{height:1px;background:var(--b3-border-color);margin:4px 0}
.menu-enter-active,.menu-leave-active{transition:all .2s cubic-bezier(.4,0,.2,1)}
.menu-enter-from{opacity:0;transform:translateY(-8px) scale(.95)}
.menu-leave-to{opacity:0;transform:translateY(-4px) scale(.98)}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
.sr-content{flex:1;overflow-y:auto;padding:8px;min-height:0;
  :deep(ol){list-style:none;padding:0;margin:0}
  :deep(li){margin:0;position:relative}
  :deep(a),:deep(span[role="treeitem"]){display:block;padding:10px 48px 10px 12px;margin:2px 4px;color:var(--b3-theme-on-background);text-decoration:none;border-radius:6px;cursor:pointer;transition:all .25s cubic-bezier(.4,0,.2,1);border-left:3px solid transparent;
    &:hover{background:var(--b3-list-hover);transform:translateX(2px);box-shadow:0 1px 3px rgba(0,0,0,.06)}
    &[aria-current="page"]{background:linear-gradient(to right,rgba(25,118,210,.12),rgba(25,118,210,.02));border-left-color:var(--b3-theme-primary);border-left-width:4px;box-shadow:0 2px 8px rgba(25,118,210,.15);font-weight:600;color:var(--b3-theme-primary)}}
  :deep(svg){width:12px;height:12px;margin-right:6px;fill:currentColor;transition:transform .2s;cursor:pointer}
  :deep([aria-expanded="true"]>svg){transform:rotate(0deg)}
  :deep([aria-expanded="false"]>svg){transform:rotate(-90deg)}
  :deep([role="group"]){display:none}
  :deep([aria-expanded="true"]+[role="group"]){display:block}
  :deep(.toc-bookmark-btn){position:absolute;right:12px;top:50%;width:24px;height:24px;padding:0;border:none;background:transparent;cursor:pointer;opacity:0;transform:translateY(-50%);transition:opacity .2s,transform .2s;
    svg{width:14px;height:14px;color:var(--b3-theme-on-surface);transition:color .2s}
    &:hover{transform:translateY(-50%) rotate(15deg);
      svg{color:var(--b3-theme-error)}}
    &.has-bookmark{opacity:1;svg{color:var(--b3-theme-error)}}}
  :deep(a:hover .toc-bookmark-btn),
  :deep(span[role="treeitem"]:hover .toc-bookmark-btn){opacity:1}}
.sr-list{padding:8px}
.expand-enter-active,.expand-leave-active{transition:all .3s ease}
.expand-enter-from,.expand-leave-to{max-height:0;opacity:0;margin-top:0;padding-top:0;padding-bottom:0}
.expand-enter-to,.expand-leave-from{max-height:400px;opacity:1}
.sr-bookmark-item{display:block;padding:10px 48px 10px 12px;margin:2px 4px;color:var(--b3-theme-on-background);border-radius:6px;cursor:pointer;transition:all .25s cubic-bezier(.4,0,.2,1);border-left:3px solid transparent;position:relative;
  &:hover{background:var(--b3-list-hover);transform:translateX(2px);box-shadow:0 1px 3px rgba(0,0,0,.06);.sr-action-btn{opacity:1}}}
.sr-action-btn{position:absolute;right:12px;top:50%;width:24px;height:24px;padding:0;border:none;background:transparent;cursor:pointer;opacity:0;transform:translateY(-50%);transition:opacity .2s,transform .2s;
  svg{width:14px;height:14px;color:var(--b3-theme-error);transition:color .2s}
  &:hover{transform:translateY(-50%) rotate(-15deg)}}

// 统一标注卡片样式
.sr-card{position:relative;padding:12px;margin-bottom:8px;background:var(--b3-theme-surface);border-radius:6px;border:1px solid var(--b3-border-color);transition:background .15s;cursor:pointer;
  &:hover{background:var(--b3-theme-surface-light);.sr-btns,.sr-expand-btn{opacity:1}}}
.sr-card-edit{cursor:default;.sr-main{cursor:default}}
.sr-group{cursor:pointer}
.sr-group-content{display:flex;align-items:center;gap:8px;padding-left:8px}
.sr-group-title{flex:1;font-size:13px;font-weight:600;color:var(--b3-theme-primary)}
.sr-group-count{font-size:11px;padding:2px 8px;background:var(--b3-theme-primary-lightest);color:var(--b3-theme-primary);border-radius:10px}
.sr-bar{position:absolute;left:6px;top:12px;width:4px;height:24px;border-radius:2px;transition:all .2s cubic-bezier(.4,0,.2,1);
  .sr-group &{background:var(--b3-theme-primary);top:50%;transform:translateY(-50%);&.collapsed{border-radius:50%;width:8px;height:8px;left:4px}}}
.sr-main{padding-left:8px}
.sr-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.sr-chapter{font-size:12px;font-weight:500;color:var(--b3-theme-primary);opacity:.85;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-time{font-size:11px;color:var(--b3-theme-on-surface-variant);opacity:.6;white-space:nowrap;flex-shrink:0}
.sr-title{flex:1;font-size:14px;font-weight:500;color:var(--b3-theme-on-surface);line-height:1.4;word-break:break-word;margin-bottom:4px;outline:none;cursor:pointer;&[contenteditable]{padding:4px;border-radius:4px;&:focus{background:var(--b3-theme-background-light)}}}
.sr-meta{font-size:12px;color:var(--b3-theme-on-surface-variant);white-space:nowrap}
.sr-note{font-size:12px;color:var(--b3-theme-on-surface-variant);line-height:1.5;margin-top:4px;font-style:italic;opacity:.8;cursor:text}
.sr-note-input{width:100%;min-height:60px;padding:8px;margin-top:8px;border:1px solid var(--b3-border-color);border-radius:4px;background:var(--b3-theme-background);resize:vertical;font-size:12px;line-height:1.5;outline:none;&:focus{border-color:var(--b3-theme-primary)}}
.sr-options{margin-top:8px;.sr-colors{display:flex;gap:6px;margin-bottom:8px}.sr-color-btn{width:28px;height:28px;border:2px solid transparent;border-radius:50%;cursor:pointer;transition:all .15s;padding:0;&.active{border-color:var(--b3-theme-on-surface);transform:scale(1.1);box-shadow:0 2px 8px rgba(0,0,0,.2)}&:hover{transform:scale(1.05)}}.sr-styles{display:flex;gap:4px}.sr-style-btn{width:36px;height:32px;display:flex;align-items:center;justify-content:center;border:1px solid var(--b3-border-color);background:transparent;border-radius:4px;cursor:pointer;transition:all .15s;color:var(--b3-theme-on-surface);&.active{background:var(--b3-theme-primary-lightest);border-color:var(--b3-theme-primary);color:var(--b3-theme-primary)}&:hover{background:var(--b3-list-hover)}}}
// 统一按钮样式
.sr-btns{position:absolute;right:4px;bottom:-2px;display:flex;gap:4px;opacity:0;transition:opacity .2s;z-index:10;
  button{width:20px;height:20px;padding:0;border:none;background:transparent;cursor:pointer;transition:all .2s;border-radius:50%;pointer-events:auto;
    svg{width:12px;height:12px;color:var(--b3-theme-on-surface-variant);pointer-events:none}
    &:hover{background:rgba(0,0,0,.05);transform:scale(1.1);svg{color:var(--b3-theme-on-surface)}}
    &:last-child svg{color:var(--b3-theme-error)}
    &:last-child:hover{background:rgba(244,67,54,.15)}}}
.sr-expand-btn{position:absolute;right:8px;top:8px;width:24px;height:24px;padding:0;border:none!important;background:transparent!important;outline:none!important;box-shadow:none!important;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;opacity:.4;transition:all .2s;border-radius:50%;
  svg{width:14px;height:14px;color:var(--b3-theme-on-surface)}
  &:hover{opacity:1!important;transform:scale(1.15);background:rgba(0,0,0,.05)!important}}
.sr-sub-list{margin-top:8px;padding-top:8px;border-top:1px solid var(--b3-border-color)}
.sr-sub-item{position:relative;padding:8px;margin:4px 0;border-radius:4px;transition:background .15s;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);
  &:hover{background:var(--b3-theme-background-light);.sr-btns{opacity:1}}}
.sr-preview{width:100%;height:auto;border-radius:4px;background:var(--b3-theme-background);display:block;opacity:.85;cursor:pointer}
.sr-group-preview{height:80px;margin:6px 0}
</style>