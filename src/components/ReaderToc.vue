<template>
  <DockShell
    class="sr-toc"
    body-class="sr-toc-body"
    v-model:search-value="keyword"
    :search-placeholder="searchPlaceholder"
    :toolbar-actions="toolbarActions"
    toolbar-tooltip-dir="sw"
    @toolbar-action="handleToolbarAction"
  >
    <div v-if="mode === 'deck'" class="fn__flex-1" style="min-height:0;overflow:hidden">
      <DeckHub :keyword="keyword" :activeTab="deckTab" @update:activeTab="deckTab = $event" />
    </div>

    <template v-else>
      <div v-show="!showThumbnail" class="fn__flex-1 fn__flex-column sy__file bs-view bs-tree">
        <div
          ref="tocRef"
          class="fn__flex-1 bs-tree__scroll"
          @click="onTocClick"
          @contextmenu.prevent.stop
          @mouseover="e => (e.target as HTMLElement).hasAttribute('data-toc-item') && e.stopPropagation()"
        ></div>
      </div>

      <div v-show="showThumbnail" class="fn__flex-1 fn__flex-column sy__file bs-view bs-tree">
        <div ref="thumbContainer" class="fn__flex-1 bs-view bs-grid">
          <div v-if="!isPdfMode" class="ft__secondary" style="grid-column:1/-1;padding:8px 12px">仅 PDF 支持缩略图</div>
          <div v-else v-for="i in pageCount" :key="i" class="bs-grid-item">
            <div class="b3-list b3-list--background">
              <div
                class="b3-list-item"
                :data-page="i"
                style="display:flex;flex-direction:column;gap:8px;align-items:stretch;padding:8px 12px;cursor:pointer"
                @click="goToPage(i)"
              >
                <div style="display:block;aspect-ratio:3/4;overflow:hidden">
                  <img
                    v-if="loadedThumbs[i]"
                    :src="loadedThumbs[i]"
                    :alt="`第 ${i} 页`"
                    style="display:block;width:100%;height:100%;object-fit:contain"
                  >
                  <div v-else style="display:flex;align-items:center;justify-content:center;width:100%;height:100%">{{ i }}</div>
                </div>
                <div class="b3-list-item__text">第 {{ i }} 页</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </DockShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Menu, showMessage } from 'siyuan'
import DeckHub from './deck/DeckHub.vue'
import DockShell from './ui/DockShell.vue'
import { useReaderState } from '@/core/epub/state'
import { exportBookLink } from '@/utils/copy'
import { bookshelfManager } from '@/core/bookshelf'
import { jump } from '@/utils/jump'
import type { TOCItem } from '@/core/epub/types'

const props = withDefaults(defineProps<{ mode?: 'toc' | 'deck'; i18n?: any }>(), {
  mode: 'toc',
  i18n: () => ({}),
})

const { activeView, activeReader } = useReaderState()

const keyword = ref('')
const tocRef = ref<HTMLElement>()
const thumbContainer = ref<HTMLElement>()
const showThumbnail = ref(false)
const reverse = ref(false)
const loadedThumbs = ref<Record<number, string>>({})
const deckTab = ref<'cards' | 'packs' | 'stats' | 'review' | 'settings'>('cards')
const expandedKeys = ref<Record<string, boolean>>({})
const currentHref = ref('')

const isPdfMode = computed(() => (activeView.value as any)?.isPdf || false)
const pageCount = computed(() => (activeView.value as any)?.pageCount || 0)
const searchPlaceholder = computed(() => props.mode === 'deck' ? '搜索 / 卡组 / 标签 / 属性' : '搜索目录...')

const tocLabel = (item: TOCItem) => item.label || (item as any).title || ''
const tocKey = (item: TOCItem, parentKey = 'root') => item.href || `${parentKey}/${tocLabel(item)}`
const goToLocation = async (location: string | number) => activeView.value?.goTo(location)
const getUrl = () => (window as any).__currentBookUrl
const showMsg = (msg: string, type = 'info') => showMessage(msg, type === 'error' ? 3000 : 1500, type as any)
const esc = (value: string) => {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}
const getBookmarkTitles = () => new Set(
  (activeReader.value?.marks || (activeView.value as any)?.marks)?.getBookmarks?.().map((item: any) => item.title) || [],
)

const reverseToc = (items: TOCItem[]): TOCItem[] =>
  [...items].reverse().map(item => ({
    ...item,
    subitems: item.subitems?.length ? reverseToc(item.subitems) : item.subitems,
  }))

const filterToc = (items: TOCItem[], query: string): TOCItem[] => {
  if (!query) return items
  return items.reduce<TOCItem[]>((result, item) => {
    const children = item.subitems?.length ? filterToc(item.subitems, query) : []
    const text = tocLabel(item).toLowerCase()
    if (text.includes(query) || children.length) result.push({ ...item, subitems: children.length ? children : undefined })
    return result
  }, [])
}

