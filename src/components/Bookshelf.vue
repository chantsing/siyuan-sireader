<template>
  <div ref="bookshelfEl" class="sr-bookshelf">
    <div class="sr-toolbar">
      <button v-if="currentGroup" @click="selectGroup(null)" class="sr-back"><svg><use xlink:href="#iconBack"/></svg></button>
      <button v-else @click.stop="showGroupMenu"><svg><use xlink:href="#iconFolder"/></svg></button>
      <input v-model="keyword" placeholder="搜索...">
      <button @click.stop="showFilterMenu" :class="{active:activeFilterCount}"><svg><use xlink:href="#lucide-sliders-horizontal"/></svg><span v-if="activeFilterCount">({{activeFilterCount}})</span></button>
      <button @click.stop="showSortMenu"><svg><use xlink:href="#lucide-arrow-up-1-0"/></svg></button>
      <button @click="toggleViewMode"><svg><use :xlink:href="viewModeIcon"/></svg></button>
      <button @click.stop="showAddMenu"><svg><use xlink:href="#lucide-book-plus"/></svg></button>
    </div>
    <input ref="fileInput" type="file" accept=".epub,.pdf,.mobi,.azw3,.azw,.fb2,.cbz,.txt" multiple style="display:none" @change="handleFileUpload">
    <Transition name="slide">
      <div v-if="selectedBooks.size" class="sr-batch-bar">
        <label class="sr-batch-info"><input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll"><span>已选 {{selectedBooks.size}} 本</span></label>
        <div class="sr-batch-actions">
          <button @click="batchOp('rate')"><svg><use xlink:href="#lucide-star"/></svg>评分</button>
          <button @click="batchOp('status')"><svg><use xlink:href="#lucide-circle-check"/></svg>状态</button>
          <button @click="batchOp('remove')" class="danger"><svg><use xlink:href="#lucide-trash-2"/></svg>删除</button>
          <button @click="clearSelection" class="close"><svg><use xlink:href="#lucide-x"/></svg></button>
        </div>
      </div>
    </Transition>
    <div class="sr-books">
      <Transition name="fade" mode="out-in">
        <div v-if="!displayItems.length" key="empty" class="sr-empty">{{keyword?'未找到':'暂无内容'}}</div>
        <div v-else key="items" :class="`sr-${viewMode}`" :style="gridStyle">
          <template v-for="item in displayItems" :key="item.type+'-'+(item.type==='group'?item.data.id:item.data.url)">
            <!-- 分组 -->
            <div v-if="item.type==='group'" :class="['sr-card',viewMode,'sr-group']" @click="selectGroup(item.data.id)" @contextmenu.prevent="showGroupMenu($event,item.data)">
              <div v-if="viewMode==='grid'" class="sr-group-preview">
                <div v-for="(book,i) in groupPreviews[item.data.id]||[]" :key="i" class="sr-preview-item">
                  <img v-if="book&&getCoverUrl(book)" :src="getCoverUrl(book)" :alt="book.title">
                  <div v-else-if="book" class="sr-preview-text" :style="{background:getBookColor(book.title)}">{{book.title}}</div>
                  <div v-else class="sr-preview-empty"><svg><use :xlink:href="item.data.type==='smart'?'#iconStar':'#iconFolder'"/></svg></div>
                </div>
              </div>
              <div v-else class="sr-cover"><svg class="sr-icon"><use :xlink:href="item.data.type==='smart'?'#iconStar':'#iconFolder'"/></svg></div>
              <div :class="viewMode==='grid'?'sr-grid-info':'sr-info'">
                <div class="sr-row">
                  <span class="sr-title">{{item.data.name}}</span>
                  <span class="sr-count">{{groupCounts[item.data.id]||0}} 本</span>
                </div>
              </div>
              <button v-if="viewMode!=='grid'" class="sr-more" @click.stop="showGroupMenu($event,item.data)"><svg><use xlink:href="#lucide-more-vertical"/></svg></button>
              <Transition name="fade">
                <div v-if="confirmDelete?.type==='group'&&confirmDelete.id===item.data.id" class="sr-confirm" @click.stop>
                  <button @click="confirmDelete=null">取消</button>
                  <button @click="deleteGroup(item.data)" class="btn-delete">删除</button>
                </div>
              </Transition>
            </div>
            <!-- 书籍 -->
            <div v-else :class="['sr-card',viewMode,{selected:selectedBooks.has(item.data.url)}]" @click="handleClick(item.data,$event)" @contextmenu.prevent="showContextMenu(item.data,$event)">
              <div v-if="selectedBooks.size" class="sr-check" @click.stop="toggleSelect(item.data)"><input type="checkbox" :checked="selectedBooks.has(item.data.url)"></div>
              <!-- Grid视图 -->
              <div v-if="viewMode==='grid'" class="sr-grid-content">
                <img v-if="getCoverUrl(item.data)" :src="getCoverUrl(item.data)" :alt="item.data.title">
                <div v-else class="sr-text" :style="{background:getBookColor(item.data.title)}">{{item.data.title}}</div>
                <span :class="['sr-tag-format',item.data.format==='online'?'online':item.data.format]">{{item.data.format==='online'?(item.data.source?.originName||'书源'):item.data.format.toUpperCase()}}</span>
                <span v-if="item.data.rating" class="sr-tag sr-tag-rating">{{'★'.repeat(item.data.rating)}}</span>
                <button v-if="item.data.format==='online'" class="sr-tag sr-tag-br" @click.stop="refreshOnline(item.data)"><svg><use xlink:href="#iconRefresh"/></svg></button>
                <div :class="['sr-grid-info',item.data.status]">
                  <span class="sr-status-bg">{{STATUS_MAP[item.data.status]}}</span>
                  <div class="sr-row">
                    <span class="sr-title">{{item.data.title}}</span>
                    <span class="sr-progress">{{getProgress(item.data)}}</span>
                  </div>
                  <span class="sr-author">{{item.data.author}}</span>
                  <div v-if="item.data.tags.length||(item.data.format==='online'&&item.data.source?.lastChapter)" class="sr-tags">
                    <span v-if="item.data.format==='online'&&item.data.source?.lastChapter" class="sr-chip sr-chip-latest">{{item.data.source.lastChapter}}</span>
                    <span v-for="tag in item.data.tags" :key="tag" class="sr-chip" :style="{background:getBookColor(tag)}">{{tag}}</span>
                  </div>
                </div>
              </div>
              <!-- List视图 -->
              <template v-else-if="viewMode==='list'">
                <div class="sr-cover">
                  <img v-if="getCoverUrl(item.data)" :src="getCoverUrl(item.data)" :alt="item.data.title">
                  <div v-else class="sr-text" :style="{background:getBookColor(item.data.title)}">{{item.data.title.slice(0,2)}}</div>
                  <span v-if="item.data.rating" class="sr-cover-rating">{{'★'.repeat(item.data.rating)}}</span>
                </div>
                <div class="sr-info">
                  <div class="sr-row">
                    <span class="sr-title">{{item.data.title}}</span>
                    <span class="sr-progress">{{getProgress(item.data)}}</span>
                  </div>
                  <div class="sr-row">
                    <span class="sr-author">{{item.data.author}}</span>
                    <span :class="['sr-chip',item.data.status]">{{STATUS_MAP[item.data.status]}}</span>
                    <span class="sr-chip sr-chip-format">{{item.data.format==='online'?(item.data.source?.originName||'书源'):item.data.format.toUpperCase()}}</span>
                    <button v-if="item.data.format==='online'" class="sr-icon-sm" @click.stop="refreshOnline(item.data)"><svg><use xlink:href="#iconRefresh"/></svg></button>
                    <span v-if="item.data.source?.lastChapter" class="sr-chip sr-chip-latest">{{item.data.source.lastChapter}}</span>
                  </div>
                  <div v-if="item.data.tags.length" class="sr-row">
                    <span v-for="tag in item.data.tags" :key="tag" class="sr-chip" :style="{background:getBookColor(tag)}">{{tag}}</span>
                  </div>
                </div>
                <button class="sr-more" @click.stop="showContextMenu(item.data,$event)"><svg><use xlink:href="#lucide-more-vertical"/></svg></button>
              </template>
              <!-- Compact视图 -->
              <template v-else>
                <div class="sr-info">
                  <span class="sr-title">{{item.data.title}}</span>
                  <span class="sr-progress">{{getProgress(item.data)}}</span>
                </div>
              </template>
              <Transition name="fade">
                <div v-if="confirmDelete?.type==='book'&&confirmDelete.id===item.data.url" class="sr-confirm" @click.stop>
                  <button @click="confirmDelete=null">取消</button>
                  <button @click="removeBook(item.data)" class="btn-delete">删除</button>
                </div>
              </Transition>
            </div>
          </template>
        </div>
      </Transition>
    </div>
    <!-- 统一侧栏 -->
    <Transition name="slide">
      <div v-if="panelMode" class="sr-panel" :style="{width:panelWidth+'px'}">
        <div class="sr-panel-resize" @mousedown="startResize"></div>
        <div class="sr-panel-header">
          <span>{{panelMode==='add'?'添加书籍':['详情','编辑','筛选'][['detail','edit','filter'].indexOf(panelMode)]||editingGroup?.type==='smart'?'智能分组':'分组'}}</span>
          <button @click="closePanel"><svg><use xlink:href="#lucide-x"/></svg></button>
        </div>
        <div class="sr-panel-body">
          <!-- 书籍详情 -->
          <template v-if="panelMode==='detail'">
            <div v-if="panelBook&&getCoverUrl(panelBook)" class="sr-panel-cover"><img :src="getCoverUrl(panelBook)"></div>
            <div v-for="f in detailFields" :key="f.label" class="sr-panel-field"><label>{{f.label}}</label><span :class="{mono:f.mono}">{{f.value}}</span></div>
          </template>
          <!-- 书籍编辑 -->
          <template v-else-if="panelMode==='edit'">
            <div v-if="panelBook&&getCoverUrl(panelBook)" class="sr-panel-cover"><img :src="getCoverUrl(panelBook)"></div>
            <div v-for="f in editFields" :key="f.key" class="sr-panel-field">
              <label>{{f.label}}</label>
              <input v-if="f.type==='text'" v-model="editForm[f.key]" :placeholder="f.placeholder">
              <select v-else-if="f.type==='select'" v-model="editForm[f.key]"><option v-for="opt in f.options" :key="opt.value" :value="opt.value">{{opt.label}}</option></select>
              <template v-else-if="f.key==='tags'">
                <input v-model="editForm.tags" :placeholder="f.placeholder">
                <div v-if="allTags.length" class="sr-chips"><span v-for="t in allTags.slice(0,8)" :key="t.tag" @click="toggleTag(t.tag)" :class="['sr-chip',{active:editForm.tags.includes(t.tag)}]">#{{t.tag}}</span></div>
              </template>
              <template v-else-if="f.key==='groups'">
                <div v-if="folderGroups.length" class="sr-chips"><span v-for="g in folderGroups" :key="g.id" @click="toggleGroup(g.id)" :class="['sr-chip',{active:editForm.groups.includes(g.id)}]">{{g.name}}</span></div>
                <span v-else style="font-size:12px;opacity:.5">暂无分组</span>
              </template>
              <template v-else-if="f.key==='bind'">
                <input v-if="!editForm.bindDocId" v-model="bindSearch" placeholder="搜索文档..." @input="searchBindDoc">
                <div v-if="bindResults.length" class="sr-chips"><span v-for="d in bindResults.slice(0,8)" :key="d.path||d.id" @click="selectBindDoc(d)" class="sr-chip">{{d.hPath||d.content||'无标题'}}</span></div>
                <div v-else-if="editForm.bindDocId">
                  <div class="sr-chips" style="margin-bottom:8px"><span class="sr-chip active">{{editForm.bindDocName}}</span><span @click="unbindDoc" class="sr-chip" style="background:var(--b3-theme-error);color:white">解绑</span></div>
                  <div class="sr-chips"><span @click="editForm.autoSync=!editForm.autoSync" :class="['sr-chip',{active:editForm.autoSync}]">添加时同步</span><span @click="editForm.syncDelete=!editForm.syncDelete" :class="['sr-chip',{active:editForm.syncDelete}]">删除时同步</span></div>
                </div>
              </template>
            </div>
            <div class="sr-panel-actions"><button @click="cancelEdit" class="btn-cancel">取消</button><button @click="saveEdit" class="btn-save">保存</button></div>
          </template>
          <!-- 分组编辑 -->
          <template v-else-if="panelMode==='group'&&editingGroup">
            <div v-for="f in groupFields" :key="f.key" class="sr-panel-field">
              <label>{{f.label}}</label>
              <input v-if="f.type==='text'" v-model="editingGroup[f.key]" :placeholder="f.placeholder">
              <div v-else-if="f.type==='chips'" class="sr-chips"><span v-for="opt in f.options" :key="opt.value" @click="f.single?editingGroup.rules[f.key]=opt.value:toggleArrayItem(editingGroup.rules[f.key],opt.value)" :class="['sr-chip',{active:f.single?editingGroup.rules[f.key]===opt.value:editingGroup.rules[f.key]?.includes(opt.value)}]">{{opt.label}}</span></div>
            </div>
            <div class="sr-panel-actions"><button @click="cancelGroup" class="btn-cancel">取消</button><button @click="saveGroup" class="btn-save">保存</button></div>
          </template>
          <!-- 添加书籍 -->
          <template v-else-if="panelMode==='add'">
            <div class="sr-panel-field"><label>链接或路径</label><input v-model="urlInput" placeholder="HTTP(S)链接、绝对路径或相对路径" @keyup.enter="previewBook"></div>
            <template v-if="previewBookInfo">
              <div v-if="previewBookInfo.cover" class="sr-panel-cover"><img :src="previewBookInfo.cover"></div>
              <div v-for="f in previewFields" :key="f.label" class="sr-panel-field"><label>{{f.label}}</label><span>{{f.value}}</span></div>
            </template>
            <div class="sr-panel-actions"><button @click="closePanel">取消</button><button v-if="!previewBookInfo" @click="previewBook" :disabled="!urlInput.trim()||previewLoading">{{previewLoading?'加载中...':'预览'}}</button><button v-else @click="confirmAdd" class="btn-save">确认添加</button></div>
          </template>
          <!-- 筛选 -->
          <template v-else-if="panelMode==='filter'">
            <div v-for="s in filterSections" :key="s.key" class="sr-panel-field">
              <label>{{s.label}}</label>
              <div class="sr-chips"><span v-for="opt in s.options" :key="opt.value" @click="toggleFilterItem(s.key,opt.value)" :class="['sr-chip',{active:isFilterActive(s.key,opt.value)}]">{{opt.label}} ({{opt.count}})</span></div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
