<template>
  <DockShell
    class="sr-toc"
    body-class="sr-body-pad-8"
    v-model:search-value="keyword"
    :search-placeholder="searchPlaceholder"
    :toolbar-actions="toolbarActions"
    toolbar-tooltip-dir="sw"
    @toolbar-action="handleToolbarAction"
  >
    <div ref="contentRef" class="sr-content">
      <div v-if="mode === 'deck'" class="sr-deck-wrap">
        <DeckHub :keyword="keyword" :activeTab="deckTab" @update:activeTab="deckTab = $event" />
      </div>

      <template v-else>
        <div v-show="!showThumbnail" ref="tocRef"></div>

        <div v-show="showThumbnail" ref="thumbContainer" class="sr-thumbnails">
          <div v-if="!isPdfMode" class="sr-empty">仅 PDF 支持缩略图</div>
          <div v-else v-for="i in pageCount" :key="i" :data-page="i" class="sr-thumb" @click="goToPage(i)">
            <img v-if="loadedThumbs[i]" :src="loadedThumbs[i]" :alt="`第 ${i} 页`">
            <div v-else class="sr-thumb-placeholder">{{ i }}</div>
            <div class="sr-thumb-label">{{ i }}</div>
          </div>
        </div>
      </template>
    </div>
  </DockShell>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { showMessage } from 'siyuan'
import DeckHub from './deck/DeckHub.vue'
import DockShell from './ui/DockShell.vue'
import { useReaderState } from '@/core/epub/state'
import { exportBookLink } from '@/utils/copy'
import { bookshelfManager } from '@/core/bookshelf'
import { jump } from '@/utils/jump'

const props = withDefaults(defineProps<{ mode?: 'toc' | 'deck'; i18n?: any }>(), { mode: 'toc', i18n: () => ({}) })

const { activeView, activeReader } = useReaderState()
const goToLocation = async (location: string | number) => activeView.value?.goTo(location)

const keyword = ref('')
const tocRef = ref<HTMLElement>()
const contentRef = ref<HTMLElement>()
const thumbContainer = ref<HTMLElement>()
const showThumbnail = ref(false)
const reverse = ref(false)
const tocAllExpanded = ref(false)
const refreshKey = ref(0)
const loadedThumbs = ref<Record<number, string>>({})
const deckTab = ref<'cards'|'packs'|'stats'|'review'|'settings'>('cards')

const isPdfMode = computed(() => (activeView.value as any)?.isPdf || false)
const pageCount = computed(() => (activeView.value as any)?.pageCount || 0)
const searchPlaceholder = computed(() => props.mode === 'deck' ? '搜索 · 卡组: 标签: 状态: 属性:' : '搜索目录...')
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
      { id: 'expand', icon: tocAllExpanded.value ? '#lucide-panel-top-close' : '#lucide-panel-top-open', label: tocAllExpanded.value ? '折叠' : '展开', show: !showThumbnail.value },
      { id: 'reverse', icon: reverse.value ? '#lucide-arrow-up-1-0' : '#lucide-arrow-down-0-1', label: reverse.value ? '倒序' : '正序' },
    ])

const getUrl = () => (window as any).__currentBookUrl
const showMsg = (msg: string, type = 'info') => showMessage(msg, type === 'error' ? 3000 : 1500, type as any)

let tocView: any
let relocateHandler: any
let tocInteract = 0
let thumbObs: IntersectionObserver | undefined

const createTocAction = (cls: string, icon: string, handler: (event: Event) => void) => {
  const btn = document.createElement('button')
  btn.className = `${cls} b3-tooltips b3-tooltips__w`
  btn.innerHTML = `<svg style="width:14px;height:14px"><use xlink:href="${icon}"/></svg>`
  btn.onclick = handler
  return btn as HTMLButtonElement
}