const walkToc = (
  items: TOCItem[],
  visit: (item: TOCItem, key: string, level: number) => void,
  parentKey = 'root',
  level = 0,
) => {
  items.forEach(item => {
    const key = tocKey(item, parentKey)
    visit(item, key, level)
    if (item.subitems?.length) walkToc(item.subitems, visit, key, level + 1)
  })
}

const tocSource = computed<TOCItem[]>(() => {
  const toc = (activeView.value?.book?.toc || []) as TOCItem[]
  return reverse.value ? reverseToc(toc) : toc
})
const visibleToc = computed(() => filterToc(tocSource.value, keyword.value.trim().toLowerCase()))
const branchKeys = computed(() => {
  const keys: string[] = []
  walkToc(visibleToc.value, (item, key) => item.subitems?.length && keys.push(key))
  return keys
})
const hasExpanded = computed(() => branchKeys.value.some(key => expandedKeys.value[key]))

const toolbarActions = computed(() => props.mode === 'deck'
  ? [
      { id: 'cards', icon: '#lucide-square-star', label: '卡片', active: deckTab.value === 'cards' },
      { id: 'packs', icon: '#lucide-shopping-bag', label: '卡组', active: deckTab.value === 'packs' },
      { id: 'review', icon: '#lucide-zap', label: '闪卡', active: deckTab.value === 'review' },
      { id: 'stats', icon: '#lucide-chart-pie', label: '统计', active: deckTab.value === 'stats' },
      { id: 'settings', icon: '#lucide-settings-2', label: '设置', active: deckTab.value === 'settings' },
    ]
  : [
      { id: 'thumbnail', icon: showThumbnail.value ? '#lucide-scroll-text' : '#lucide-panels-top-left', label: showThumbnail.value ? '目录' : '缩略图', show: isPdfMode.value },
      { id: 'expand', icon: hasExpanded.value ? '#lucide-panel-top-close' : '#lucide-panel-top-open', label: hasExpanded.value ? '折叠' : '展开', show: !showThumbnail.value },
      { id: 'reverse', icon: reverse.value ? '#lucide-arrow-up-1-0' : '#lucide-arrow-down-0-1', label: reverse.value ? '倒序' : '正序' },
    ])

let relocateHandler: any
let thumbObs: IntersectionObserver | undefined
let renderFrame = 0
let initFrame = 0

const hasCurrentDescendant = (items: TOCItem[] | undefined, href: string): boolean =>
  !!items?.some(item => item.href === href || hasCurrentDescendant(item.subitems, href))

const ensureExpandedState = (items: TOCItem[], href = '') => {
  let changed = false
  const next = { ...expandedKeys.value }
  walkToc(items, (item, key) => {
    if (!item.subitems?.length || next[key] !== undefined) return
    next[key] = hasCurrentDescendant(item.subitems, href)
    changed = true
  })
  if (changed) expandedKeys.value = next
}

const renderTocItem = (item: TOCItem, level: number, parentKey: string, bookmarks: Set<string>): string => {
  const key = tocKey(item, parentKey)
  const hasChild = !!item.subitems?.length
  const isOpen = hasChild && !!expandedKeys.value[key]
  const isCurrent = !!item.href && item.href === currentHref.value
  const hasBookmark = bookmarks.has(tocLabel(item))
  const exportAction = item.href
    ? `<span class="b3-list-item__action b3-tooltips b3-tooltips__nw" data-act="export" aria-label="${esc(props.i18n?.export || '导出')}"><svg><use xlink:href="#lucide-send"></use></svg></span>`
    : ''
  const bookmarkAction = item.href
    ? `<span class="b3-list-item__action b3-tooltips b3-tooltips__nw" data-act="bookmark" aria-label="${hasBookmark ? '移除书签' : '添加书签'}"><svg><use xlink:href="#iconBookmark"></use></svg></span>`
    : ''
  const hideActionClass = hasBookmark ? '' : ' b3-list-item--hide-action'
  const row = `<li class="b3-list-item${hideActionClass}${isCurrent ? ' b3-list-item--focus' : ''}" data-key="${esc(key)}" data-href="${item.href ? encodeURIComponent(item.href) : ''}" data-label="${encodeURIComponent(tocLabel(item))}" data-has-child="${hasChild}" data-type="navigation-root" data-toc-item>
    <span style="padding-left:${level * 8}px" class="b3-list-item__toggle b3-list-item__toggle--hl${hasChild ? '' : ' fn__hidden'}">
      <svg class="b3-list-item__arrow${isOpen ? ' b3-list-item__arrow--open' : ''}"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__text ariaLabel" data-toc-item>${esc(tocLabel(item) || '未命名章节')}</span>
    ${exportAction || bookmarkAction ? '<span class="fn__space"></span>' : ''}
    ${exportAction}
    ${bookmarkAction}
  </li>`
  const children = hasChild && isOpen
    ? item.subitems!.map(child => renderTocItem(child, level + 1, key, bookmarks)).join('')
    : ''
  return `${row}${children}`
}