// 书架组件：grid/list/compact 三种视图，支持分组、筛选、排序、批量操作、编辑、文件导入
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { bookshelfManager, SORTS, STATUS_OPTIONS, STATUS_MAP, RATING_OPTIONS, FORMAT_OPTIONS, type SortType, type Book, type BookStatus, type BookFormat, type GroupConfig } from '@/core/bookshelf'
import { showMessage, Menu, openTab } from 'siyuan'
import { isMobile } from '@/utils/mobile'
import { searchDocs } from '@/composables/useSetting'
import { getDatabase } from '@/core/database'
import { usePlugin } from '@/main'
import { useLicense } from '@/composables/useLicense'

const props = defineProps<{ i18n?: any; coverSize?: number; openDocAssets?: boolean }>()
const emit = defineEmits<{ read: [book: Book] }>()

// 权限检查
const plugin = usePlugin()
const { can, showUpgrade } = useLicense(plugin, props.i18n || {})

// 常量
const MENU_ICONS = {status:{unread:'iconUncheck',reading:'iconEye',finished:'iconCheck'},sort:{time:'iconClock',added:'iconAdd',progress:'iconList',rating:'iconStar',readTime:'iconHistory',name:'iconA',author:'iconAccount',update:'iconRefresh'}}

// 状态
const books = ref<Book[]>([]), groups = ref<GroupConfig[]>([]), allTags = ref<Array<{tag:string;count:number}>>([])
const stats = ref({byStatus:{unread:0,reading:0,finished:0},byFormat:{epub:0,pdf:0,mobi:0,azw3:0,online:0},withUpdate:0})
const keyword = ref(''), currentGroup = ref<string|null>(null), fileInput = ref<HTMLInputElement>(), urlInput = ref('')
const previewBookInfo = ref<any>(null), previewLoading = ref(false)
const filterStatus = ref<BookStatus[]>([]), filterRating = ref(0), filterFormats = ref<BookFormat[]>([]), filterTags = ref<string[]>([]), filterHasUpdate = ref(false)
const sortType = ref<SortType>('time'), sortReverse = ref(false), viewMode = ref<'grid'|'list'|'compact'>('grid')
const selectedBooks = ref<Set<string>>(new Set()), groupCounts = ref<Record<string,number>>({}), groupPreviews = ref<Record<string,any[]>>({})
const editingBook = ref<string|null>(null), editingGroup = ref<GroupConfig|null>(null), confirmDelete = ref<{type:'group'|'book';id:string;item:any}|null>(null)
const panelMode = ref<'detail'|'edit'|'group'|'filter'|'add'|null>(null), panelBook = ref<Book|null>(null), panelWidth = ref(320)
const editForm = ref({title:'',author:'',tags:'',rating:0,status:'unread' as BookStatus,cover:'',groups:[] as string[],bindDocId:'',bindDocName:'',autoSync:false,syncDelete:false})
const bindSearch = ref(''), bindResults = ref<any[]>([]), bookshelfEl = ref<HTMLElement>()
let settingsLoaded = false

