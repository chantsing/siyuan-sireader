<template>
  <DockShell
    class="sr-search"
    body-class="sr-body-scroll sr-body-pad-8"
    v-model:search-value="keyword"
    :search-placeholder="i18n.searchPlaceholder || TEXT.searchPlaceholder"
    :search-disabled="searching"
    :toolbar-menu-action="toolbarMenuAction"
    :toolbar-actions="toolbarActions"
    @click="closeOverlays"
    @search-enter="search"
    @toolbar-action="handleToolbarAction"
  >
    <template #toolbar-menu>
      <div v-if="showSourceMenu" class="sr-toolbar-popover" @click.stop>
        <div :class="['sr-toolbar-popover-item', { active: !selectedSource }]" @click="pickSource('')">{{ i18n.allSources || TEXT.allSources }}</div>
        <div v-for="src in enabledSources" :key="src.id" :class="['sr-toolbar-popover-item', { active: selectedSource === src.id }]" @click="pickSource(src.id)">{{ src.name }}</div>
      </div>
    </template>

      <div v-if="!searching && !results.length && keyword" class="sr-placeholder">{{ i18n.noResults || TEXT.noResults }}</div>
      <div v-else class="sr-list">
      <div v-for="book in results" :key="book.bookUrl" class="sr-card" @click="detailBook = book">
        <div class="sr-cover-wrap">
          <img v-if="shouldShowCover(book)" :src="book.coverUrl" @error="handleCoverError(book)" class="sr-cover">
          <div v-else class="sr-text-cover">{{ book.name }}</div>
        </div>
        <div class="sr-info">
          <div class="sr-title">{{ book.name }}</div>
          <div class="sr-author">{{ book.author }}</div>
          <div v-if="book.kind" class="sr-author">{{ book.kind }}</div>
          <div v-if="book.extension || book.fileSize" class="sr-author">
            <span v-if="book.extension">{{ book.extension }}</span>
            <span v-if="book.extension && book.fileSize"> / </span>
            <span v-if="book.fileSize">{{ book.fileSize }}</span>
          </div>
          <div v-if="book.intro" class="sr-intro">{{ book.intro }}</div>
          <div class="sr-source">{{ book.sourceName }}</div>
        </div>
        <button v-if="hasDownloadUrl(book)" class="sr-btn-icon b3-tooltips b3-tooltips__w" :class="{ active: isInShelf(book) }" :aria-label="isInShelf(book) ? TEXT.inShelf : TEXT.addToShelf" @click.stop="addUrlBook(book)"><svg><use :xlink:href="isInShelf(book) ? '#iconCheck' : '#iconDownload'"/></svg></button>
        <button v-else class="sr-btn-icon b3-tooltips b3-tooltips__w" :aria-label="i18n.openLink || TEXT.openLink" @click.stop="openLink(book.bookUrl)"><svg><use xlink:href="#iconLink"/></svg></button>
      </div>
        <div v-if="searching" class="sr-status">{{ TEXT.searching }}</div>
      </div>

    <template #overlay>
    <Transition name="fade">
        <div v-if="showManagePanel" class="sr-manage-panel" @click.stop>
          <div class="sr-manage-head">
            <div>
              <div class="sr-manage-title">{{ TEXT.manageTitle }}</div>
              <small>{{ TEXT.manageDesc }}</small>
            </div>
            <button class="sr-btn-icon" @click="startAddCustom"><svg><use xlink:href="#lucide-book-plus"/></svg></button>
          </div>

          <div class="sr-manage-group">
            <div v-for="src in allSources" :key="src.id" class="sr-manage-item">
              <div class="sr-manage-info">
                <div>{{ src.name }}</div>
                <small>{{ sourceDesc(src) }}</small>
              </div>
              <div class="sr-manage-actions">
                <button class="sr-text-btn" @click="startEditSource(src)">{{ TEXT.edit }}</button>
                <button v-if="src.type === 'custom'" class="sr-text-btn danger" @click="removeCustomSource(src.id)">{{ TEXT.remove }}</button>
                <input type="checkbox" class="b3-switch" :checked="src.enabled" @change="toggleSource(src.id)">
              </div>
            </div>
          </div>

          <div v-if="editingSource" class="sr-manage-group sr-edit-group">
            <div class="sr-manage-subtitle">{{ form.id ? TEXT.editSource : TEXT.addSource }}</div>
            <div v-for="field in baseFields" :key="field.key" class="sr-field">
              <label>{{ field.label }}</label>
              <input v-model.trim="form[field.key]" class="b3-text-field" :placeholder="field.placeholder">
            </div>

            <template v-if="form.type === 'anna'">
              <div class="sr-field"><label>{{ TEXT.domains }}</label><textarea v-model.trim="form.domainsText" class="b3-text-field" rows="3" :placeholder="TEXT.domainsPlaceholder"></textarea></div>
              <div class="sr-field"><label>{{ TEXT.currentDomain }}</label><input v-model.trim="form.currentDomain" class="b3-text-field"></div>
            </template>
            <template v-else-if="builtinTypeSet.has(form.type)">
              <div class="sr-field"><label>{{ TEXT.siteUrl }}</label><input v-model.trim="form.url" class="b3-text-field"></div>
            </template>
            <template v-else>
              <div v-for="field in customFields" :key="field.key" class="sr-field">
                <label>{{ field.label }}</label>
                <input v-model.trim="form[field.key]" class="b3-text-field" :placeholder="field.placeholder">
              </div>
              <div class="sr-grid-two">
                <div v-for="[key, , label, placeholder] in selectorFields" :key="key" class="sr-field">
                  <label>{{ label }}</label>
                  <input v-model.trim="form[key]" class="b3-text-field" :placeholder="placeholder">
                </div>
              </div>
            </template>

            <div class="sr-actions">
              <button class="sr-text-btn" @click="cancelEditSource">{{ TEXT.cancel }}</button>
              <button class="sr-btn-primary" @click="saveSource">{{ TEXT.save }}</button>
            </div>
          </div>
        </div>
    </Transition>

    <Transition name="slide">
        <div v-if="detailBook" class="sr-detail">
          <div class="sr-detail-header">
            <span>{{ TEXT.detail }}</span>
            <button class="sr-btn-icon" @click="detailBook = null"><svg><use xlink:href="#iconClose"/></svg></button>
          </div>
          <div class="sr-detail-content">
            <img class="sr-cover-large" :src="detailBook.coverUrl || '/icons/book-placeholder.svg'" @error="onDetailCoverError">
            <h2>{{ detailBook.name }}</h2>
            <p class="sr-meta">{{ detailBook.author }}</p>
            <div v-if="detailTags.length || detailBook.extension || detailBook.fileSize || detailBook.language || detailBook.year" class="sr-tags">
              <span v-for="tag in detailTags" :key="tag">{{ tag }}</span>
              <span v-if="detailBook.extension">{{ detailBook.extension }}</span>
              <span v-if="detailBook.fileSize">{{ detailBook.fileSize }}</span>
              <span v-if="detailBook.language">{{ detailBook.language }}</span>
              <span v-if="detailBook.year">{{ detailBook.year }}</span>
            </div>
            <p v-if="detailBook.intro" class="sr-intro-full">{{ detailBook.intro }}</p>
            <div class="sr-actions-full">
              <button v-if="hasDownloadUrl(detailBook)" class="sr-btn-primary" :class="{ active: isInShelf(detailBook) }" @click="addUrlBook(detailBook)">
                <svg><use :xlink:href="isInShelf(detailBook) ? '#iconCheck' : '#iconDownload'"/></svg>{{ isInShelf(detailBook) ? TEXT.inShelf : TEXT.addToShelf }}
              </button>
              <button class="sr-btn-primary" @click="openLink(detailBook.bookUrl)"><svg><use xlink:href="#iconLink"/></svg>{{ i18n.openLink || TEXT.openLink }}</button>
            </div>
          </div>
        </div>
    </Transition>
    </template>
  </DockShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { showMessage } from 'siyuan'
