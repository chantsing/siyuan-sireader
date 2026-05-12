<template>
  <div v-if="mode === 'compact'" class="fn__flex-1 fn__flex-column sy__file bs-view bs-tree" @dragover="handleRootDragOver" @drop="handleRootDrop">
    <div class="fn__flex-1 bs-tree__scroll" @mouseover="onCompactHover">
      <ul class="b3-list b3-list--background bs-tree__home" :class="{ 'is-visible': showHomeDrop }">
        <li
          class="b3-list-item b3-list-item--hide-action"
          :class="{ 'is-drop-target': dragHomeActive }"
          @dragover="handleHomeDragOver"
          @dragleave="handleHomeDragLeave"
          @drop="handleHomeDrop"
        >
          <span class="b3-list-item__toggle b3-list-item__toggle--hl">
            <span class="bs-tree__marker"></span>
          </span>
          <span class="b3-list-item__text ariaLabel">{{ HOME_DROP_LABEL }}</span>
        </li>
      </ul>
      <ul v-for="row in compactRows" :key="row.key" class="b3-list b3-list--background">
        <li
          class="b3-list-item b3-list-item--hide-action"
          data-type="navigation-root"
          data-playlist-item
          :class="{ 'bs-tree__item--child': row.level > 0, 'bs-tree__item--group': row.kind === 'group', 'bs-tree__item--book': row.kind === 'book', 'is-drop-target': isGroupDropTarget(row) }"
          :draggable="row.kind === 'book'"
          @click="handleCompactClick(row, $event)"
          @contextmenu.prevent.stop="handleCompactContextMenu(row, $event)"
          @dragstart="row.kind === 'book' && isBook(row.item) ? handleBookDragStart(row.item.data, $event) : undefined"
          @dragend="handleBookDragEnd"
          @dragover="handleGroupDragOver(row, $event)"
          @dragleave="handleGroupDragLeave(row)"
          @drop="handleGroupDrop(row, $event)"
        >
          <span class="b3-list-item__toggle b3-list-item__toggle--hl" :style="{ paddingLeft: `${row.level * 18}px` }">
            <svg v-if="row.kind === 'group'" class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': isCompactExpanded(row.item.data.id) }"><use xlink:href="#iconRight" /></svg>
            <span v-else class="bs-tree__marker"></span>
          </span>
          <span class="b3-list-item__text ariaLabel" data-playlist-item>{{ mainText(row.item) }}</span>
          <span class="fn__space"></span>
          <span class="b3-list-item__meta" data-playlist-item>{{ compactMeta(row.item) }}</span>
        </li>
      </ul>
    </div>
  </div>

  <div v-else-if="mode === 'grid'" class="bs-view bs-grid" :style="gridStyle" @dragover="handleRootDragOver" @drop="handleRootDrop">
      <div class="bs-home-drop" :class="{ 'is-visible': showHomeDrop, 'is-drop-target': dragHomeActive }" @dragover="handleHomeDragOver" @dragleave="handleHomeDragLeave" @drop="handleHomeDrop">
        {{ HOME_DROP_LABEL }}
      </div>
      <div
        v-for="item in items"
        :key="itemKey(item)"
        class="bs-grid-item"
        :draggable="isBook(item)"
        @click="handleClick(item, $event)"
        @contextmenu.prevent="handleContextMenu(item, $event)"
        @dragstart="handleItemDragStart(item, $event)"
        @dragend="handleBookDragEnd"
        @dragover="handleGroupDragOver(item, $event)"
        @dragleave="handleGroupDragLeave(item)"
        @drop="handleGroupDrop(item, $event)"
      >
      <div class="bs-cover" :class="{ 'is-drop-target': isGroupDropTarget(item) }">
        <img :src="coverSrc(item)" :alt="mainText(item)" loading="lazy" decoding="async">
        <template v-if="isBook(item)">
          <span v-if="item.data.rating" class="bs-badge bs-badge--left">{{ starText(item.data.rating) }}</span>
          <span class="bs-badge bs-badge--right">{{ item.data.format.toUpperCase() }}</span>
          <span class="bs-badge bs-badge--bottom">{{ getProgress(item.data) }}</span>
          <span class="bs-watermark" :class="watermarkClass(item.data.status)">{{ statusMap[item.data.status] }}</span>
        </template>
        <template v-else>
          <div v-if="item.data.type === 'smart'" class="bs-tags">
            <span v-for="text in groupChips(item.data)" :key="text" class="bs-tag bs-tag--type">{{ text }}</span>
          </div>
          <span class="bs-badge bs-badge--bottom">{{ countText(groupCount(item.data)) }}</span>
          <span class="bs-watermark bs-watermark--group">分组</span>
        </template>
      </div>
      <div class="bs-title" :title="mainText(item)">{{ mainText(item) }}</div>
      <div v-if="isBook(item) && confirmDeleteId === item.data.url" class="bs-confirm" @click.stop>
        <button class="b3-button b3-button--outline" type="button" @click="emit('clear-delete')">取消</button>
        <button class="b3-button b3-button--remove" type="button" @click="emit('remove-book', item.data)">删除</button>
      </div>
      </div>
  </div>

  <div v-else class="b3-list b3-list--background bs-view bs-list" @dragover="handleRootDragOver" @drop="handleRootDrop">
      <div class="bs-home-drop" :class="{ 'is-visible': showHomeDrop, 'is-drop-target': dragHomeActive }" @dragover="handleHomeDragOver" @dragleave="handleHomeDragLeave" @drop="handleHomeDrop">
        {{ HOME_DROP_LABEL }}
      </div>
      <div
        v-for="item in items"
        :key="itemKey(item)"
        class="b3-list-item b3-list-item--hide-action bs-row"
        :class="{ 'is-drop-target': isGroupDropTarget(item) }"
        :draggable="isBook(item)"
        @click="handleClick(item, $event)"
        @contextmenu.prevent="handleContextMenu(item, $event)"
        @dragstart="handleItemDragStart(item, $event)"
        @dragend="handleBookDragEnd"
        @dragover="handleGroupDragOver(item, $event)"
        @dragleave="handleGroupDragLeave(item)"
        @drop="handleGroupDrop(item, $event)"
      >
      <div class="bs-row__cover">
        <img :src="coverSrc(item)" :alt="mainText(item)" loading="lazy" decoding="async">
        <span
          v-if="isImport(item)"
          class="block__icon block__icon--show bs-import-check"
          :class="{ 'block__icon--active': item.data.selected }"
          @click.stop="emit('toggle-import', item.data)"
        >
          <svg><use :xlink:href="item.data.selected ? '#iconCheck' : '#iconUncheck'" /></svg>
        </span>
        <span v-if="isBook(item)" class="bs-watermark bs-watermark--mini" :class="watermarkClass(item.data.status)">{{ statusMap[item.data.status] }}</span>
      </div>

      <div class="b3-list-item__text bs-row__main">
        <div class="bs-row__head">
          <div class="bs-row__title" :title="mainText(item)">{{ mainText(item) }}</div>
          <div v-if="isBook(item)" class="bs-row__progress">{{ getProgress(item.data) }}</div>
        </div>

        <div class="bs-row__author" :title="authorText(item)">{{ authorText(item) }}</div>

        <div v-if="isBook(item)" class="bs-tags">
          <span class="bs-tag bs-tag--type">{{ item.data.format.toUpperCase() }}</span>
          <span v-for="tag in item.data.tags.slice(0, 4)" :key="tag" class="bs-tag" :style="tagStyle(tag)">{{ tag }}</span>
        </div>
        <div v-else-if="isGroup(item) && item.data.type === 'smart'" class="bs-tags">
          <span v-for="text in groupChips(item.data)" :key="text" class="bs-tag bs-tag--type">{{ text }}</span>
        </div>

        <div v-if="isBook(item)" class="bs-row__meta">
          <span v-if="annotationText(item.data)">{{ annotationText(item.data) }}</span>
          <span v-if="annotationText(item.data) && chapterText(item.data)">·</span>
          <span v-if="chapterText(item.data)">{{ chapterText(item.data) }}</span>
          <span v-if="(annotationText(item.data) || chapterText(item.data)) && lastReadText(item.data.read)">·</span>
          <span v-if="lastReadText(item.data.read)">{{ lastReadText(item.data.read) }}</span>
        </div>

        <div v-if="isImport(item) && item.data.error" class="ft__error">{{ item.data.error }}</div>
      </div>

      <div v-if="!isBook(item)" class="bs-row__side">
        <span v-for="text in sideTexts(item)" :key="text" class="ft__secondary">{{ text }}</span>
      </div>

      <div v-if="isBook(item) && confirmDeleteId === item.data.url" class="bs-confirm" @click.stop>
        <button class="b3-button b3-button--outline" type="button" @click="emit('clear-delete')">取消</button>
        <button class="b3-button b3-button--remove" type="button" @click="emit('remove-book', item.data)">删除</button>
      </div>
      </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookImportItem } from '@/composables/useBookImport'