// 计算
const folderGroups = computed(() => groups.value.filter(g => g.type==='folder'))
const gridStyle = computed(() => viewMode.value==='grid'?{gridTemplateColumns:`repeat(auto-fill,minmax(${props.coverSize||120}px,1fr))`}:{})
const activeFilterCount = computed(() => filterStatus.value.length+(filterRating.value?1:0)+filterFormats.value.length+filterTags.value.length+(filterHasUpdate.value?1:0))
const viewModeIcon = computed(() => ({grid:'#lucide-panels-top-left',list:'#lucide-list-restart',compact:'#lucide-book-text'})[viewMode.value])
const getSortKey = (item: any, type: string) => {
  if (item.type==='group') return type==='name'?item.data.name:type==='time'?(item.data as any).created||0:item.data.order;
  return type==='name'?item.data.title:type==='time'?item.data.added:type==='progress'?item.data.progress||0:type==='rating'?item.data.rating||0:item.data.added;
}
const displayItems = computed(() => {
  if (currentGroup.value) return books.value.map(b => ({type:'book',data:b}));
  const kw = keyword.value.toLowerCase();
  const items = [
    ...(keyword.value?groups.value.filter(g => g.name.toLowerCase().includes(kw)):groups.value).map(g => ({type:'group',data:g})),
    ...(keyword.value?books.value.filter(b => b.title.toLowerCase().includes(kw)||b.author?.toLowerCase().includes(kw)||b.tags.some(t => t.toLowerCase().includes(kw))):books.value).map(b => ({type:'book',data:b}))
  ];
  return items.sort((a,b) => {
    const ka = getSortKey(a,sortType.value), kb = getSortKey(b,sortType.value);
    return (sortReverse.value?-1:1)*(typeof ka==='string'?ka.localeCompare(kb as string):(ka as number)-(kb as number));
  });
})
const displayGroups = computed(() => displayItems.value.filter(i => i.type==='group').map(i => i.data))
const displayBooks = computed(() => displayItems.value.filter(i => i.type==='book').map(i => i.data))
const isAllSelected = computed(() => displayBooks.value.length>0&&displayBooks.value.every(b => selectedBooks.value.has((b as any).url)))
const filterSections = computed(() => [
  {key:'status',label:'状态',options:STATUS_OPTIONS.map(([k,v]) => ({value:k,label:v,count:stats.value.byStatus[k]}))},
  {key:'rating',label:'评分',options:RATING_OPTIONS.map(([k,v]) => ({value:k,label:v,count:0}))},
  {key:'format',label:'格式',options:FORMAT_OPTIONS.map(f => ({value:f,label:f.toUpperCase(),count:stats.value.byFormat[f]}))},
  {key:'tags',label:'标签',options:allTags.value.slice(0,20).map(t => ({value:t.tag,label:t.tag,count:t.count}))},
  {key:'update',label:'更新',options:[{value:'hasUpdate',label:'有更新',count:stats.value.withUpdate}]}
])