import { bookshelfManager } from '@/core/bookshelf'
import { httpSourceManager, type HttpSourceConfig } from '@/utils/HttpSources'
import DockShell from './ui/DockShell.vue'

const TEXT = { searchPlaceholder: '输入书名搜索', allSources: '全部来源', manageTitle: '来源管理', manageDesc: '统一管理内置源、自定义源和请求前缀。', edit: '编辑', remove: '删除', editSource: '编辑来源', addSource: '新增自定义来源', domains: '镜像列表', domainsPlaceholder: '每行一个域名', currentDomain: '当前镜像', siteUrl: '站点地址', searchUrl: '搜索地址', bookUrlPrefix: '书籍地址前缀', itemSelector: '结果项选择器', titleSelector: '标题选择器', authorSelector: '作者选择器', linkSelector: '链接选择器', coverSelector: '封面选择器', introSelector: '简介选择器', requestPrefix: '请求前缀 / 代理', requestPrefixPlaceholder: '留空或填写代理前缀', name: '名称', extensions: '扩展名过滤', extensionsPlaceholder: 'epub,pdf,mobi,azw3', siteUrlPlaceholder: 'https://example.com', searchUrlPlaceholder: 'https://example.com/search?q={query}', bookUrlPrefixPlaceholder: '留空自动推断', cancel: '取消', save: '保存', noResults: '未找到书籍', searching: '搜索中...', inShelf: '已在书架', addToShelf: '添加到书架', openLink: '打开链接', detail: '书籍详情', saveError: '来源名称不能为空', customError: '自定义源至少需要搜索地址、结果项、标题、链接选择器', saveSuccess: '来源已保存', addError: '添加失败', sourceDescCustom: '自定义选择器来源', sourceDescAnna: '镜像 / 扩展名 / 请求前缀', sourceDescBuiltin: '内置来源' } as const
const FORM_DEFAULTS = { id: '', type: 'custom', name: '', url: '', searchUrl: '', requestPrefix: '', extensions: '', domainsText: '', currentDomain: '', bookUrlPrefix: '', itemSelector: '', titleSelector: '', authorSelector: '', linkSelector: '', coverSelector: '', introSelector: '' }
const field = (key: keyof typeof FORM_DEFAULTS, label: string, placeholder = '') => ({ key, label, placeholder })
const baseFields = [field('name', TEXT.name), field('requestPrefix', TEXT.requestPrefix, TEXT.requestPrefixPlaceholder), field('extensions', TEXT.extensions, TEXT.extensionsPlaceholder)] as const
const customFields = [field('url', TEXT.siteUrl, TEXT.siteUrlPlaceholder), field('searchUrl', TEXT.searchUrl, TEXT.searchUrlPlaceholder), field('bookUrlPrefix', TEXT.bookUrlPrefix, TEXT.bookUrlPrefixPlaceholder)] as const
const selectorFields = [['itemSelector', 'item', TEXT.itemSelector, '.book-item'], ['titleSelector', 'title', TEXT.titleSelector, '.title'], ['authorSelector', 'author', TEXT.authorSelector, '.author'], ['linkSelector', 'link', TEXT.linkSelector, 'a'], ['coverSelector', 'cover', TEXT.coverSelector, 'img'], ['introSelector', 'intro', TEXT.introSelector, '.intro']] as const
const builtinTypeSet = new Set(['gutenberg', 'standardebooks'])
const props = defineProps<{ i18n: any }>()
const i18n = computed(() => props.i18n || {})
const keyword = ref(''), selectedSource = ref(''), showSourceMenu = ref(false), showManagePanel = ref(false), searching = ref(false), results = ref<any[]>([]), allSources = ref<HttpSourceConfig[]>([]), detailBook = ref<any>(null), editingSource = ref<HttpSourceConfig | null>(null), shelfBooks = ref(new Set<string>()), failedCovers = new Set<string>(), form = reactive({ ...FORM_DEFAULTS })
const enabledSources = computed(() => allSources.value.filter(source => source.enabled))
const detailTags = computed(() => detailBook.value?.kind?.split(',').filter(Boolean) || [])
const selectedSourceName = computed(() => !selectedSource.value ? i18n.value.allSources || TEXT.allSources : enabledSources.value.find(source => source.id === selectedSource.value)?.name || '')
const toolbarMenuAction = computed(() => ({ id: 'source', icon: '#lucide-sliders-horizontal', label: selectedSourceName.value }))
const toolbarActions = computed(() => [{ id: 'manage', icon: '#lucide-settings-2', label: TEXT.manageTitle }])