import { bookInGroup, type Book, type BookStatus, type BookshelfViewMode, type GroupConfig } from '@/core/bookshelf'

type GroupItem = { type: 'group'; data: GroupConfig }
type BookItem = { type: 'book'; data: Book }
type ImportItem = { type: 'import'; data: BookImportItem }
type Item = GroupItem | BookItem | ImportItem
type CompactRow = { key: string; item: Item; level: number; kind: 'group' | 'book' | 'import' }
const HOME_DROP_LABEL = '移出分组'

const props = withDefaults(defineProps<{
  items: Item[]
  mode: BookshelfViewMode
  gridStyle?: Record<string, string>
  confirmDeleteId?: string | null
  groupCounts?: Record<string, number>
  statusMap: Record<BookStatus, string>
  getCoverUrl: (book: Book) => string
  getProgress: (book: Book) => string
  currentGroup?: string | null
}>(), { gridStyle: () => ({}), confirmDeleteId: null, groupCounts: () => ({}), currentGroup: null })

const emit = defineEmits<{
  'select-group': [id: string]
  'book-click': [book: Book, event: MouseEvent]
  'book-menu': [book: Book, event: MouseEvent]
  'group-menu': [group: GroupConfig, event: MouseEvent]
  'toggle-import': [item: BookImportItem]
  'clear-delete': []
  'remove-book': [book: Book]
  'move-book-group': [url: string, groupId: string]
  'move-book-home': [url: string]
}>()

