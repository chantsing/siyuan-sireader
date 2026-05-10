<template>
  <div v-if="mode === 'compact'" class="fn__flex-1 fn__flex-column sy__file bs-view bs-tree">
    <div class="fn__flex-1 bs-tree__scroll" @mouseover="onCompactHover">
      <ul v-for="item in items" :key="itemKey(item)" class="b3-list b3-list--background">
        <li
          class="b3-list-item b3-list-item--hide-action"
          data-type="navigation-root"
          data-playlist-item
          @click="handleClick(item, $event)"
          @contextmenu.prevent.stop="handleContextMenu(item, $event)"
        >
          <span class="b3-list-item__text ariaLabel" data-playlist-item>{{ mainText(item) }}</span>
          <span class="fn__space"></span>
          <span class="b3-list-item__meta" data-playlist-item>{{ compactMeta(item) }}</span>
        </li>
      </ul>
    </div>
  </div>

  <div v-else-if="mode === 'grid'" class="bs-view bs-grid" :style="gridStyle">
    <div
      v-for="item in items"
      :key="itemKey(item)"
      class="bs-grid-item"
      @click="handleClick(item, $event)"
      @contextmenu.prevent="handleContextMenu(item, $event)"
    >
      <div class="bs-cover">
        <img v-if="coverFor(item)" :src="coverFor(item)" :alt="mainText(item)" loading="lazy" decoding="async">
        <div v-else class="bs-ph" :class="{ 'is-group': isGroup(item) }">
          <span class="bs-ph__tag">{{ rowTag(item) }}</span>
          <span class="bs-ph__block"></span>
          <span class="bs-ph__line w64"></span>
          <span class="bs-ph__line w52"></span>
          <span class="bs-ph__line w58"></span>
        </div>
        <template v-if="isBook(item)">
          <span v-if="item.data.rating" class="bs-badge bs-badge--left">{{ starText(item.data.rating) }}</span>
          <span class="bs-badge bs-badge--right">{{ item.data.format.toUpperCase() }}</span>
          <span class="bs-badge bs-badge--bottom">{{ getProgress(item.data) }}</span>
          <span class="bs-watermark" :class="watermarkClass(item.data.status)">{{ statusMap[item.data.status] }}</span>
        </template>
        <template v-else>
          <span class="bs-badge bs-badge--bottom">{{ countText(groupCount(item.data)) }}</span>
          <span class="bs-watermark bs-watermark--group">GROUP</span>
        </template>
      </div>
      <div class="bs-title" :title="mainText(item)">{{ mainText(item) }}</div>
      <div v-if="isBook(item) && confirmDeleteId === item.data.url" class="bs-confirm" @click.stop>
        <button class="b3-button b3-button--outline" type="button" @click="emit('clear-delete')">取消</button>
        <button class="b3-button b3-button--remove" type="button" @click="emit('remove-book', item.data)">删除</button>
      </div>
    </div>
  </div>

  <div v-else class="b3-list b3-list--background bs-view bs-list">
    <div
      v-for="item in items"
      :key="itemKey(item)"
      class="b3-list-item b3-list-item--hide-action bs-row"
      @click="handleClick(item, $event)"
      @contextmenu.prevent="handleContextMenu(item, $event)"
    >
      <span
        v-if="isImport(item)"
        class="block__icon block__icon--show"
        :class="{ 'block__icon--active': item.data.selected }"
        @click.stop="emit('toggle-import', item.data)"
      >
        <svg><use :xlink:href="item.data.selected ? '#iconCheck' : '#iconUncheck'" /></svg>
      </span>

      <div class="bs-row__cover">
        <img v-if="coverFor(item)" :src="coverFor(item)" :alt="mainText(item)" loading="lazy" decoding="async">
        <div v-else class="bs-ph bs-ph--mini" :class="{ 'is-group': isGroup(item) }">
          <span class="bs-ph__tag">{{ rowTag(item) }}</span>
          <span class="bs-ph__line w52"></span>
          <span class="bs-ph__line w40"></span>
        </div>
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
import type { BookImportItem } from '@/composables/useBookImport'
import type { Book, BookStatus, BookshelfViewMode, GroupConfig } from '@/core/bookshelf'