// 基础
const selectGroup = (id: string|null) => currentGroup.value=id
const toggleViewMode = () => {const modes = ['grid','list','compact'] as const; viewMode.value=modes[(modes.indexOf(viewMode.value)+1)%3]}
const getBookColor = (title: string) => bookshelfManager.getBookColor(title)
const getCoverUrl = (book: Book) => bookshelfManager.getCoverUrl(book)
const getProgress = (book: Book) => book.format === 'online' && book.total ? `${(book.chapter ?? 0) + 1}/${book.total}` : `${book.progress || 0}%`
const toggleArrayItem = (arr: any[], value: any) => {const i = arr.indexOf(value); i>-1?arr.splice(i,1):arr.push(value)}
const toggleFilterItem = (key: string, value: any) => {
  const target = filterMap[key];
  key==='rating'?target.value=value:key==='update'?target.value=!target.value:toggleArrayItem(target.value,value);
}
const isFilterActive = (key: string, value: any) => {
  const target = filterMap[key];
  return key==='rating'?target.value===value:key==='update'?target.value:target.value.includes(value);
}
const filterMap = {status:filterStatus,rating:filterRating,format:filterFormats,tags:filterTags,update:filterHasUpdate}

// 在线书籍刷新
const refreshOnline = async (book: Book) => {
  try {
    const { refreshOnlineBook } = await import('@/core/online')
    await refreshOnlineBook(book, refresh, showMessage)
  } catch (e: any) {
    showMessage(`刷新失败: ${e.message}`, 3000, 'error')
  }
}

// 刷新
const refreshGroups = async () => {
  groups.value = await bookshelfManager.getGroups();
  await Promise.all(groups.value.map(async g => {
    const [count,preview]=await Promise.all([bookshelfManager.getGroupCount(g.id,groups.value),bookshelfManager.getGroupPreviewBooks(g.id,4,groups.value)]);
    groupCounts.value[g.id]=count;groupPreviews.value[g.id]=[...preview,...Array(4)].slice(0,4);
  }));
}
const loadBooks = async () => {
  if (currentGroup.value) {
    const group = groups.value.find(g=>g.id===currentGroup.value);
    if (group?.type==='smart') {books.value=await bookshelfManager.getGroupBooks(currentGroup.value); stats.value=await bookshelfManager.getStats(); return}
  }
  books.value = await bookshelfManager.filterBooks({
    groups:currentGroup.value?[currentGroup.value]:(!keyword.value?[]:undefined), sortBy:sortType.value, reverse:sortReverse.value,
    status:filterStatus.value.length?filterStatus.value:undefined, rating:filterRating.value||undefined,
    formats:filterFormats.value.length?filterFormats.value:undefined, tags:filterTags.value.length?filterTags.value:undefined,
    hasUpdate:filterHasUpdate.value||undefined
  });
  if (!currentGroup.value&&!keyword.value) books.value=books.value.filter(b=>!b.groups.length);
  stats.value = await bookshelfManager.getStats();
}
const refresh = () => Promise.all([loadBooks(),refreshGroups()])

// 分组
const startEditGroup = (g?: GroupConfig, type: 'folder'|'smart' = 'folder') => {
  if (!g && !can.value(type==='smart'?'smart-group':'folder-group')) return showUpgrade(type==='smart'?'智能分组':'文件夹分组')
  editingGroup.value = g ? {...g, rules: g.rules || {tags:[],format:[],status:[],rating:0}} : {id: `group_${Date.now()}`, name: '', icon: type==='smart'?'⚡':'📁', order: groups.value.length, type, rules: {tags:[],format:[],status:[],rating:0}};
  panelMode.value = 'group';
}
const saveGroup = async () => {
  if (!editingGroup.value?.name.trim()) return cancelGroup();
  const allGroups = await bookshelfManager.getGroups(), exists = allGroups.find(g => g.id === editingGroup.value!.id);
  await bookshelfManager.saveGroups(exists ? allGroups.map(g => g.id === editingGroup.value!.id ? {...editingGroup.value!} : g) : [...allGroups, editingGroup.value]);
  await refresh(); showMessage(`已${exists?'更新':'创建'}：${editingGroup.value.name}`, 2000, 'info'); cancelGroup();
}
const cancelGroup = () => closePanel()
const deleteGroup = async (g: GroupConfig) => {
  await bookshelfManager.deleteGroup(g.id); if (currentGroup.value === g.id) currentGroup.value = null;
  confirmDelete.value = null; await refresh(); showMessage(`已删除：${g.name}`, 2000, 'info');
}

// 菜单
const buildMenu = (items: any[]) => {const m=new Menu(); items.forEach(i=>m.addItem(i)); return m}
const showGroupMenu = (e?: MouseEvent, g?: GroupConfig) => {const m=buildMenu(g ? [
  {icon:'iconEdit',label:g.type==='smart'?'编辑规则':'重命名',click:()=>startEditGroup(g)},
  {icon:'iconTrashcan',label:'删除',click:()=>(m.close(),confirmDelete.value={type:'group',id:g.id,item:g})}
] : [
  {icon:'iconAdd',label:'新建文件夹',click:()=>startEditGroup()},
  {icon:'iconStar',label:'新建智能分组',click:()=>startEditGroup(undefined,'smart')},
  {icon:'iconPDF',label:'同步 Assets PDF',click:async()=>{if (!can.value('doc-assets')) return showUpgrade('文档assets同步'); const r=await bookshelfManager.syncAssetsPDF().catch(()=>null);await refresh();showMessage(r?`+${r.added} -${r.removed} =${r.total}`:'失败',1500,r?'info':'error')}},
  ...(groups.value.length?[{type:'separator'}]:[]),
  ...groups.value.map(gr=>({icon:gr.type==='smart'?'iconStar':'iconFolder',label:`${gr.name} (${groupCounts.value[gr.id]||0})`,click:()=>selectGroup(gr.id)}))
]); m.open({x:e?.clientX||0,y:e?.clientY||0})}
const showFilterMenu = () => panelMode.value = 'filter'
const showSortMenu = (e: MouseEvent) => buildMenu([...SORTS.map(([k,v])=>({icon:MENU_ICONS.sort[k]||'iconSort',label:v,click:()=>sortType.value=k})),{type:'separator'},{icon:'iconSort',label:'反向排序',click:()=>sortReverse.value=!sortReverse.value}]).open({x:e.clientX,y:e.clientY})