const isBook = (item: Item): item is BookItem => item.type === 'book'
const isGroup = (item: Item): item is GroupItem => item.type === 'group'
const isImport = (item: Item): item is ImportItem => item.type === 'import'
const groupCount = (group: GroupConfig) => props.groupCounts[group.id] || 0
const itemKey = (item: Item) => isGroup(item) ? `group-${item.data.id}` : isBook(item) ? `book-${item.data.url}` : `import-${item.data.id}`
const compactExpanded = ref<Record<string, boolean>>({})
const draggedBookUrl = ref('')
const draggedBookGroups = ref<string[]>([])
const dragTargetGroupId = ref('')
const dragHomeActive = ref(false)

const booksForGroup = (group: GroupConfig, books: Book[]) => books.filter(book => bookInGroup(book, group))
const groupedBook = (book: Book, groups: GroupItem[]) => groups.some(g => bookInGroup(book, g.data))

const compactRows = computed<CompactRow[]>(() => {
  const rows: CompactRow[] = []
  const groups = props.items.filter(isGroup)
  const books = props.items.filter(isBook).map(item => item.data)
  for (const group of groups) {
    rows.push({ key: itemKey(group), item: group, level: 0, kind: 'group' })
    if (compactExpanded.value[group.data.id]) {
      for (const book of booksForGroup(group.data, books)) rows.push({ key: `child-${group.data.id}-${book.url}`, item: { type: 'book', data: book }, level: 1, kind: 'book' })
    }
  }
  for (const book of books) {
    if (!groupedBook(book, groups)) rows.push({ key: `root-${book.url}`, item: { type: 'book', data: book }, level: 0, kind: 'book' })
  }
  for (const item of props.items.filter(isImport)) rows.push({ key: itemKey(item), item, level: 0, kind: 'import' })
  return rows
})