const normalizeExtensions = (value: string) => Array.from(new Set(value.split(/[,，\s]+/).map(item => item.trim().toLowerCase()).filter(Boolean)))
const sourceDesc = (source: HttpSourceConfig) => source.type === 'custom' ? TEXT.sourceDescCustom : source.type === 'anna' ? TEXT.sourceDescAnna : TEXT.sourceDescBuiltin
const shouldShowCover = (book: any) => book.coverUrl && !failedCovers.has(book.coverUrl)
const handleCoverError = (book: any) => failedCovers.add(book.coverUrl)
const onDetailCoverError = (event: Event) => ((event.target as HTMLImageElement).src = '/icons/book-placeholder.svg')
const isInShelf = (book: any) => shelfBooks.value.has(book.bookUrl)
const hasDownloadUrl = (book: any) => (book.downloadUrl || book.bookUrl)?.match(/^https?:\/\/.+\.(epub|pdf|mobi|azw3)(\?|$)/i)
const resetForm = () => Object.assign(form, FORM_DEFAULTS)
const closeOverlays = () => (showSourceMenu.value = false, showManagePanel.value = false)
const toggleSourceMenu = () => (showManagePanel.value = false, showSourceMenu.value = !showSourceMenu.value)
const toggleManagePanel = () => (showSourceMenu.value = false, showManagePanel.value = !showManagePanel.value)
const handleToolbarAction = (id: string) => { if (id === 'source') toggleSourceMenu(); else if (id === 'manage') toggleManagePanel() }
const pickSource = (id: string) => (selectedSource.value = id, showSourceMenu.value = false)
const checkInShelf = async (book: any) => (await bookshelfManager.hasBook(book.bookUrl)) && shelfBooks.value.add(book.bookUrl)

