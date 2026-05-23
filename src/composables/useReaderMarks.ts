import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { showMessage } from 'siyuan'
import { COLORS, STYLES, getColorMap } from '@/core/MarkManager'
import { useReaderState } from '@/core/epub/state'
import { bookshelfManager } from '@/core/bookshelf'
import { drawInk, renderInkCanvas as renderInk } from '@/core/pdf/ink'
import { PDF_SHAPE_COLORS, PDF_SHAPE_OPTIONS, renderShapeCanvas as renderShape } from '@/core/pdf/shape'
import { copyMark as copyMarkUtil, hideFloat, openBlock, showFloat } from '@/utils/copy'
import { jump } from '@/utils/jump'
import { collectMarkTags, formatMarkTags, getMarkTags, parseMarkTags } from '@/components/MarkCard.vue'

type MarkSort = 'time' | 'date' | 'chapter' | 'page' | 'custom'
type MarkType = 'highlight' | 'note' | 'bookmark' | 'ink' | 'shape'
type MarkFilterKey = 'types' | 'colors' | 'textStyles' | 'shapeTypes' | 'tags' | 'note'
type MarkNoteFilter = 'all' | 'with-note'
type FilterState = { types: MarkType[]; colors: string[]; textStyles: string[]; shapeTypes: string[]; tags: string[]; note: MarkNoteFilter; sort: MarkSort }

export const MARK_SORT_OPTIONS = [
  { value: 'time', label: '时间' },
  { value: 'date', label: '日期' },
  { value: 'chapter', label: '章节' },
  { value: 'page', label: '页码' },
  { value: 'custom', label: '自定义' },
] as const

const TYPE_OPTIONS = [
  { value: 'highlight', label: '文本标注' },
  { value: 'note', label: '笔记' },
  { value: 'bookmark', label: '书签' },
  { value: 'ink', label: '墨迹' },
  { value: 'shape', label: '形状' },
] as const

const NOTE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'with-note', label: '仅带笔记' },
] as const

const TEXT_STYLE_OPTIONS = STYLES.map(item => ({ value: item.type, label: item.name }))
const SHAPE_TYPE_OPTIONS = PDF_SHAPE_OPTIONS.map(item => ({ value: item.type, label: item.label, icon: item.icon }))
const TYPE_CYCLE: Array<{ value: MarkType | null; label: string; icon: string }> = [
  { value: null, label: '全部标注', icon: '#lucide-square-pen' },
  { value: 'highlight', label: '文本标注', icon: '#lucide-map-pin-check' },
  { value: 'note', label: '笔记', icon: '#lucide-map-pin-pen' },
  { value: 'bookmark', label: '书签', icon: '#lucide-bookmark-check' },
]

const COLOR_BUCKETS = [
  { value: 'yellow', label: '黄色', aliases: ['yellow', '#ffeb3b'] },
  { value: 'red', label: '红色', aliases: ['red', '#ff0000'] },
  { value: 'green', label: '绿色', aliases: ['green', '#00aa00'] },
  { value: 'blue', label: '蓝色', aliases: ['blue', '#0066ff', '#00bcd4'] },
  { value: 'purple', label: '紫色', aliases: ['purple'] },
  { value: 'orange', label: '橙色', aliases: ['orange', '#ffb000'] },
  { value: 'pink', label: '粉色', aliases: ['pink', '#ff00ff'] },
] as const