const renderToc = () => {
  if (props.mode !== 'toc' || !tocRef.value) return
  if (!visibleToc.value.length) {
    tocRef.value.innerHTML = isPdfMode.value
      ? ''
      : '<ul class="b3-list b3-list--background"><li class="b3-list-item"><span class="b3-list-item__toggle fn__hidden"></span><span class="b3-list-item__text ft__secondary">暂无目录</span></li></ul>'
    return
  }
  ensureExpandedState(visibleToc.value, currentHref.value)
  const bookmarks = getBookmarkTitles()
  tocRef.value.innerHTML = visibleToc.value.map(item => `<ul class="b3-list b3-list--background">${renderTocItem(item, 0, 'root', bookmarks)}</ul>`).join('')
}

const scheduleRender = () => {
  if (props.mode !== 'toc') return
  cancelAnimationFrame(renderFrame)
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0
    renderToc()
  })
}

const cleanupToc = () => {
  activeView.value?.removeEventListener?.('relocate', relocateHandler)
  if (tocRef.value) tocRef.value.innerHTML = ''
  relocateHandler = null
}

const initToc = () => {
  if (props.mode !== 'toc') return
  cleanupToc()
  const view = activeView.value
  if (!view?.book?.toc?.length) {
    if (isPdfMode.value) showThumbnail.value = true
    return
  }
  currentHref.value = view.lastLocation?.tocItem?.href || ''
  renderToc()
  if (view.addEventListener) {
    relocateHandler = (event: any) => {
      const href = event.detail?.tocItem?.href || ''
      if (!href || href === currentHref.value) return
      currentHref.value = href
      scheduleRender()
    }
    view.addEventListener('relocate', relocateHandler)
  }
}

const scheduleInit = () => {
  cancelAnimationFrame(initFrame)
  initFrame = requestAnimationFrame(() => {
    initFrame = 0
    initToc()
  })
}

const sendTocItem = async (href: string, label: string, clipboard = false) => {
  try {
    const bookUrl = getUrl() || ''
    await exportBookLink(
      { chapter: label, cfi: href },
      {
        bookUrl,
        bookInfo: bookUrl ? await bookshelfManager.getBook(bookUrl) : null,
        reader: activeReader.value,
        settings: clipboard ? { ...((window as any).__sireader_settings || {}), noteInsertTarget: 'clipboard' } : undefined,
        showMsg,
      },
    )
  } catch (error: any) {
    showMsg(error.message || (clipboard ? '复制失败' : '导出失败'), 'error')
  }
}

const copyTocText = async (label: string) => {
  await navigator.clipboard.writeText(label)
  showMsg('已复制文本')
}

const openTocMenu = (event: MouseEvent, href: string, label: string) => {
  const m = new Menu()
  ;[
    { icon: 'iconUpload', label: '导出', click: () => void sendTocItem(href, label) },
    { icon: 'iconCopy', label: '复制链接', click: () => void sendTocItem(href, label, true) },
    { icon: 'iconCopy', label: '复制文本', click: () => void copyTocText(label) },
  ].forEach(item => m.addItem(item))
  m.open({ x: event.clientX, y: event.clientY })
}

const toggleBookmark = async (href: string, label: string) => {
  const marks = activeReader.value?.marks || (activeView.value as any)?.marks
  if (!marks || !activeView.value) return showMessage('书签功能未初始化', 2000, 'error')
  try {
    await activeView.value.goTo(href)
    await new Promise(resolve => setTimeout(resolve, 200))
    const added = await marks.toggleBookmark(undefined, undefined, label)
    showMessage(added ? '已添加书签' : '已移除书签', 1500, 'info')
    scheduleRender()
  } catch (error: any) {
    showMessage(error.message || '操作失败', 2000, 'error')
  }
}

const toggleTocNode = (key: string) => {
  expandedKeys.value = { ...expandedKeys.value, [key]: !expandedKeys.value[key] }
  scheduleRender()
}

const setAllExpanded = (expand: boolean) => {
  const next = { ...expandedKeys.value }
  branchKeys.value.forEach(key => { next[key] = expand })
  expandedKeys.value = next
  scheduleRender()
}