// 书籍
const bookOps = {
  rating: (url: string, val: any) => bookshelfManager.updateRating(url, val),
  status: (url: string, val: any) => bookshelfManager.updateStatus(url, val),
  group: (url: string, val: any) => bookshelfManager.moveBookToGroup(url, val === 'home' ? null : val)
}
const updateBookField = async (book: Book, field: string, value: any, msg: string) => {
  await bookOps[field](book.url, value);
  await (field === 'group' ? refresh() : loadBooks()); showMessage(msg, 2000, 'info');
}
const readBook = async (book: Book) => {if(!props.openDocAssets&&book.format==='pdf'&&book.url.startsWith('asset://')){const plugin=usePlugin();openTab({app:(plugin as any).app,pdf:{path:book.url.replace('asset://','')},position:'right'});return}const {getBookWithFallback,findOpenedTab} = await import('@/utils/bookOpen');const full = await getBookWithFallback(bookshelfManager,book.url);if(!full)return showMessage('加载失败',3000,'error');const tab = findOpenedTab(full.title);if(tab)return tab.click();if(isMobile()){window.dispatchEvent(new CustomEvent('reader:open',{detail:{book:full}}))}else{emit('read',full)}}
const removeBook = async (book: Book) => {const res = await bookshelfManager.removeBooks([book.url]); confirmDelete.value = null; await refresh(); showMessage(res.failed ? '删除失败' : '已移出', 2000, res.failed ? 'error' : 'info');}
const showAddMenu = (e: MouseEvent) => buildMenu([{icon:'iconLink',label:'添加链接',click:()=>{if (!can.value('advanced-add')) return showUpgrade('高级添加方式'); panelMode.value='add';urlInput.value='';previewBookInfo.value=null}},{icon:'iconUpload',label:'选择文件',click:()=>fileInput.value?.click()}]).open({x:e.clientX,y:e.clientY})
const handleFileUpload = async (e: Event) => {const files = Array.from((e.target as HTMLInputElement).files||[]); if (!files.length) return; const {success, failed} = await bookshelfManager.uploadBooks(files); await loadBooks(); showMessage(failed ? (success ? `成功${success}本，失败${failed}本` : '导入失败') : `导入${success}本`, 3000, failed && !success ? 'error' : 'info'); if (fileInput.value) fileInput.value.value = '';}
const previewBook = async () => {if (!urlInput.value.trim()||previewLoading.value) return; previewLoading.value = true; try { previewBookInfo.value = await bookshelfManager.previewUrlBook(urlInput.value.trim()) } catch(e) { showMessage(e instanceof Error?e.message:'预览失败',2000,'error') } finally { previewLoading.value = false }}
const confirmAdd = async () => {try { await bookshelfManager.addUrlBook(urlInput.value.trim()); await loadBooks(); showMessage('添加成功',2000,'info'); closePanel() } catch(e) { showMessage(e instanceof Error?e.message:'添加失败',2000,'error') }}
const previewFields = computed(() => {
  if (!previewBookInfo.value) return []
  const m = previewBookInfo.value
  return [{label:'书名',value:m.title},{label:'作者',value:m.author},{label:'格式',value:m.format?.toUpperCase()},{label:'出版社',value:m.publisher},{label:'出版日期',value:m.published},{label:'语言',value:m.language},{label:'ISBN',value:m.identifier},{label:'简介',value:m.intro}].filter(f=>f.value)
})
const handleClick = (book: Book, e?: MouseEvent) => {if (selectedBooks.value.size || e?.ctrlKey || e?.metaKey) return toggleSelect(book); readBook(book);}

// 选择
const showContextMenu = (book: Book, e: MouseEvent) => {
  const hasBinding = !!(book as any).bindDocId, m=buildMenu([
    {icon:'iconPlay',label:'打开阅读',click:()=>readBook(book)},
    {icon:'iconInfo',label:'详细信息',click:()=>showPanel('detail',book)},
    {icon:'iconStar',label:'评分',type:'submenu',submenu:[...Array(5)].map((_,i)=>({icon:'iconStar',label:`${'★'.repeat(i+1)} ${i+1}星`,click:()=>updateBookField(book,'rating',i+1,`已评 ${i+1} 星`)})).concat([{type:'separator'},{icon:'iconClose',label:'清除',click:()=>updateBookField(book,'rating',0,'已清除评分')}])},
    {icon:'iconCheck',label:'标记状态',type:'submenu',submenu:STATUS_OPTIONS.map(([k,v])=>({icon:MENU_ICONS.status[k],label:v,click:()=>updateBookField(book,'status',k,`已标记为${v}`)}))},
    {icon:'iconFolder',label:'移动到',type:'submenu',submenu:(book.groups.length?[{icon:'iconFiles',label:'首页',click:()=>updateBookField(book,'group','home','已移动到首页')},...(folderGroups.value.length?[{type:'separator'}]:[])]:[] as any[]).concat(folderGroups.value.map(g=>({icon:'iconFolder',label:g.name,click:()=>updateBookField(book,'group',g.id,`已移动到：${g.name}`)})))},
    {icon:hasBinding?'iconLinkOff':'iconLink',label:hasBinding?'解除绑定':'绑定思源',click:()=>{if (!can.value('book-edit')) return showUpgrade('书籍编辑'); showPanel('edit',book)}},
    {type:'separator'},
    {icon:'iconEdit',label:'编辑信息',click:()=>{if (!can.value('book-edit')) return showUpgrade('书籍编辑'); showPanel('edit',book)}},
    {icon:'iconTrashcan',label:'移出书架',click:()=>(m.close(),confirmDelete.value={type:'book',id:book.url,item:book})}
  ]); m.open({x:e.clientX,y:e.clientY});
}
const toggleSelect = (book: Book) => selectedBooks.value.has(book.url) ? selectedBooks.value.delete(book.url) : selectedBooks.value.add(book.url)
const toggleSelectAll = () => isAllSelected.value ? selectedBooks.value.clear() : displayBooks.value.forEach(b => selectedBooks.value.add(b.url))
const clearSelection = () => selectedBooks.value.clear()
const batchOp = async (op: 'rate'|'status'|'remove') => {if (!can.value('batch-operation')) return showUpgrade('批量操作'); const urls = Array.from(selectedBooks.value), showResult = async (res: any, action: string) => {clearSelection(); await refresh(); showMessage(res.failed?`成功${res.success}本，失败${res.failed}本`:`${action} ${res.success} 本`,2000,res.failed?'error':'info')}; if (op === 'remove') {if (!confirm(`确定移出 ${urls.length} 本书籍？`)) return; return showResult(await bookshelfManager.removeBooks(urls),'已移出')}; buildMenu(op === 'rate' ? [
    ...[...Array(5)].map((_,i)=>({icon:'iconStar',label:`${'★'.repeat(i+1)} ${i+1}星`,click:async()=>showResult(await bookshelfManager.batchUpdateRating(urls,i+1),'已评分')})),
    {type:'separator'},{icon:'iconClose',label:'清除评分',click:async()=>showResult(await bookshelfManager.batchUpdateRating(urls,0),'已清除')}
  ] : STATUS_OPTIONS.map(([k,v])=>({icon:MENU_ICONS.status[k],label:v,click:async()=>showResult(await bookshelfManager.batchUpdateStatus(urls,k),'已更新')}))).open({x:window.innerWidth/2,y:window.innerHeight/2});
}