const openLink = (url: string) => window.open(props.i18n.name === '思源阅读' ? url.replace('annas-archive.org', 'zh.annas-archive.org') : url, '_blank')
const loadHttpSources = async () => {
  await httpSourceManager.init()
  allSources.value = httpSourceManager.getSources()
  if (selectedSource.value && !allSources.value.some(source => source.id === selectedSource.value && source.enabled)) selectedSource.value = ''
}
const toggleSource = async (id: string) => (await httpSourceManager.toggleSource(id), loadHttpSources())
const assignFormFromSource = (source: HttpSourceConfig) => Object.assign(form, { ...FORM_DEFAULTS, id: source.id, type: source.type, name: source.name || '', url: source.url || '', searchUrl: source.searchUrl || '', requestPrefix: source.requestPrefix || '', extensions: (source.filters?.extensions || []).join(','), domainsText: (source.domains || []).join('\n'), currentDomain: source.currentDomain || '', bookUrlPrefix: source.bookUrlPrefix || '', ...Object.fromEntries(selectorFields.map(([key, sourceKey]) => [key, source.selectors?.[sourceKey] || ''])) })
const startEditSource = (source: HttpSourceConfig) => (editingSource.value = source, assignFormFromSource(source))
const startAddCustom = () => (editingSource.value = { id: '', type: 'custom', name: '', enabled: true }, resetForm())
const cancelEditSource = () => (editingSource.value = null, resetForm())