type GroupItem = { type: 'group'; data: GroupConfig }
type BookItem = { type: 'book'; data: Book }
type ImportItem = { type: 'import'; data: BookImportItem }
type Item = GroupItem | BookItem | ImportItem

const props = withDefaults(defineProps<{
  items: Item[]
  mode: BookshelfViewMode
  gridStyle?: Record<string, string>
  confirmDeleteId?: string | null
  groupCounts?: Record<string, number>
  statusMap: Record<BookStatus, string>
  getCoverUrl: (book: Book) => string
  getProgress: (book: Book) => string
}>(), { gridStyle: () => ({}), confirmDeleteId: null, groupCounts: () => ({}) })

const emit = defineEmits<{
  'select-group': [id: string]
  'book-click': [book: Book, event: MouseEvent]
  'book-menu': [book: Book, event: MouseEvent]
  'group-menu': [group: GroupConfig, event: MouseEvent]
  'toggle-import': [item: BookImportItem]
  'clear-delete': []
  'remove-book': [book: Book]
}>()

const isBook = (item: Item): item is BookItem => item.type === 'book'
const isGroup = (item: Item): item is GroupItem => item.type === 'group'
const isImport = (item: Item): item is ImportItem => item.type === 'import'
const groupCount = (group: GroupConfig) => props.groupCounts[group.id] || 0
const itemKey = (item: Item) => isGroup(item) ? `group-${item.data.id}` : isBook(item) ? `book-${item.data.url}` : `import-${item.data.id}`

const handleClick = (item: Item, event: MouseEvent) => {
  if (isGroup(item)) emit('select-group', item.data.id)
  else if (isBook(item)) emit('book-click', item.data, event)
}

const handleContextMenu = (item: Item, event: MouseEvent) => {
  if (isGroup(item)) emit('group-menu', item.data, event)
  else if (isBook(item)) emit('book-menu', item.data, event)
}