// 编辑
const editFields = computed(() => [
  {key:'title',label:'书名',type:'text',placeholder:'书名'},{key:'author',label:'作者',type:'text',placeholder:'作者'},{key:'cover',label:'封面',type:'text',placeholder:'封面图片URL'},
  {key:'rating',label:'评分',type:'select',options:[{value:0,label:'无评分'},...[1,2,3,4,5].map(i=>({value:i,label:'★'.repeat(i)+` ${i}星`}))]},
  {key:'status',label:'状态',type:'select',options:STATUS_OPTIONS.map(([k,v])=>({value:k,label:v}))},
  {key:'tags',label:'标签',type:'tags',placeholder:'用逗号分隔'},{key:'groups',label:'分组',type:'groups'},{key:'bind',label:'绑定思源',type:'bind'}
])
const groupFields = computed(() => editingGroup.value ? [
  {key:'name',label:'名称',type:'text',placeholder:'分组名称'},
  ...(editingGroup.value.type==='smart'?[
    {key:'tags',label:'标签',type:'chips',options:allTags.value.slice(0,10).map(t=>({value:t.tag,label:t.tag}))},
    {key:'format',label:'格式',type:'chips',options:FORMAT_OPTIONS.map(f=>({value:f,label:f.toUpperCase()}))},
    {key:'status',label:'状态',type:'chips',options:STATUS_OPTIONS.map(([k,v])=>({value:k,label:v}))},
    {key:'rating',label:'评分',type:'chips',options:[{value:0,label:'全部'},...[1,2,3,4,5].map(i=>({value:i,label:`≥${i}★`}))],single:true}
  ]:[])
] : [])
const handleEdit = (book: Book) => {
  editingBook.value = book.url; panelMode.value = 'edit'; panelBook.value = book; resetEditForm(); const b = book as any;
  Object.assign(editForm.value, {title:b.title, author:b.author, tags:b.tags.join(', '), rating:b.rating||0, status:b.status, cover:b.cover||'', groups:b.groups||[], bindDocId:b.bindDocId||'', bindDocName:b.bindDocName||'', autoSync:b.autoSync||false, syncDelete:b.syncDelete||false});
}
const resetEditForm = () => {editForm.value = {title:'', author:'', tags:'', rating:0, status:'unread', cover:'', groups:[], bindDocId:'', bindDocName:'', autoSync:false, syncDelete:false}; bindSearch.value = ''; bindResults.value = []}
const cancelEdit = () => {editingBook.value = null; resetEditForm(); closePanel()}
const saveEdit = async () => {
  if (!editingBook.value) return; const result = await bookshelfManager.updateBookInfo(editingBook.value, editForm.value);
  if (!result.success) return showMessage(result.error||'保存失败', 2000, 'error');
  await refresh(); allTags.value = await bookshelfManager.getAllTags(); showMessage('保存成功', 2000, 'info'); cancelEdit();
}
const toggleTag = (tag: string) => {const tags = editForm.value.tags.split(/[,，]/).map(t => t.trim()).filter(t => t); toggleArrayItem(tags, tag); editForm.value.tags = tags.join(', ')}
const toggleGroup = (gid: string) => toggleArrayItem(editForm.value.groups, gid)
const searchBindDoc = async () => {if (!bindSearch.value.trim()) {bindResults.value = []; return}; try {bindResults.value = await searchDocs(bindSearch.value.trim())} catch {bindResults.value = []}}
const selectBindDoc = (d: any) => {const id = d.path?.split('/').pop()?.replace('.sy', '')||d.id; if (!id) return showMessage('文档ID无效', 2000, 'error'); editForm.value.bindDocId = id; editForm.value.bindDocName = d.hPath||d.content||'无标题'; bindSearch.value = ''; bindResults.value = [];}
const unbindDoc = () => {editForm.value.bindDocId = ''; editForm.value.bindDocName = ''}
const showPanel = async (mode: 'detail'|'edit'|'group', book?: Book, group?: GroupConfig) => {
  panelMode.value = mode; 
  if (book) {
    const db = await getDatabase();
    panelBook.value = await db.getBook(book.url) || book;
    if (mode === 'edit') handleEdit(panelBook.value);
  } 
  if (group) startEditGroup(group);
}
const closePanel = () => {panelMode.value = null; panelBook.value = null; editingBook.value = null; editingGroup.value = null}
const startResize = (e: MouseEvent) => {
  const {clientX, offsetWidth = 800} = {clientX: e.clientX, offsetWidth: bookshelfEl.value?.offsetWidth}, w = panelWidth.value
  const move = (e: MouseEvent) => panelWidth.value = Math.max(280, Math.min(offsetWidth - 20, w + clientX - e.clientX))
  const up = () => {document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); settingsLoaded && getDatabase().then(db => db.saveSetting('bookshelf_panelWidth', panelWidth.value))}
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
}
// 详情
const fmt = {
  bytes: (n: number) => {const k=1024,i=n<k?0:Math.floor(Math.log(n)/Math.log(k)); return (n/Math.pow(k,i)).toFixed(1)+' '+['B','KB','MB','GB'][i]},
  date: (ts: number) => ts?new Date(ts).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'-',
  time: (s: number) => {const h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return h?`${h}小时${m}分钟`:`${m}分钟`}
}
const detailFields = computed(() => {
  if (!panelBook.value||panelMode.value!=='detail') return [];
  const b = panelBook.value as any, m = b.meta||{};
  return [
    ['书名',b.title],['作者',b.author],['格式',b.format.toUpperCase()],['进度',(b.progress||0)+'%'],['状态',STATUS_MAP[b.status]],['评分',b.rating?'★'.repeat(b.rating):'未评分'],
    ['章节',`${b.chapter||0}/${b.total||'-'}`],['时长',fmt.time(b.time||0)],['大小',fmt.bytes(b.size||0)],['添加',fmt.date(b.added)],['最后阅读',fmt.date(b.read)],
    b.finished&&['完成',fmt.date(b.finished)],b.tags.length&&['标签',b.tags.join(', ')],b.groups.length&&['分组',groups.value.filter(g=>b.groups.includes(g.id)).map(g=>g.name).join(', ')],
    b.bindDocName&&['绑定文档',b.bindDocName],m.publisher&&['出版社',m.publisher],m.publishDate&&['出版日期',m.publishDate],m.isbn&&['ISBN',m.isbn],m.series&&['系列',m.series],b.path&&['路径',b.path,true]
  ].filter(Boolean).map(([label,value,mono])=>({label,value,mono}));
})