const saveSource = async () => {
  if (!form.name.trim()) return showMessage(TEXT.saveError, 2000, 'error')
  const filters = { extensions: normalizeExtensions(form.extensions) }
  if (form.type === 'custom') {
    if (!form.searchUrl.trim() || !form.itemSelector.trim() || !form.titleSelector.trim() || !form.linkSelector.trim()) return showMessage(TEXT.customError, 3000, 'error')
    const payload = { name: form.name.trim(), enabled: true, url: form.url.trim(), searchUrl: form.searchUrl.trim(), requestPrefix: form.requestPrefix.trim(), filters, bookUrlPrefix: form.bookUrlPrefix.trim(), selectors: Object.fromEntries(selectorFields.map(([key, sourceKey]) => [sourceKey, form[key].trim()])) }
    if (form.id) await httpSourceManager.updateSource(form.id, payload)
    else await httpSourceManager.addCustomSource(payload)
  } else {
    await httpSourceManager.updateSource(form.id, { name: form.name.trim(), url: form.url.trim(), requestPrefix: form.requestPrefix.trim(), filters, domains: form.type === 'anna' ? form.domainsText.split(/\r?\n/).map(item => item.trim()).filter(Boolean) : undefined, currentDomain: form.type === 'anna' ? form.currentDomain.trim() : undefined })
  }
  await loadHttpSources()
  showMessage(TEXT.saveSuccess, 1500, 'info')
  cancelEditSource()
}

const removeCustomSource = async (id: string) => {
  await httpSourceManager.removeSource(id)
  await loadHttpSources()
  if (form.id === id) cancelEditSource()
}
const search = async () => {
  if (!keyword.value.trim()) return
  searching.value = true
  results.value = []
  try {
    await httpSourceManager.init()
    results.value = await httpSourceManager.search(keyword.value, selectedSource.value || undefined)
    await Promise.all(results.value.map(checkInShelf))
  } catch (error: any) {
    showMessage(`搜索失败: ${error.message}`, 3000, 'error')
  } finally {
    searching.value = false
  }
}
const addUrlBook = async (book: any) => {
  try {
    await httpSourceManager.init()
    await httpSourceManager.addToBookshelf(book, bookshelfManager)
    shelfBooks.value.add(book.bookUrl)
    showMessage(`《${book.name}》已添加到书架`, 2000, 'info')
  } catch (error: any) {
    showMessage(error.message || TEXT.addError, 3000, 'error')
  }
}

onMounted(() => {
  loadHttpSources()
  window.addEventListener('http-sources-updated', loadHttpSources)
})
onUnmounted(() => window.removeEventListener('http-sources-updated', loadHttpSources))
</script>

<style scoped lang="scss">
@use './deck/deck.scss';