const countText = (count: number) => `${count} 本`
const starText = (rating: number) => '★'.repeat(Math.max(0, Math.min(5, rating)))
const watermarkClass = (status: BookStatus) => `bs-watermark--${status}`
const mainText = (item: Item) => isGroup(item) ? item.data.name : isBook(item) ? item.data.title : item.data.preview?.title || item.data.label
const authorText = (item: Item) => isGroup(item) ? '分组' : isBook(item) ? item.data.author || '未知作者' : item.data.preview?.author || '未知作者'
const onCompactHover = (event: MouseEvent) => (event.target as HTMLElement).hasAttribute('data-playlist-item') && event.stopPropagation()
const compactMeta = (item: Item) => isGroup(item) ? countText(groupCount(item.data)) : isBook(item) ? props.getProgress(item.data) : importStateText(item.data)
const sideTexts = (item: Item) => isGroup(item) ? [countText(groupCount(item.data))] : isBook(item) ? [] : [importStateText(item.data)]
const rowTag = (item: Item) => isGroup(item) ? 'GROUP' : isBook(item) ? item.data.format.toUpperCase() : item.data.preview?.format?.toUpperCase?.() || 'BOOK'
const coverFor = (item: Item) => isBook(item) ? props.getCoverUrl(item.data) : isImport(item) ? item.data.preview?.cover || '' : ''
const importStateText = (item: BookImportItem) => item.preview?.format?.toUpperCase?.() || (item.loading ? '解析中...' : item.error ? '失败' : '待导入')
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
.bs-tree :deep(ul.b3-list.b3-list--background){border:1px solid var(--bs-tree-border);border-radius:var(--b3-border-radius)}
.bs-tree :deep(.b3-list-item[data-type="navigation-root"]){margin:0;border-radius:var(--b3-border-radius)}
.bs-tree :deep(.b3-list-item__text),.bs-tree :deep(.b3-list-item__meta){color:var(--b3-theme-on-background)}
.bs-list :deep(.b3-list-item){margin:0}
.bs-grid{display:grid;gap:6px;overflow:auto;scrollbar-gutter:stable;align-content:start;padding:8px 0 8px 8px;box-sizing:border-box}
.bs-grid-item{position:relative;min-width:0;cursor:pointer}
.bs-cover,.bs-row__cover{position:relative;overflow:hidden;background:var(--b3-theme-surface-lighter);box-shadow:inset 0 0 0 1px var(--b3-border-color)}
.bs-cover{aspect-ratio:2/3;border-radius:6px}
.bs-cover img,.bs-row__cover img{display:block;width:100%;height:100%;object-fit:cover;background:inherit}
.bs-ph{display:flex;flex-direction:column;gap:10px;width:100%;height:100%;padding:16px 14px;box-sizing:border-box;background:linear-gradient(180deg,color-mix(in srgb,var(--b3-theme-primary) 24%,var(--b3-theme-background)),color-mix(in srgb,var(--b3-theme-primary) 14%,var(--b3-theme-surface)))}
.bs-ph.is-group{background:linear-gradient(180deg,color-mix(in srgb,var(--b3-theme-on-background) 20%,var(--b3-theme-background)),color-mix(in srgb,var(--b3-theme-on-background) 12%,var(--b3-theme-surface)))}
.bs-ph--mini{gap:4px;padding:6px}
.bs-ph__tag{align-self:flex-start;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--b3-theme-background) 76%,transparent);color:var(--b3-theme-on-surface);font-size:9px;font-weight:700;line-height:1.6;letter-spacing:.08em}
.bs-ph__block{flex:1;border-radius:12px;background:color-mix(in srgb,var(--b3-theme-background) 82%,transparent)}
.bs-ph__line{display:block;height:4px;border-radius:999px;background:color-mix(in srgb,var(--b3-theme-on-background) 24%,transparent)}
.bs-ph--mini .bs-ph__tag{padding:1px 6px;font-size:8px}
.bs-ph--mini .bs-ph__line{height:3px}
.w64{width:64px}.w58{width:58px}.w52{width:52px}.w40{width:40px}
.bs-title,.bs-row__title,.bs-row__author,.bs-row .ft__error{color:var(--b3-theme-on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-title{padding-top:3px;font-size:13px;line-height:1.4}
.bs-badge{position:absolute;z-index:1;padding:3px 6px;border-radius:999px;background:rgba(0,0,0,.62);font-size:10px;line-height:1;color:#fff}
.bs-badge--left{top:6px;left:6px}.bs-badge--right{top:6px;right:6px}.bs-badge--bottom{left:6px;bottom:6px}
.bs-watermark{position:absolute;right:-.16em;bottom:-.12em;color:rgba(255,255,255,.88);font-size:52px;font-weight:900;line-height:.82;letter-spacing:-.06em;opacity:.86;pointer-events:none;text-shadow:0 1px 2px rgba(255,255,255,.18),0 8px 24px rgba(0,0,0,.24),0 0 12px rgba(255,255,255,.08);mix-blend-mode:screen;filter:saturate(1.02)}
.bs-watermark--group{color:color-mix(in srgb,var(--b3-theme-on-background) 72%,white)}
.bs-watermark--unread{color:color-mix(in srgb,#f59e0b 78%,white)}
.bs-watermark--reading{color:color-mix(in srgb,var(--b3-theme-primary) 88%,white)}
.bs-watermark--finished{color:color-mix(in srgb,var(--b3-card-success-color,#2aa775) 92%,white)}
.bs-watermark--mini{right:-.16em;bottom:-.16em;font-size:24px;opacity:.18}
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