// 生命周期
onMounted(async () => {
  await bookshelfManager.init();
  const [_,allTagsData]=await Promise.all([refreshGroups(),bookshelfManager.getAllTags()]);
  allTags.value=allTagsData;
  const db = await getDatabase();
  sortType.value = await db.getSetting('bookshelf_sortType') || 'time';
  sortReverse.value = await db.getSetting('bookshelf_sortReverse') || false;
  viewMode.value = await db.getSetting('bookshelf_viewMode') || 'grid';
  panelWidth.value = await db.getSetting('bookshelf_panelWidth') || 320;
  settingsLoaded = true;
  await loadBooks();
  window.addEventListener('sireader:bookshelf-updated', () => Promise.all([loadBooks(),refreshGroups()]));
})
onUnmounted(() => window.removeEventListener('sireader:bookshelf-updated', () => Promise.all([loadBooks(),refreshGroups()])))
watch([filterStatus,filterRating,filterFormats,filterTags,filterHasUpdate,sortType,sortReverse,currentGroup], loadBooks, {deep:true})
watch(sortType, async v => settingsLoaded && await (await getDatabase()).saveSetting('bookshelf_sortType', v))
watch(sortReverse, async v => settingsLoaded && await (await getDatabase()).saveSetting('bookshelf_sortReverse', v))
watch(viewMode, async v => settingsLoaded && await (await getDatabase()).saveSetting('bookshelf_viewMode', v))
</script>

<style scoped lang="scss">
$ease: cubic-bezier(.4,0,.2,1);