const addBookmarks = () => {
  if (!tocRef.value) return
  const bookmarks = new Set((activeReader.value?.marks || (activeView.value as any)?.marks)?.getBookmarks?.().map((item: any) => item.title) || [])
  tocRef.value.querySelectorAll('a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href')
    const label = anchor.textContent?.trim()
    if (!href || !label) return
    const exportBtn = (anchor.querySelector('.toc-export-btn') as HTMLButtonElement) || createTocAction('toc-export-btn', '#lucide-send', event => { event.stopPropagation(); event.preventDefault(); exportTocItem(href, label) })
    const btn = (anchor.querySelector('.toc-bookmark-btn') as HTMLButtonElement) || createTocAction('toc-bookmark-btn', '#iconBookmark', event => { event.stopPropagation(); event.preventDefault(); toggleBookmark(href, label) })
    anchor.style.position = 'relative'
    exportBtn.parentNode || anchor.appendChild(exportBtn)
    btn.parentNode || anchor.appendChild(btn)
    exportBtn.setAttribute('aria-label', props.i18n?.export || '导出')
    const has = bookmarks.has(label)
    btn.classList.toggle('has-bookmark', has)
    btn.setAttribute('aria-label', has ? '移除书签' : '添加书签')
  })
}

const exportTocItem = async (href: string, label: string) => {
  try {
    const bookUrl = getUrl() || ''
    await exportBookLink({ chapter: label, cfi: href }, { bookUrl, bookInfo: bookUrl ? await bookshelfManager.getBook(bookUrl) : null, reader: activeReader.value, showMsg })
  } catch (error: any) {
    showMsg(error.message || '导出失败', 'error')
  }
}

const toggleBookmark = async (href: string, label: string) => {
  const marks = activeReader.value?.marks || (activeView.value as any)?.marks
  if (!marks || !activeView.value) return showMessage('书签功能未初始化', 2000, 'error')
  try {
    tocInteract = Date.now()
    await activeView.value.goTo(href)
    await new Promise(resolve => setTimeout(resolve, 200))
    const added = await marks.toggleBookmark(undefined, undefined, label)
    showMessage(added ? '已添加' : '已删除', 1500, 'info')
    refreshKey.value++
    requestAnimationFrame(addBookmarks)
  } catch (error: any) {
    showMessage(error.message || '操作失败', 2000, 'error')
  }
}

const cleanupToc = () => {
  activeView.value?.removeEventListener?.('relocate', relocateHandler)
  if (tocRef.value) tocRef.value.innerHTML = ''
  relocateHandler = null
  tocView = null
}

const initToc = async () => {
  if (props.mode !== 'toc' || !tocRef.value) return
  cleanupToc()
  const view = activeView.value
  if (!view?.book?.toc?.length) {
    if (isPdfMode.value) showThumbnail.value = true
    return
  }
  try {
    const { createTOCView } = await import('foliate-js/ui/tree.js')
    tocView = createTOCView(reverse.value ? [...view.book.toc].reverse() : view.book.toc, goToLocation)
    tocRef.value.innerHTML = ''
    tocRef.value.appendChild(tocView.element)
    tocRef.value.addEventListener('scroll', () => tocInteract = Date.now(), { passive: true })
    if (view.addEventListener) {
      relocateHandler = (event: any) => Date.now() - tocInteract > 10000 && tocView?.setCurrentHref?.(event.detail?.tocItem?.href)
      view.addEventListener('relocate', relocateHandler)
    }
    setTimeout(() => {
      tocView?.setCurrentHref?.(view.lastLocation?.tocItem?.href)
      addBookmarks()
      tocAllExpanded.value = !!tocRef.value?.querySelector('[aria-expanded]') && !tocRef.value?.querySelector('[aria-expanded="false"]')
    }, 50)
  } catch (error) {
    console.error('[TOC]', error)
  }
}

const toggleTocTree = (expand = !tocAllExpanded.value) => {
  const items = [...(tocRef.value?.querySelectorAll('[aria-expanded]') || [])]
  items.forEach(el => el.setAttribute('aria-expanded', expand ? 'true' : 'false'))
  tocAllExpanded.value = !!items.length && expand
}