.sr-search{position:relative;display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--b3-theme-background)}
.sr-select{position:relative;display:flex;flex:0 0 auto}
.sr-menu{position:absolute;top:34px;right:0;min-width:180px;padding:6px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;box-shadow:0 8px 24px #0002;z-index:20}
.sr-menu-item{padding:8px 10px;border-radius:6px;cursor:pointer;font-size:12px}
.sr-menu-item:hover,.sr-menu-item.active{background:var(--b3-list-hover);color:var(--b3-theme-primary)}
.sr-results{flex:1;min-height:0;overflow:auto;padding:12px 8px;box-sizing:border-box}
.sr-btn-icon{width:28px;height:28px;padding:0;background:transparent;color:var(--b3-theme-on-surface);opacity:.5;border-radius:4px;border:none;cursor:pointer;
  &:hover{opacity:1;background:var(--b3-theme-surface)}
  &:active{opacity:1;color:var(--b3-theme-primary);background:var(--b3-theme-primary-lightest)}
}
.sr-btn-primary{height:32px;padding:0 14px;background:var(--b3-theme-primary);color:var(--b3-theme-on-primary);border-radius:4px;font-size:12px;font-weight:500;
  &:hover{transform:translateY(-1px);box-shadow:0 2px 6px #0003}
  &.active{opacity:.5;pointer-events:none}
}
.sr-manage-panel{position:absolute;top:44px;left:8px;right:8px;max-height:calc(100% - 56px);overflow:auto;padding:12px;box-sizing:border-box;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:10px;box-shadow:0 8px 24px #0002;z-index:20}
.sr-manage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.sr-manage-title,.sr-manage-subtitle{font-size:13px;font-weight:600}
.sr-manage-head small{display:block;font-size:11px;opacity:.65;line-height:1.45}
.sr-manage-group{margin-top:12px;padding-top:12px;border-top:1px solid var(--b3-border-color)}
.sr-manage-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}
.sr-manage-info{min-width:0;div{font-size:12px;font-weight:500}small{display:block;font-size:11px;opacity:.6;margin-top:2px}}
.sr-manage-actions{display:flex;align-items:center;gap:6px;flex-shrink:0}
.sr-edit-group{background:var(--b3-theme-background);border:1px solid var(--b3-border-color);border-radius:10px;padding:12px}
.sr-field{display:flex;flex-direction:column;gap:4px;margin-top:10px;min-width:0;label{font-size:12px;font-weight:500}input,textarea,select{width:100%;min-width:0;box-sizing:border-box}}
.sr-grid-two{display:grid;grid-template-columns:1fr;gap:10px}
.sr-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.sr-text-btn{padding:4px 8px;border:none;background:transparent;border-radius:6px;font-size:12px;color:var(--b3-theme-on-surface);cursor:pointer;&:hover{background:var(--b3-list-hover)}&.danger{color:var(--b3-theme-error)}}
.sr-list{display:flex;flex-direction:column;gap:8px}
.sr-card{display:flex;gap:12px;padding:12px;background:var(--b3-theme-surface);border-radius:6px;cursor:pointer;transition:transform .15s;&:hover{transform:translateY(-2px)}}
.sr-cover-wrap{width:80px;height:112px;border-radius:4px;flex-shrink:0;overflow:hidden;background:linear-gradient(135deg,var(--b3-theme-primary-lightest),var(--b3-theme-surface-lighter))}
.sr-cover{width:100%;height:100%;object-fit:cover}
.sr-text-cover{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:8px;font-size:12px;font-weight:600;text-align:center;line-height:1.3;color:var(--b3-theme-on-surface);word-break:break-word;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical}
.sr-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.sr-title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-author{font-size:11px;opacity:.6}
.sr-intro{font-size:11px;opacity:.5;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.4}
.sr-source{font-size:10px;color:var(--b3-theme-primary);font-weight:600;padding:2px 6px;background:var(--b3-theme-primary-lightest);border-radius:3px;align-self:flex-start}
.sr-status{display:flex;align-items:center;justify-content:center;gap:8px;padding:16px;background:var(--b3-theme-surface);border-radius:6px;margin:0 0 8px;font-size:12px;opacity:.7}
.sr-placeholder{padding:40px;text-align:center;opacity:.5;font-size:12px}
.slide-enter-active{transition:all .2s cubic-bezier(.4,0,.2,1)}
.slide-leave-active{transition:all .15s cubic-bezier(.4,0,1,1)}
.slide-enter-from{opacity:0;transform:translateX(15px)}
.slide-leave-to{opacity:0;transform:translateX(-15px)}
.fade-enter-active,.fade-leave-active{transition:opacity .15s}
.fade-enter-from,.fade-leave-to{opacity:0}
.sr-detail{position:absolute;top:0;right:0;bottom:0;width:320px;background:var(--b3-theme-background);box-shadow:-4px 0 12px #0003;z-index:10;display:flex;flex-direction:column}
.sr-detail-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--b3-border-color);span{font-size:13px;font-weight:600}}
.sr-detail-content{flex:1;overflow-y:auto;padding:16px;h2{font-size:16px;font-weight:600;margin:0 0 4px}.sr-meta{font-size:12px;opacity:.6;margin:0 0 10px}}
.sr-cover-large{width:100%;height:auto;aspect-ratio:7/10;object-fit:cover;border-radius:6px;margin-bottom:12px}
.sr-tags{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;span{padding:2px 8px;background:var(--b3-theme-surface);border-radius:8px;font-size:10px}}
.sr-intro-full{line-height:1.5;opacity:.7;margin-bottom:14px;font-size:12px}
.sr-actions-full{display:flex;gap:6px;margin-bottom:14px;button{flex:1}}
</style>