const ORDER_MAX = Number.MAX_SAFE_INTEGER
const createFilter = (): FilterState => ({ types: [], colors: [], textStyles: [], shapeTypes: [], tags: [], note: 'all', sort: 'time' })
const isTextMark = (item: any) => item?.type === 'highlight' || item?.type === 'note'
const isBookmark = (item: any) => item?.type === 'bookmark'
const getKey = (item: any) => item?.id || item?.groupId || item?.cfi || `${item?.type}-${item?.page || item?.section || 0}`
const getType = (item: any): MarkType => item?.type === 'note' ? 'note' : item?.type === 'bookmark' ? 'bookmark' : item?.type === 'ink' ? 'ink' : item?.type === 'shape' ? 'shape' : 'highlight'
const rawColor = (item: any) => item?.color || item?.paths?.find((path: any) => path?.color)?.color || ''
const colorBucket = (item: any) => COLOR_BUCKETS.find(bucket => bucket.aliases.includes(rawColor(item)))?.value || ''
const toggleArray = (list: string[], value: string) => list.includes(value) ? list.splice(list.indexOf(value), 1) : list.push(value)
export const useReaderMarks = (i18n?: any) => {
  const { activeReader, activeView } = useReaderState()
  const keyword = ref('')
  const showOrganize = ref(false)
  const markReverse = ref(false)
  const markFilter = ref<FilterState>(createFilter())
  const collapsed = ref<Record<string, true>>({})
  const dragState = ref({ from: '', over: '' })
  const refreshKey = ref(0)
  const editingId = ref('')
  const syncingAll = ref(false)
  const editText = ref('')
  const editNote = ref('')
  const editTags = ref('')
  const editColor = ref('yellow')
  const editStyle = ref('highlight')
  const shapeCache = new Map<string, string>()
  const inkCache = new Map<string, number>()
  const colors = getColorMap()

  const marks = computed(() => activeReader.value?.marks || (activeView.value as any)?.marks)
  const isPdfMode = computed(() => !!(activeView.value as any)?.isPdf)
  const markSort = computed(() => markFilter.value.sort)
  const searchPlaceholder = '搜索标注、笔记、书签、墨迹、形状'
  const getEditColorOptions = (isShape: boolean) => isShape
    ? PDF_SHAPE_COLORS.map(color => ({ key: color, value: color, bg: color }))
    : COLORS.map(color => ({ key: color.color, value: color.color, bg: color.bg }))
  const getEditStyleOptions = () => STYLES
    .filter(item => (!item.pdfOnly || isPdfMode.value) && (!item.epubOnly || !isPdfMode.value))
    .map(item => ({ value: item.type, label: item.name }))
  const getEditShapeOptions = () => SHAPE_TYPE_OPTIONS

  const allEntries = computed(() => {
    refreshKey.value
    const source = marks.value
    if (!source) return []
    const annotations = source.getAnnotations?.() || []
    const bookmarks = source.getBookmarks?.() || []
    const inks = (source.getInkAnnotations?.() || []).map((item: any) => ({ ...item, color: rawColor(item) }))
    const shapes = source.getShapeAnnotations?.() || []
    return [...bookmarks, ...annotations, ...inks, ...shapes]
  })

  const searchText = (item: any) => [item?.title, item?.text, item?.note, ...getMarkTags(item), item?.chapter, item?.key, item?.page && `page ${item.page}`].filter(Boolean).join(' ').toLowerCase()
  const hasActiveFilters = computed(() => !!(markFilter.value.types.length || markFilter.value.colors.length || markFilter.value.textStyles.length || markFilter.value.shapeTypes.length || markFilter.value.tags.length || markFilter.value.note !== 'all' || markFilter.value.sort !== 'time' || markReverse.value))
  const filterLabel = computed(() => hasActiveFilters.value ? '筛选中' : '筛选')
  const typeMode = computed(() => TYPE_CYCLE.find(item => item.value === (markFilter.value.types.length === 1 ? markFilter.value.types[0] : null)) || TYPE_CYCLE[0])
  const toolbarMenuAction = computed(() => ({ id: 'type', icon: typeMode.value.icon, label: typeMode.value.label, tooltipDir: 'sw', active: !!typeMode.value.value }))
  const markGroupKeys = computed(() => Array.isArray(list.value) ? list.value.filter((item: any) => item?.isGroup).map((item: any) => item.key) : [])
  const markAllExpanded = computed(() => !!markGroupKeys.value.length && !markGroupKeys.value.some(key => !!collapsed.value[key]))
  const toolbarActions = computed(() => [
    { id: 'syncAll', icon: '#iconDownload', label: i18n?.syncAll || '同步全部', active: syncingAll.value, show: pendingImportCount.value > 0 },
    { id: 'organize', icon: '#lucide-sliders-horizontal', label: filterLabel.value, active: showOrganize.value || hasActiveFilters.value },
    { id: 'expand', icon: markAllExpanded.value ? '#lucide-panel-top-close' : '#lucide-panel-top-open', label: markAllExpanded.value ? '折叠分组' : '展开分组', show: isGroupedMode.value },
    { id: 'reverse', icon: markReverse.value ? '#lucide-arrow-up-1-0' : '#lucide-arrow-down-0-1', label: markReverse.value ? '倒序' : '正序', active: markReverse.value },
  ])

  const matchFilter = (item: any) => !(
    (markFilter.value.types.length && !markFilter.value.types.includes(getType(item))) ||
    (markFilter.value.colors.length && !markFilter.value.colors.includes(colorBucket(item))) ||
    (markFilter.value.textStyles.length && (!isTextMark(item) || !markFilter.value.textStyles.includes(item.style || 'highlight'))) ||
    (markFilter.value.shapeTypes.length && (item.type !== 'shape' || !markFilter.value.shapeTypes.includes(item.shapeType || 'rect'))) ||
    (markFilter.value.tags.length && !markFilter.value.tags.some(tag => getMarkTags(item).includes(tag))) ||
    (markFilter.value.note === 'with-note' && !item.note?.trim())
  )

  const filtered = computed(() => allEntries.value.filter(matchFilter))
  const isCustomSort = computed(() => markSort.value === 'custom')
  const canDragMarks = computed(() => isCustomSort.value && !keyword.value)
  const isGroupedMode = computed(() => !['time', 'custom'].includes(markSort.value))
  const reverseList = <T,>(items: T[]) => markReverse.value ? [...items].reverse() : items
  const isPageSort = (sort: MarkSort) => sort === 'page' || (sort === 'chapter' && isPdfMode.value)
  const groupKey = (item: any, sort: MarkSort) => {
    if (sort === 'page' || (sort === 'chapter' && isPdfMode.value)) return item.page ? `第${item.page}页` : '未分页'
    if (sort === 'chapter') return item.chapter || '未分类'
    return new Date(item.timestamp || 0).toISOString().slice(0, 10)
  }

  const list = computed(() => {
    let items = filtered.value.filter(item => !keyword.value || searchText(item).includes(keyword.value.toLowerCase()))
    if (markSort.value === 'time') return reverseList(items.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0) || (a.page || 0) - (b.page || 0)))
    if (isCustomSort.value) return reverseList(items.sort((a: any, b: any) => (a.customOrder ?? ORDER_MAX) - (b.customOrder ?? ORDER_MAX) || (b.timestamp || 0) - (a.timestamp || 0)))
    items = [...items].sort((a: any, b: any) => {
      if (isPageSort(markSort.value)) return (a.page || 0) - (b.page || 0) || (b.timestamp || 0) - (a.timestamp || 0)
      const ak = groupKey(a, markSort.value)
      const bk = groupKey(b, markSort.value)
      return ak === bk ? (b.timestamp || 0) - (a.timestamp || 0) : ak.localeCompare(bk)
    })
    const groups = new Map<string, any>()
    items.forEach(item => {
      const key = groupKey(item, markSort.value)
      if (!groups.has(key)) groups.set(key, { key, items: [], isGroup: true })
      groups.get(key).items.push(item)
    })
    return reverseList([...groups.values()].map(group => ({ ...group, items: reverseList(group.items) })))
  })

  const markFilterSections = computed(() => {
    const source = allEntries.value
    const countBy = (matcher: (item: any) => boolean) => source.filter(matcher).length
    const tagCounts = new Map<string, number>()
    source.forEach(item => getMarkTags(item).forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)))
    return [
      { key: 'types', label: '类型', options: TYPE_OPTIONS.map(opt => ({ ...opt, count: countBy(item => getType(item) === opt.value) })) },
      { key: 'colors', label: '颜色', options: COLOR_BUCKETS.map(opt => ({ value: opt.value, label: opt.label, count: countBy(item => colorBucket(item) === opt.value) })).filter(opt => opt.count > 0) },
      { key: 'textStyles', label: '文本样式', options: TEXT_STYLE_OPTIONS.map(opt => ({ ...opt, count: countBy(item => isTextMark(item) && (item.style || 'highlight') === opt.value) })).filter(opt => opt.count > 0) },
      { key: 'shapeTypes', label: '形状类型', options: SHAPE_TYPE_OPTIONS.map(opt => ({ ...opt, count: countBy(item => item.type === 'shape' && (item.shapeType || 'rect') === opt.value) })).filter(opt => opt.count > 0) },
      { key: 'tags', label: '标签', options: [...tagCounts.entries()].map(([value, count]) => ({ value, label: `#${value}`, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, 24) },
      { key: 'note', label: '附加条件', options: NOTE_OPTIONS.map(opt => ({ ...opt, count: opt.value === 'all' ? source.length : countBy(item => !!item.note?.trim()) })) },
    ] as Array<{ key: MarkFilterKey; label: string; options: Array<{ value: string; label: string; count: number }> }>
  })
  const markTagOptions = computed(() => collectMarkTags(allEntries.value))

  const emptyText = computed(() => keyword.value ? (i18n?.notFound || '未找到标注') : (i18n?.empty || '暂无标注'))
  const isCollapsed = (key: string) => !!collapsed.value[key]
  const getMarkItems = (item: any) => item?.isGroup ? (isCollapsed(item.key) ? [] : item.items) : [item]
  const toggleGroup = (key: string) => isCollapsed(key) ? (({ [key]: _, ...rest }) => { collapsed.value = rest })(collapsed.value) : collapsed.value = { ...collapsed.value, [key]: true }
  const toggleGroups = () => collapsed.value = markAllExpanded.value ? Object.fromEntries(markGroupKeys.value.map(key => [key, true])) : {}
  const preloadPage = (page: number) => (activeView.value as any)?.viewer?.renderPage?.(page)

  const getDragKey = (item: any) => item.groupId || item.id || `${item.type}-${item.page || item.section || 0}`
  const saveCustomOrder = (item: any, base: number) => marks.value?.updateMark?.(item, { customOrder: base })
  const startMarkDrag = (event: DragEvent, item: any) => {
    dragState.value.from = getDragKey(item)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', dragState.value.from)
    }
  }
  const endMarkDrag = () => dragState.value = { from: '', over: '' }
  const dropMark = async (target: any) => {
    const sourceId = dragState.value.from
    const targetId = getDragKey(target)
    const items = [...list.value]
    const from = items.findIndex((item: any) => getDragKey(item) === sourceId)
    const to = items.findIndex((item: any) => getDragKey(item) === targetId)
    if (!canDragMarks.value || !sourceId || sourceId === targetId || from < 0 || to < 0) return endMarkDrag()
    const [moved] = items.splice(from, 1)
    items.splice(to, 0, moved)
    await Promise.all(items.map((item: any, index: number) => saveCustomOrder(item, index * 1000)))
    refreshKey.value++
    endMarkDrag()
  }

  const isEditing = (item: any) => editingId.value === getKey(item)
  const showEditOptions = (item: any) => item?.type === 'ink' || item?.type === 'shape' || item?.type === 'highlight' || item?.type === 'note' || !item?.type
  const getBarColor = (item: any) => isEditing(item) ? (colors[editColor.value] || editColor.value) : (colors[item.color] || rawColor(item) || 'var(--b3-theme-primary)')
  const mainText = (item: any) => {
    if (item.type === 'ink') return item.text || ''
    if (item.type === 'shape') return item.shapeType === 'textbox' ? (item.text || '') : ''
    return item.text || item.title || '无内容'
  }
  const canEdit = (item: any) => !isBookmark(item)
  const canImport = (item: any) => !isBookmark(item)
  const pendingImportMarks = computed(() => allEntries.value.filter(item => canImport(item) && !item.blockId))
  const pendingImportCount = computed(() => pendingImportMarks.value.length)
  const showMsg = (msg: string, type: 'info' | 'error' = 'info') => showMessage(msg, type === 'error' ? 3000 : 1500, type)

  const startEdit = (item: any) => {
    editingId.value = getKey(item)
    editText.value = item.text || ''
    editNote.value = item.note || ''
    editTags.value = formatMarkTags(item.tags)
    editColor.value = rawColor(item) || item.color || 'yellow'
    editStyle.value = item.type === 'shape' ? (item.shapeType || 'rect') : (item.style || 'highlight')
  }
  const cancelEdit = () => editingId.value = ''
  const editTagList = computed(() => parseMarkTags(editTags.value))
  const setEditTags = (tags: string[]) => editTags.value = formatMarkTags(tags)
  const toggleEditTag = (tag: string) => {
    const tags = editTagList.value
    setEditTags(tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag])
  }
  const getUrl = () => (window as any).__currentBookUrl || ''

  const saveEdit = async (item: any) => {
    try {
      const updates: any = { color: editColor.value, note: editNote.value.trim() || undefined, tags: parseMarkTags(editTags.value) }
      if (item.type === 'shape') {
        updates.shapeType = editStyle.value || item.shapeType || 'rect'
        updates.filled = updates.shapeType === 'textbox' ? false : !!item.filled
        updates.text = updates.shapeType === 'textbox' ? (editText.value.trim() || '文本框') : undefined
      } else if (item.type === 'ink') {
        updates.text = editText.value.trim() || item.text
      } else {
        updates.text = editText.value.trim()
        updates.style = editStyle.value
      }
      const { saveMarkEdit } = await import('@/utils/copy')
      await saveMarkEdit(item, updates, { marks: marks.value, bookUrl: getUrl(), isPdf: isPdfMode.value, reader: activeReader.value, pdfViewer: (activeView.value as any)?.viewer, shapeCache })
      Object.assign(item, updates)
      editingId.value = ''
      refreshKey.value++
      showMsg('已更新')
    } catch (error: any) {
      showMsg(error?.message || '保存失败', 'error')
    }
  }

  const copyMark = (item: any) => copyMarkUtil(item, { bookUrl: getUrl(), isPdf: isPdfMode.value, reader: activeReader.value, pdfViewer: (activeView.value as any)?.viewer, settings: activeView.value?.settings, shapeCache, showMsg })
  const importMark = async (item: any) => {
    const { importMark: doImport } = await import('@/utils/copy')
    const url = getUrl()
    await doImport(item, { bookUrl: url, bookInfo: url ? await bookshelfManager.getBook(url) : null, isPdf: isPdfMode.value, reader: activeReader.value, pdfViewer: (activeView.value as any)?.viewer, shapeCache, showMsg, i18n, marks: marks.value })
    refreshKey.value++
  }
  const syncAllMarks = async () => {
    if (syncingAll.value) return
    const url = getUrl()
    if (!url) return
    const book = await bookshelfManager.getBook(url)
    const items = pendingImportMarks.value.slice()
    if (!items.length) return
    syncingAll.value = true
    try {
      const { importMark: doImport } = await import('@/utils/copy')
      let count = 0
      for (const item of items) {
        const blockId = await doImport(item, { bookUrl: url, bookInfo: book, isPdf: isPdfMode.value, reader: activeReader.value, pdfViewer: (activeView.value as any)?.viewer, shapeCache, showMsg: () => {}, i18n, marks: marks.value })
        if (blockId) count++
      }
      refreshKey.value++
      showMsg(count ? `${i18n?.syncAll || '同步全部'} ${count}/${items.length}` : (i18n?.importFailed || '导入失败'), count ? 'info' : 'error')
    } finally {
      syncingAll.value = false
    }
  }
  const deleteMark = async (item: any) => {
    if (!marks.value) return showMsg('标注系统未初始化', 'error')
    try {
      await marks.value.deleteMark(item)
      refreshKey.value++
      showMsg('已删除')
    } catch {
      showMsg('删除失败', 'error')
    }
  }

  const goTo = (item: any) => jump(item, activeView.value, activeReader.value, marks.value)
  const onBlockEnter = (event: MouseEvent, id: string) => showFloat(id, event.target as HTMLElement)

  const renderInkCanvas = () => nextTick(() => renderInk(list.value, inkCache, drawInk))
  const renderShapeCanvas = () => nextTick(() => renderShape(list.value, activeView.value, shapeCache, preloadPage))
  const refresh = () => refreshKey.value++

  const isMarkFilterActive = (key: MarkFilterKey, value: string) => key === 'note' ? markFilter.value.note === value : markFilter.value[key].includes(value)
  const toggleMarkFilterItem = (key: MarkFilterKey, value: string) => key === 'note' ? markFilter.value.note = value as MarkNoteFilter : toggleArray(markFilter.value[key], value)
  const resetMarkOrganize = () => { markFilter.value = createFilter(); markReverse.value = false }
  const cycleTypeFilter = () => {
    const index = TYPE_CYCLE.findIndex(item => item.value === (markFilter.value.types.length === 1 ? markFilter.value.types[0] : null))
    const next = TYPE_CYCLE[(index + 1) % TYPE_CYCLE.length]
    markFilter.value.types = next.value ? [next.value] : []
  }
  const handleToolbarAction = (id: string) => {
    if (id === 'syncAll') void syncAllMarks()
    else if (id === 'organize') showOrganize.value = !showOrganize.value
    else if (id === 'type') cycleTypeFilter()
    else if (id === 'expand') toggleGroups()
    else if (id === 'reverse') markReverse.value = !markReverse.value
  }

  const loadState = async () => {
    const book = await bookshelfManager.getBook(getUrl())
    const state = (book as any)?.markPanelState
    if (!book) return
    markFilter.value = { ...createFilter(), ...(state?.filter || { sort: (book as any)?.filterSort || 'time' }) }
    markReverse.value = !!state?.reverse
  }
  const saveState = async () => {
    const url = getUrl()
    if (!url) return
    await bookshelfManager.updateBook(url, { markPanelState: { filter: markFilter.value, reverse: markReverse.value } })
  }

  watch(list, () => { inkCache.clear(); renderInkCanvas(); renderShapeCanvas() }, { immediate: true })
  watch(markReverse, saveState)
  watch(markFilter, saveState, { deep: true })
  onMounted(() => {
    window.addEventListener('sireader:marks-updated', refresh)
    setTimeout(loadState, 120)
  })
  onUnmounted(() => window.removeEventListener('sireader:marks-updated', refresh))

  return {
    MARK_SORT_OPTIONS,
    keyword,
    searchPlaceholder,
    toolbarMenuAction,
    toolbarActions,
    handleToolbarAction,
    showOrganize,
    list,
    emptyText,
    toggleGroup,
    isCollapsed,
    getMarkItems,
    canDragMarks,
    dragState,
    getDragKey,
    startMarkDrag,
    dropMark,
    endMarkDrag,
    getBarColor,
    isEditing,
    editText,
    editNote,
    editTags,
    editTagList,
    startEdit,
    cancelEdit,
    showEditOptions,
    getEditColorOptions,
    getEditStyleOptions,
    getEditShapeOptions,
    editColor,
    editStyle,
    markTagOptions,
    toggleEditTag,
    isPdfMode,
    saveEdit,
    mainText,
    copyMark,
    canEdit,
    isBookmark,
    openBlock,
    onBlockEnter,
    hideFloat,
    canImport,
    importMark,
    deleteMark,
    markFilter,
    markReverse,
    markFilterSections,
    isMarkFilterActive,
    toggleMarkFilterItem,
    resetMarkOrganize,
    getMarkTags,
    goTo,
  }
}

export type { MarkFilterKey }