const handleToolbarAction = (id: string) => {
  if (props.mode === 'deck') {
    if (['cards', 'packs', 'review', 'stats', 'settings'].includes(id)) deckTab.value = id as typeof deckTab.value
    return
  }
  if (id === 'thumbnail') showThumbnail.value = !showThumbnail.value
  else if (id === 'expand') toggleTocTree()
  else if (id === 'reverse') reverse.value = !reverse.value
}

const goToPage = (page: number) => jump(page, activeView.value, activeReader.value, (activeReader.value?.marks || (activeView.value as any)?.marks))

const initThumbs = () => nextTick(() => {
  thumbObs?.disconnect()
  const getThumbnail = (activeView.value as any)?.getThumbnail
  if (!showThumbnail.value || !isPdfMode.value || !pageCount.value || !getThumbnail) return
  thumbObs = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return
    const page = +(entry.target as HTMLElement).dataset.page!
    if (!loadedThumbs.value[page]) getThumbnail(page).then((url: string) => url && (loadedThumbs.value[page] = url))
  }), { root: contentRef.value, rootMargin: '200px' })
  thumbContainer.value?.querySelectorAll('.sr-thumb').forEach(el => thumbObs?.observe(el))
})

const onMarks = () => props.mode === 'toc' && requestAnimationFrame(addBookmarks)
const onSwitch = () => props.mode === 'toc' && requestAnimationFrame(initToc)

watch([showThumbnail, () => pageCount.value], () => showThumbnail.value && initThumbs())
watch(() => activeView.value?.book, book => book?.toc && props.mode === 'toc' ? requestAnimationFrame(initToc) : cleanupToc(), { immediate: true })
watch(() => props.mode, onSwitch)
watch(reverse, () => props.mode === 'toc' && requestAnimationFrame(initToc))

onMounted(() => {
  window.addEventListener('sireader:marks-updated', onMarks)
  window.addEventListener('sireader:tab-switched', onSwitch)
})
onUnmounted(() => {
  cleanupToc()
  thumbObs?.disconnect()
  window.removeEventListener('sireader:marks-updated', onMarks)
  window.removeEventListener('sireader:tab-switched', onSwitch)
})
</script>

<style scoped lang="scss">
@use './deck/deck.scss';
.sr-toc{display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--b3-theme-background)}
.sr-content{height:100%;overflow:auto;min-height:0;
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
  :deep(.toc-export-btn),:deep(.toc-bookmark-btn){position:absolute;top:50%;width:24px;height:24px;padding:0;border:none;background:transparent;cursor:pointer;opacity:0;transform:translateY(-50%);transition:opacity .2s,transform .2s;
    svg{width:14px;height:14px;color:var(--b3-theme-on-surface);transition:color .2s}}
  :deep(.toc-bookmark-btn){right:12px;&.has-bookmark svg{color:var(--b3-theme-error)}}
  :deep(.toc-export-btn){right:38px}
  :deep(a:hover .toc-export-btn),:deep(a:hover .toc-bookmark-btn),:deep(span[role="treeitem"]:hover .toc-export-btn),:deep(span[role="treeitem"]:hover .toc-bookmark-btn){opacity:1}
}
.sr-thumbnails{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.sr-thumb{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--b3-border-color);border-radius:8px;background:var(--b3-theme-surface);cursor:pointer}
.sr-thumb img,.sr-thumb-placeholder{width:100%;aspect-ratio:3/4;border-radius:6px;background:var(--b3-theme-background);display:flex;align-items:center;justify-content:center}
.sr-thumb-label{font-size:12px;text-align:center;color:var(--b3-theme-on-surface-variant)}
.sr-empty{display:flex;align-items:center;justify-content:center;min-height:160px;font-size:13px;opacity:.55}
.sr-deck-wrap{height:100%}
</style>