const onTocClick = async (event: MouseEvent) => {
  const target = event.target as HTMLElement
  const action = target.closest('[data-act]') as HTMLElement | null
  const row = target.closest('[data-key]') as HTMLElement | null
  if (!row) return
  const key = row.dataset.key || ''
  const href = row.dataset.href ? decodeURIComponent(row.dataset.href) : ''
  const label = row.dataset.label ? decodeURIComponent(row.dataset.label) : row.textContent?.trim() || ''
  const hasChild = row.dataset.hasChild === 'true'
  if (action?.dataset.act === 'export' && href) {
    event.preventDefault()
    event.stopPropagation()
    return void openTocMenu(event, href, label)
  }
  if (action?.dataset.act === 'bookmark' && href) {
    event.preventDefault()
    event.stopPropagation()
    return void toggleBookmark(href, label)
  }
  if (target.closest('.b3-list-item__toggle') && hasChild) return void toggleTocNode(key)
  if (href) await goToLocation(href)
  else if (hasChild) toggleTocNode(key)
}

const handleToolbarAction = (id: string) => {
  if (props.mode === 'deck') {
    if (['cards', 'packs', 'review', 'stats', 'settings'].includes(id)) deckTab.value = id as typeof deckTab.value
    return
  }
  if (id === 'thumbnail') showThumbnail.value = !showThumbnail.value
  else if (id === 'expand') setAllExpanded(!hasExpanded.value)
  else if (id === 'reverse') reverse.value = !reverse.value
}

const goToPage = (page: number) =>
  jump(page, activeView.value, activeReader.value, activeReader.value?.marks || (activeView.value as any)?.marks)

const initThumbs = () => nextTick(() => {
  thumbObs?.disconnect()
  const getThumbnail = (activeView.value as any)?.getThumbnail
  if (!showThumbnail.value || !isPdfMode.value || !pageCount.value || !getThumbnail) return
  thumbObs = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return
    const page = +(entry.target as HTMLElement).dataset.page!
    if (!loadedThumbs.value[page]) {
      getThumbnail(page).then((url: string) => {
        if (url) loadedThumbs.value[page] = url
      })
    }
  }), { root: thumbContainer.value, rootMargin: '200px' })
  thumbContainer.value?.querySelectorAll('[data-page]').forEach(el => thumbObs?.observe(el))
})

watch([showThumbnail, () => pageCount.value], () => showThumbnail.value && initThumbs())
watch(() => activeView.value?.book, book => (
  book?.toc && props.mode === 'toc' ? scheduleInit() : cleanupToc()
), { immediate: true })
watch(() => props.mode, () => props.mode === 'toc' && scheduleInit())
watch(reverse, () => {
  if (props.mode !== 'toc') return
  expandedKeys.value = {}
  scheduleInit()
})
watch(keyword, () => props.mode === 'toc' && scheduleRender())

const onMarks = () => props.mode === 'toc' && scheduleRender()
const onSwitch = () => props.mode === 'toc' && scheduleInit()

onMounted(() => {
  window.addEventListener('sireader:marks-updated', onMarks)
  window.addEventListener('sireader:tab-switched', onSwitch)
})

onUnmounted(() => {
  cleanupToc()
  cancelAnimationFrame(renderFrame)
  cancelAnimationFrame(initFrame)
  thumbObs?.disconnect()
  window.removeEventListener('sireader:marks-updated', onMarks)
  window.removeEventListener('sireader:tab-switched', onSwitch)
})
</script>

<style scoped lang="scss">
:deep(.sr-toc-body){display:flex;flex-direction:column;min-height:0;overflow:hidden}
.bs-view{min-height:0;height:100%;padding:0;box-sizing:border-box}
.bs-tree{overflow:hidden;--bs-tree-border:color-mix(in srgb,var(--b3-theme-on-surface-light) 30%,transparent);--b3-list-hover:color-mix(in srgb,var(--b3-theme-primary) 12%,transparent)}
.bs-tree__scroll{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:8px 0 8px 8px;box-sizing:border-box}
.bs-tree :deep(ul){margin:0;padding:0;list-style:none}
.bs-tree :deep(.b3-list),.bs-grid .b3-list{margin:0;background:transparent}
.bs-tree :deep(ul.b3-list.b3-list--background),.bs-grid .b3-list{border:1px solid var(--bs-tree-border);border-radius:var(--b3-border-radius)}
.bs-tree :deep(.b3-list-item[data-type="navigation-root"]){margin:0;border-radius:var(--b3-border-radius)}
.bs-tree :deep(.b3-list-item__toggle){display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:18px;min-width:18px}
.bs-tree :deep(.b3-list-item__arrow){transition:transform .18s ease}
.bs-grid{display:grid;gap:6px;overflow:auto;scrollbar-gutter:stable;align-content:start;padding:8px 0 8px 8px;box-sizing:border-box;grid-template-columns:repeat(auto-fill,minmax(92px,1fr))}
.bs-grid-item{position:relative;min-width:0;cursor:pointer}
</style>