.sr-bookshelf{display:flex;flex-direction:column;height:100%;overflow:hidden}
.sr-toolbar{display:flex;gap:8px;padding:12px;border-bottom:1px solid var(--b3-border-color);flex-shrink:0;input{flex:1;min-width:0;height:28px;padding:0 10px;border:none;border-bottom:1px solid var(--b3-border-color);background:transparent;font-size:12px;outline:none;color:var(--b3-theme-on-background);transition:border-color .2s;box-sizing:border-box;&:focus{border-color:var(--b3-theme-primary)}&::placeholder{color:var(--b3-theme-on-surface-variant);opacity:.6}}button{width:28px;height:28px;flex-shrink:0;padding:0;border:none;background:transparent;cursor:pointer;transition:all .15s $ease;color:var(--b3-theme-on-surface);svg{width:16px;height:16px}&:hover{color:var(--b3-theme-primary);transform:scale(1.08)}&:active{transform:scale(.92)}&.active,&.sr-back{color:var(--b3-theme-primary)}}}
.sr-books{flex:1;overflow-y:auto;padding:12px;min-height:0;.sr-list,.sr-compact{padding:0}}
.sr-empty{display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;opacity:.5}
.sr-batch-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;background:var(--b3-theme-surface);border-bottom:1px solid var(--b3-border-color);flex-shrink:0}
.sr-confirm{display:flex;gap:6px;align-items:center;padding:4px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);box-shadow:0 2px 8px rgba(0,0,0,.2);z-index:11;border-radius:4px;position:absolute;right:4px;bottom:4px;button{padding:6px 12px;font-size:13px;line-height:1.4;border:1px solid var(--b3-border-color);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);border-radius:4px;cursor:pointer;transition:all .15s $ease;white-space:nowrap;&:hover{background:var(--b3-list-hover)}&.btn-delete{background:var(--b3-theme-error);color:white;border-color:var(--b3-theme-error);&:hover{opacity:.9}}}}
.sr-batch-info{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--b3-theme-primary);cursor:pointer;input{cursor:pointer}}
.sr-batch-actions{display:flex;gap:4px;button{display:flex;align-items:center;gap:4px;padding:4px 8px;border:none;background:transparent;border-radius:6px;font-size:12px;cursor:pointer;transition:all .15s $ease;svg{width:20px;height:20px}&:hover{background:rgba(var(--b3-theme-on-surface-rgb),.08)}&.danger{color:var(--b3-theme-error);&:hover{background:var(--b3-theme-error);color:white}}&.close{padding:4px}}}
.sr-grid{display:grid;gap:6px}
.sr-list{display:flex;flex-direction:column;gap:4px}
.sr-compact{display:flex;flex-direction:column;gap:1px}
.sr-card{position:relative;cursor:pointer;border-radius:8px;border:2px solid var(--b3-border-color);box-shadow:0 1px 3px rgba(0,0,0,.08);transition:all .3s $ease;overflow:hidden;&:hover{transform:scale(1.05);box-shadow:0 6px 16px rgba(0,0,0,.15);border-color:var(--b3-theme-primary);z-index:10}&.selected{outline:2px solid var(--b3-theme-primary);outline-offset:2px}&.grid{aspect-ratio:2/3;background:var(--b3-theme-surface);.sr-grid-content{position:absolute;inset:0;img,.sr-text{position:absolute;inset:0}img{width:100%;height:100%;object-fit:cover}.sr-text{display:flex;align-items:center;justify-content:center;padding:8px;font-size:12px;font-weight:600;text-align:center;line-height:1.2;color:var(--b3-theme-on-surface);word-break:break-word}}&.sr-group .sr-group-preview{position:absolute;inset:0 0 56px 0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;padding:2px;.sr-preview-item{position:relative;overflow:hidden;border-radius:4px;img{width:100%;height:100%;object-fit:cover}.sr-preview-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:4px;font-size:9px;font-weight:600;line-height:1.3;text-align:center;word-break:break-all;color:var(--b3-theme-on-surface)}.sr-preview-empty{width:100%;height:100%;background:linear-gradient(135deg,rgba(var(--b3-theme-primary-rgb),.08),rgba(var(--b3-theme-primary-rgb),.02));display:flex;align-items:center;justify-content:center;svg{width:20px;height:20px;opacity:.3}}}}}&.list{display:flex;align-items:center;gap:12px;padding:2px;background:var(--b3-theme-surface)}&.compact{display:flex;align-items:center;gap:8px;padding:6px 12px;background:var(--b3-theme-surface);border-width:1px;&:hover{transform:scale(1.01);box-shadow:0 2px 6px rgba(0,0,0,.1)}.sr-info{flex-direction:row;align-items:center;gap:8px}}}
.sr-cover{position:relative;flex-shrink:0;border-radius:6px;overflow:hidden;background:var(--b3-theme-background);width:48px;height:68px;img,.sr-text,.sr-icon{position:absolute;inset:0}img{width:100%;height:100%;object-fit:cover}.sr-text{display:flex;align-items:center;justify-content:center;font-weight:600;text-align:center;color:var(--b3-theme-on-surface);font-size:14px}.sr-icon{display:flex;align-items:center;justify-content:center;color:var(--b3-theme-primary);opacity:.6;svg{width:60%;height:60%}}.sr-cover-rating{position:absolute;top:2px;right:2px;padding:1px 3px;border-radius:4px;font-size:7px;font-weight:700;line-height:1;color:white;background:var(--b3-theme-primary);z-index:1}}
.sr-icon{flex-shrink:0;width:20px;height:20px;color:var(--b3-theme-primary);opacity:.7;cursor:pointer;transition:opacity .15s;border:none;background:transparent;padding:0;svg{width:100%;height:100%}&:hover{opacity:1}}
.sr-icon-sm{flex-shrink:0;width:16px;height:16px;color:var(--b3-theme-primary);opacity:.7;cursor:pointer;transition:opacity .15s;border:none;background:transparent;padding:0;svg{width:100%;height:100%}&:hover{opacity:1}}
.sr-check{position:absolute;top:6px;left:6px;z-index:10;width:20px;height:20px;display:flex;align-items:center;justify-content:center;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,.1);input{cursor:pointer;width:16px;height:16px}}
.sr-tag{position:absolute;top:6px;z-index:10;padding:4px 8px;border-radius:6px;font-size:9px;font-weight:700;line-height:1;color:white;&.sr-tag-rating{right:6px;background:var(--b3-theme-primary)}&.sr-tag-br{right:6px;bottom:56px;top:auto;width:28px;height:28px;padding:0;background:rgba(0,0,0,.7);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;svg{width:14px;height:14px}&:hover{background:var(--b3-theme-primary);transform:rotate(180deg)}}}
.sr-tag-format{position:absolute;top:6px;left:6px;z-index:10;padding:4px 8px;border-radius:6px;font-size:9px;font-weight:700;line-height:1;color:white;&.epub{background:#3b82f6}&.pdf{background:#ef4444}&.mobi{background:#8b5cf6}&.azw3{background:#ec4899}&.azw{background:#f59e0b}&.fb2{background:#10b981}&.cbz{background:#06b6d4}&.txt{background:#6b7280}&.online{background:#14b8a6}}
.sr-title,.sr-author,.sr-progress,.sr-count{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1;margin:0;padding:0}
.sr-title{font-size:13px;font-weight:700;color:var(--b3-theme-on-surface);flex:1;min-width:0}
.sr-author{font-size:12px;color:var(--b3-theme-on-surface-variant)}
.sr-progress,.sr-count{font-size:12px;color:var(--b3-theme-primary);font-weight:600;flex-shrink:0}
.sr-chip{display:inline-block;padding:2px 6px;border-radius:10px;font-size:10px;font-weight:500;white-space:nowrap;flex-shrink:0;color:#333;&.unread,&.reading,&.finished,&.sr-chip-rating{color:white}&.unread{background:#9ca3af}&.reading,&.sr-chip-rating{background:var(--b3-theme-primary)}&.finished{background:#22c55e}&.sr-chip-format{background:var(--b3-theme-surface-lighter);color:var(--b3-theme-on-surface-variant);font-weight:600}&.sr-chip-latest{background:transparent;color:var(--b3-theme-on-surface-variant);font-size:11px;overflow:hidden;text-overflow:ellipsis;max-width:300px;padding:0}}
.sr-row{display:flex;align-items:center;gap:8px;width:100%}
.sr-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;position:relative;padding-right:32px;.sr-progress{position:absolute;top:0;right:10px}}
.sr-grid-info{position:absolute;bottom:0;left:0;right:0;background:var(--b3-theme-surface);border-top:1px solid var(--b3-border-color);padding:6px 8px;display:flex;flex-direction:column;gap:3px;overflow:hidden;.sr-status-bg{position:absolute;right:-4px;bottom:-8px;font-size:36px;font-weight:900;line-height:1;opacity:.24;pointer-events:none;white-space:nowrap;letter-spacing:-1px}&.unread .sr-status-bg{color:#9ca3af}&.reading .sr-status-bg{color:var(--b3-theme-primary)}&.finished .sr-status-bg{color:#22c55e}.sr-row,.sr-author,.sr-tags{position:relative}}
.sr-tags{display:flex;gap:3px;overflow:hidden;width:100%;flex-wrap:nowrap;line-height:1;margin:0;padding:0}
.sr-more{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;border-radius:6px;cursor:pointer;transition:background .15s $ease;flex-shrink:0;svg{width:14px;height:14px}&:hover{background:rgba(var(--b3-theme-on-surface-rgb),.08)}}
.slide-enter-from,.slide-leave-to{transform:translateY(-100%);opacity:0}
.fade-enter-active,.fade-leave-active{transition:opacity .2s}
.fade-enter-from,.fade-leave-to{opacity:0}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
.sr-panel{position:absolute;top:0;right:0;bottom:0;min-width:280px;background:var(--b3-theme-surface);border-left:1px solid var(--b3-border-color);box-shadow:-2px 0 8px rgba(0,0,0,.1);z-index:100;display:flex;flex-direction:column}
.sr-panel-resize{position:absolute;left:-2px;top:0;bottom:0;width:4px;cursor:ew-resize;z-index:101;&::after{content:'';position:absolute;left:2px;top:0;bottom:0;width:1px;background:var(--b3-border-color);transition:all .2s}&:hover::after,&:active::after{background:var(--b3-theme-primary);width:2px;left:1px}}
.sr-panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--b3-border-color);font-size:14px;font-weight:600;button{width:24px;height:24px;padding:0;border:none;background:transparent;cursor:pointer;svg{width:16px;height:16px}&:hover{color:var(--b3-theme-primary)}}}
.sr-panel-body{flex:1;overflow-y:auto;padding:16px}
.sr-panel-cover{width:120px;height:170px;margin:0 auto 16px;border-radius:6px;overflow:hidden;img{width:100%;height:100%;object-fit:cover}}
.sr-panel-field{display:flex;flex-direction:column;gap:4px;padding:8px 0;border-bottom:1px solid var(--b3-border-color);font-size:12px;&:last-child{border-bottom:none}label{color:var(--b3-theme-on-surface-variant);font-weight:500}span{color:var(--b3-theme-on-surface);word-break:break-word;line-height:1.4;&.mono{font-size:10px;font-family:monospace;opacity:.8;word-break:break-all}}input,select{width:100%;padding:6px 8px;border:1px solid var(--b3-border-color);border-radius:4px;font-size:12px;background:var(--b3-theme-background);color:var(--b3-theme-on-surface);box-sizing:border-box;&:focus{outline:none;border-color:var(--b3-theme-primary)}}}
.sr-panel-actions{display:flex;gap:8px;padding-top:16px;border-top:1px solid var(--b3-border-color);button{flex:1;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:13px;transition:all .15s;border:1px solid var(--b3-border-color);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);&:hover{background:var(--b3-list-hover)}&.btn-save{background:var(--b3-theme-primary);color:white;border-color:var(--b3-theme-primary);&:hover{opacity:.9;background:var(--b3-theme-primary)}}}}
.sr-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;.sr-chip{padding:3px 8px;background:var(--b3-theme-background);border:1px solid var(--b3-border-color);color:var(--b3-theme-on-surface);border-radius:10px;font-size:11px;cursor:pointer;transition:all .15s;&:hover{background:var(--b3-list-hover)}&.active{background:var(--b3-theme-primary-lightest);color:var(--b3-theme-primary);border-color:var(--b3-theme-primary)}}}
</style>