const isCompactExpanded = (id: string) => !!compactExpanded.value[id]
const toggleCompactGroup = (id: string) => { compactExpanded.value = { ...compactExpanded.value, [id]: !compactExpanded.value[id] } }
const getRowItem = (row: CompactRow | Item) => 'item' in row ? row.item : row
const isFolderGroup = (item: Item) => isGroup(item) && item.data.type === 'folder'
const getDropGroupId = (row: CompactRow | Item) => {
  const item = getRowItem(row)
  return isFolderGroup(item) ? item.data.id : ''
}
const isGroupDropTarget = (row: CompactRow | Item) => {
  const groupId = getDropGroupId(row)
  return !!groupId && dragTargetGroupId.value === groupId
}
const canDropToGroup = (groupId: string) => !draggedBookGroups.value.includes(groupId)
const showHomeDrop = computed(() => !!draggedBookUrl.value && !!draggedBookGroups.value.length)
const resetDragState = () => {
  draggedBookUrl.value = ''
  draggedBookGroups.value = []
  dragTargetGroupId.value = ''
  dragHomeActive.value = false
}
const handleItemDragStart = (item: Item, event: DragEvent) => isBook(item) && handleBookDragStart(item.data, event)
const handleBookDragStart = (book: Book, event: DragEvent) => {
  draggedBookUrl.value = book.url
  draggedBookGroups.value = [...book.groups]
  event.dataTransfer?.setData('text/plain', book.url)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
const handleBookDragEnd = () => { resetDragState() }
const dragBookUrl = (event?: DragEvent) => draggedBookUrl.value || event?.dataTransfer?.getData('text/plain') || ''
const handleGroupDragOver = (row: CompactRow | Item, event: DragEvent) => {
  const groupId = getDropGroupId(row)
  if (!groupId || !canDropToGroup(groupId)) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer && (event.dataTransfer.dropEffect = 'move')
  dragHomeActive.value = false
  dragTargetGroupId.value = groupId
}
const handleGroupDragLeave = (row: CompactRow | Item) => {
  const groupId = getDropGroupId(row)
  if (groupId && dragTargetGroupId.value === groupId) dragTargetGroupId.value = ''
}
const handleGroupDrop = (row: CompactRow | Item, event: DragEvent) => {
  const groupId = getDropGroupId(row)
  const url = dragBookUrl(event)
  if (!groupId) return
  event.preventDefault()
  event.stopPropagation()
  resetDragState()
  if (!url || !canDropToGroup(groupId)) return
  emit('move-book-group', url, groupId)
}
const handleRootDragOver = (event: DragEvent) => {
  if (!dragBookUrl(event) || !props.currentGroup) return
  event.preventDefault()
  dragTargetGroupId.value = ''
  event.dataTransfer && (event.dataTransfer.dropEffect = 'move')
}
const handleRootDrop = (event: DragEvent) => {
  const url = dragBookUrl(event)
  if (!url || !props.currentGroup) return
  event.preventDefault()
  resetDragState()
  emit('move-book-home', url)
}
const handleHomeDragOver = (event: DragEvent) => {
  if (!showHomeDrop.value || !dragBookUrl(event)) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer && (event.dataTransfer.dropEffect = 'move')
  dragTargetGroupId.value = ''
  dragHomeActive.value = true
}
const handleHomeDragLeave = () => { dragHomeActive.value = false }
const handleHomeDrop = (event: DragEvent) => {
  const url = dragBookUrl(event)
  if (!showHomeDrop.value || !url) return
  event.preventDefault()
  event.stopPropagation()
  resetDragState()
  emit('move-book-home', url)
}

const handleClick = (item: Item, event: MouseEvent) => {
  if (isGroup(item)) emit('select-group', item.data.id)
  else if (isBook(item)) emit('book-click', item.data, event)
}

const handleCompactClick = (row: CompactRow, event: MouseEvent) => {
  if (row.kind === 'group' && isGroup(row.item)) return toggleCompactGroup(row.item.data.id)
  handleClick(row.item, event)
}

const handleContextMenu = (item: Item, event: MouseEvent) => {
  if (isGroup(item)) emit('group-menu', item.data, event)
  else if (isBook(item)) emit('book-menu', item.data, event)
}

const handleCompactContextMenu = (row: CompactRow, event: MouseEvent) => handleContextMenu(row.item, event)

const countText = (count: number) => `${count} 本`
const starText = (rating: number) => '★'.repeat(Math.max(0, Math.min(5, rating)))
const watermarkClass = (status: BookStatus) => `bs-watermark--${status}`
const mainText = (item: Item) => isGroup(item) ? item.data.name : isBook(item) ? item.data.title : item.data.preview?.title || item.data.label
const groupChips = (group: GroupConfig) => [
  ...(group.rules?.tags || []).slice(0, 2),
  ...((group.rules?.format || []).slice(0, 1).map(v => v.toUpperCase())),
  ...((group.rules?.status || []).slice(0, 1).map(v => props.statusMap[v])),
  ...(group.rules?.rating ? [`${group.rules.rating}星+`] : []),
].slice(0, 3)
const authorText = (item: Item) => isGroup(item) ? (item.data.type === 'smart' ? '智能分组' : '分组') : isBook(item) ? item.data.author || '未知作者' : item.data.preview?.author || '未知作者'
const onCompactHover = (event: MouseEvent) => (event.target as HTMLElement).hasAttribute('data-playlist-item') && event.stopPropagation()
const compactMeta = (item: Item) => isGroup(item) ? countText(groupCount(item.data)) : isBook(item) ? props.getProgress(item.data) : importStateText(item.data)
const sideTexts = (item: Item) => isGroup(item) ? [countText(groupCount(item.data))] : isBook(item) ? [] : [importStateText(item.data)]
const coverSrc = (item: Item) => (isBook(item) ? props.getCoverUrl(item.data) : isImport(item) ? item.data.preview?.cover || '' : '') || placeholderCover(item)
const placeholderCover = (item: Item) => {
  const kind = isGroup(item) ? 'group' : isBook(item) ? item.data.format : item.data.preview?.format || 'book'
  const themes = {
    group: ['#d6e6ff', '#8eb5f4', '#3f72c5'],
    pdf: ['#ffd6d6', '#f19999', '#bf4747'],
    epub: ['#d8ebff', '#8ec0f2', '#3d79b7'],
    mobi: ['#ffe0bc', '#efb26d', '#b97629'],
    azw3: ['#e1d7ff', '#ab97eb', '#6550b9'],
    txt: ['#dcefdc', '#91c391', '#4b8556'],
    book: ['#dfe6f0', '#9eb0c8', '#5e7088'],
  } as const
  const shapes = {
    group: (accent: string, ink: string) => `<path d="M28 64c0-4.4 3.6-8 8-8h16l8 10h24c4.4 0 8 3.6 8 8v34c0 4.4-3.6 8-8 8H36c-4.4 0-8-3.6-8-8V64z" fill="${accent}" fill-opacity=".28"/><path d="M28 72h25.5c2.3 0 4.5.9 6.1 2.5l2.4 2.5H92v31c0 4.4-3.6 8-8 8H36c-4.4 0-8-3.6-8-8V72z" fill="${accent}" fill-opacity=".42"/><rect x="38" y="84" width="28" height="6" rx="3" fill="${ink}" fill-opacity=".14"/><rect x="38" y="96" width="38" height="6" rx="3" fill="${ink}" fill-opacity=".1"/>`,
    pdf: (_: string, ink: string) => `<rect x="30" y="42" width="40" height="10" rx="5" fill="${ink}" fill-opacity=".16"/><rect x="30" y="58" width="50" height="10" rx="5" fill="${ink}" fill-opacity=".1"/><rect x="30" y="80" width="34" height="34" rx="8" fill="${ink}" fill-opacity=".08"/><text x="47" y="101" text-anchor="middle" font-size="12" font-family="Arial, sans-serif" font-weight="700" fill="${ink}" fill-opacity=".7">PDF</text>`,
    book: (accent: string, _: string, rx = 20, irx = 8) => `<rect x="30" y="42" width="46" height="10" rx="5" fill="${accent}" fill-opacity=".28"/><rect x="30" y="58" width="54" height="10" rx="5" fill="${accent}" fill-opacity=".18"/><rect x="30" y="80" width="40" height="40" rx="${rx}" fill="${accent}" fill-opacity=".12"/><rect x="42" y="92" width="16" height="16" rx="${irx}" fill="${accent}" fill-opacity=".22"/>`,
  } as const
  const theme = themes[kind as keyof typeof themes] || themes.book
  const [bg, accent, ink] = theme
  const art = kind === 'group' ? shapes.group(accent, ink) : kind === 'pdf' ? shapes.pdf(accent, ink) : shapes.book(accent, ink, kind === 'txt' ? 6 : 20, kind === 'txt' ? 2 : 8)
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 180"><rect width="120" height="180" fill="${bg}"/><circle cx="94" cy="24" r="22" fill="${accent}" fill-opacity=".12"/><rect x="22" y="28" width="74" height="92" rx="16" fill="#fff" fill-opacity=".68"/>${art}<rect x="22" y="138" width="68" height="6" rx="3" fill="${ink}" fill-opacity=".34"/><rect x="22" y="150" width="52" height="6" rx="3" fill="${ink}" fill-opacity=".24"/><rect x="22" y="162" width="60" height="6" rx="3" fill="${ink}" fill-opacity=".18"/></svg>`)}` 
}
const importStateText = (item: BookImportItem) => item.error ? '失败' : item.loading ? '解析中...' : item.preview?.format?.toUpperCase?.() || '待导入'
const annotationText = (book: Book) => book.annotationCount ? `标注 ${book.annotationCount}` : ''
const chapterText = (book: Book) => book.total ? `章节 ${book.chapter || 0}/${book.total}` : book.chapter ? `章节 ${book.chapter}` : ''
const lastReadText = (ts: number) => ts ? `最近阅读 ${new Date(ts).toLocaleDateString('zh-CN')}` : ''
const tagStyle = (tag: string) => {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return {
    '--bs-tag-bg': `hsla(${hue}, 72%, 93%, .95)`,
    '--bs-tag-color': `hsl(${hue}, 38%, 32%)`,
    '--bs-tag-border': `hsla(${hue}, 32%, 55%, .24)`,
  }
}
</script>

<style scoped lang="scss">
.bs-view{min-height:0;height:100%;padding:0;box-sizing:border-box}
.bs-tree{overflow:hidden;--bs-tree-border:color-mix(in srgb,var(--b3-theme-on-surface-light) 30%,transparent);--b3-list-hover:color-mix(in srgb,var(--b3-theme-primary) 12%,transparent)}
.bs-tree__scroll{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:8px 0 8px 8px;box-sizing:border-box}
.bs-tree :deep(.b3-list),.bs-list{margin:0;background:transparent}
.bs-tree__home{display:block;max-height:0;overflow:hidden;opacity:0;transition:max-height .18s ease,opacity .18s ease;margin:0}
.bs-tree__home.is-visible{max-height:52px;opacity:.9}
.bs-home-drop{display:none}
.bs-tree :deep(ul.b3-list.b3-list--background){border:1px solid var(--bs-tree-border);border-radius:var(--b3-border-radius)}
.bs-tree :deep(.b3-list-item[data-type="navigation-root"]){margin:0;border-radius:var(--b3-border-radius)}
.bs-tree :deep(.b3-list-item__toggle){display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:18px;min-width:18px}
.bs-tree :deep(.b3-list-item__arrow){transition:transform .18s ease}
.bs-tree__item--child{background:color-mix(in srgb,var(--b3-theme-primary) 4%,transparent)}
.bs-tree__item--group{font-weight:500}
.bs-tree__item--book{cursor:grab}
.bs-tree__marker{display:block;width:6px;height:6px;border-radius:999px;background:color-mix(in srgb,var(--b3-theme-on-surface) 58%,transparent)}
.bs-tree :deep(.b3-list-item__text),.bs-tree :deep(.b3-list-item__meta){color:var(--b3-theme-on-background)}
.bs-list :deep(.b3-list-item){margin:0}
.bs-grid{display:grid;gap:6px;overflow:auto;scrollbar-gutter:stable;align-content:start;padding:8px 0 8px 8px;box-sizing:border-box}
.bs-home-drop{grid-column:1/-1;align-items:center;justify-content:center;min-height:38px;padding:0 12px;border-radius:10px;background:color-mix(in srgb,var(--b3-theme-primary) 8%,transparent);color:var(--b3-theme-on-surface-variant);font-size:12px}
.bs-home-drop.is-visible{display:flex}
.bs-home-drop.is-drop-target{background:color-mix(in srgb,var(--b3-theme-primary) 18%,transparent);color:var(--b3-theme-primary)}
.bs-grid-item{position:relative;min-width:0;cursor:pointer}
.bs-row.is-drop-target,.bs-tree :deep(.b3-list-item.is-drop-target){background:color-mix(in srgb,var(--b3-theme-primary) 16%,transparent)}
.bs-cover.is-drop-target::after{content:'';position:absolute;inset:0;background:color-mix(in srgb,var(--b3-theme-primary) 18%,transparent);pointer-events:none}
.bs-cover,.bs-row__cover{position:relative;overflow:hidden;background:var(--b3-theme-surface-lighter);box-shadow:inset 0 0 0 1px var(--b3-border-color)}
.bs-cover{aspect-ratio:2/3;border-radius:6px}
.bs-cover img,.bs-row__cover img{display:block;width:100%;height:100%;object-fit:cover;background:inherit}
.bs-import-check{position:absolute;top:4px;left:4px;z-index:2}
.bs-title,.bs-row__title,.bs-row__author,.bs-row .ft__error{color:var(--b3-theme-on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-title{padding-top:3px;font-size:13px;line-height:1.4}
.bs-badge{position:absolute;z-index:1;padding:3px 6px;border-radius:999px;background:rgba(0,0,0,.62);font-size:10px;line-height:1;color:#fff}
.bs-badge--left{top:6px;left:6px}.bs-badge--right{top:6px;right:6px}.bs-badge--bottom{left:6px;bottom:6px}
.bs-cover .bs-tags{position:absolute;top:6px;left:6px;right:28px;z-index:1}
.bs-watermark{position:absolute;right:-.17em;bottom:-.13em;font-size:54px;font-weight:900;line-height:.82;letter-spacing:-.07em;pointer-events:none;opacity:.7;text-shadow:0 1px 0 rgba(255,255,255,.14)}
.bs-watermark--group{color:var(--b3-theme-on-background)}
.bs-watermark--unread{color:#f59e0b}
.bs-watermark--reading{color:var(--b3-theme-primary)}
.bs-watermark--finished{color:var(--b3-card-success-color,#2aa775)}
.bs-watermark--mini{right:-.15em;bottom:-.16em;font-size:25px;opacity:inherit}
.bs-list{display:flex;flex-direction:column;gap:6px;overflow:auto;scrollbar-gutter:stable;padding:8px 0 8px 8px;box-sizing:border-box}
.bs-row{position:relative;display:flex;align-items:stretch;gap:10px;min-height:98px;padding:0 12px 0 0;border:1px solid color-mix(in srgb,var(--b3-border-color) 92%, transparent);border-radius:12px;background:linear-gradient(180deg,color-mix(in srgb,var(--b3-theme-background) 96%, white),var(--b3-theme-background));box-sizing:border-box;overflow:hidden}
.bs-row__cover{align-self:stretch;flex:0 0 auto;width:64px;border-right:1px solid color-mix(in srgb,var(--b3-border-color) 88%, transparent)}
.bs-row__main{display:flex;flex:1;flex-direction:column;justify-content:flex-start;gap:5px;min-width:0;padding:10px 0 9px}
.bs-row__head{display:flex;align-items:flex-start;gap:8px;min-width:0}
.bs-row__title{flex:1;min-width:0;font-size:13px;line-height:1.3;font-weight:600;letter-spacing:0}
.bs-row__progress{flex:0 0 auto;padding-top:1px;font-size:11px;line-height:1.2;color:var(--b3-theme-on-surface-variant);font-variant-numeric:tabular-nums}
.bs-row__author{font-size:11px;line-height:1.25;color:var(--b3-theme-on-surface-variant)}
.bs-tags{display:flex;flex-wrap:wrap;gap:4px}
.bs-tag{display:inline-flex;align-items:center;max-width:78px;padding:0 6px;height:16px;border-radius:5px;border:1px solid var(--bs-tag-border);background:var(--bs-tag-bg);color:var(--bs-tag-color);font-size:9px;font-weight:500;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box}
.bs-tag--type{background:var(--b3-list-hover);border-color:color-mix(in srgb,var(--b3-border-color) 90%, transparent);color:var(--b3-theme-on-surface-variant)}
.bs-row__meta{display:flex;flex-wrap:wrap;gap:4px;font-size:10px;line-height:1.2;color:var(--b3-theme-on-surface-variant)}
.bs-row__side{display:flex;flex:0 0 auto;flex-direction:column;align-items:flex-end;justify-content:center;gap:8px;padding:12px 0 12px 8px;margin-left:auto}
.bs-row__side .ft__secondary{max-width:100%;font-size:11px;line-height:1.2;text-align:right;color:var(--b3-theme-on-surface-variant)}
.bs-confirm{position:absolute;right:6px;bottom:6px;z-index:2;display:flex;gap:4px;padding:4px;border:1px solid var(--b3-border-color);border-radius:var(--b3-border-radius);background:var(--b3-theme-background)}
</style>
