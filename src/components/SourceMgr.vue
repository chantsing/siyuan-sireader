<template>
  <div class="sr-source-mgr" @click="showMenu=null">
    <div class="sr-toolbar">
      <input v-model="keyword" placeholder="搜索书源...">
      <template v-if="selected.size">
        <button class="b3-tooltips b3-tooltips__s" @click="batchEnable(true)" aria-label="启用">
          <svg><use xlink:href="#lucide-eye"/></svg>
        </button>
        <button class="b3-tooltips b3-tooltips__s" @click="batchEnable(false)" aria-label="禁用">
          <svg><use xlink:href="#lucide-eye-off"/></svg>
        </button>
        <button class="b3-tooltips b3-tooltips__s" @click="confirmAction='batch'" aria-label="删除">
          <svg><use xlink:href="#lucide-trash-2"/></svg>
        </button>
      </template>
      <button class="b3-tooltips b3-tooltips__s" @click.stop="showHttpPanel=!showHttpPanel" :aria-label="i18n?.httpSources||'HTTP书源'">
        <svg :style="{color:httpEnabled?'var(--b3-theme-primary)':''}"><use xlink:href="#lucide-library-big"/></svg>
      </button>
      <button v-if="!checking" class="b3-tooltips b3-tooltips__s" @click="checkAll" aria-label="检测书源">
        <svg><use xlink:href="#lucide-list-restart"/></svg>
      </button>
      <button v-else class="b3-tooltips b3-tooltips__s" @click="stopCheck = true" aria-label="停止">
        <svg><use xlink:href="#lucide-hand"/></svg>
      </button>
      <button v-if="invalidCount" class="b3-tooltips b3-tooltips__s" @click="confirmAction='invalid'" aria-label="清理失效">
        <svg><use xlink:href="#lucide-brush-cleaning"/></svg>
      </button>
      <button class="b3-tooltips b3-tooltips__s" @click="emit('close')" aria-label="关闭">
        <svg><use xlink:href="#lucide-panel-top-close"/></svg>
      </button>
    </div>

    <Transition name="slide">
      <div v-if="confirmAction" class="sr-confirm-bar" @click.stop>
        <span>{{ confirmAction==='batch'?`删除 ${selected.size} 个书源`:`删除 ${invalidCount} 个失效书源` }}？</span>
        <button @click="confirmAction=null">取消</button>
        <button @click="execDelete" class="btn-delete">删除</button>
      </div>
    </Transition>

    <div class="sr-list">
      <div v-for="s in filtered" :key="s.bookSourceUrl" 
           class="sr-card" 
           :class="{off:!s.enabled,bad:status[s.bookSourceUrl]==='invalid',sel:isSelected(s.bookSourceUrl)}">
        <input type="checkbox" class="b3-checkbox" :checked="isSelected(s.bookSourceUrl)" @change="toggleSelect(s.bookSourceUrl)" @click.stop>
        <svg v-if="status[s.bookSourceUrl]==='checking'" class="sr-icon spin"><use xlink:href="#lucide-refresh-cw"/></svg>
        <svg v-else-if="status[s.bookSourceUrl]==='valid'" class="sr-icon ok"><use xlink:href="#lucide-check"/></svg>
        <svg v-else-if="status[s.bookSourceUrl]==='invalid'" class="sr-icon no"><use xlink:href="#lucide-x"/></svg>
        <div class="sr-info" @click="toggle(s)">
          <div class="sr-name">{{ s.bookSourceName }}</div>
          <div class="sr-url">{{ s.bookSourceUrl }}</div>
        </div>
        <Transition name="fade">
          <div v-if="removingSource===s.bookSourceUrl" class="sr-confirm" @click.stop>
            <button @click="removingSource=null">取消</button>
            <button @click="execRemove(s)" class="btn-delete">删除</button>
          </div>
        </Transition>
        <template v-if="removingSource!==s.bookSourceUrl">
          <button class="sr-btn b3-tooltips b3-tooltips__w" @click.stop="check(s)" aria-label="检测">
            <svg><use xlink:href="#lucide-book-search"/></svg>
          </button>
          <button class="sr-btn b3-tooltips b3-tooltips__w" @click.stop="removingSource=s.bookSourceUrl" aria-label="删除">
            <svg><use xlink:href="#lucide-eraser"/></svg>
          </button>
        </template>
      </div>
      
      <div v-if="!filtered.length" class="sr-empty">{{ keyword?'未找到匹配的书源':'暂无书源' }}</div>
    </div>

    <!-- HTTP书源管理侧滑栏 -->
    <Transition name="slide-panel">
      <div v-if="showHttpPanel" class="sr-panel">
        <div class="sr-panel-header">
          <span>HTTP书源</span>
          <button @click="showHttpPanel=false"><svg><use xlink:href="#lucide-x"/></svg></button>
        </div>
        <div class="sr-panel-body">
          <div v-for="s in httpSources" :key="s.id" class="sr-http-card">
            <div class="sr-http-header" @click="s.type==='custom'?null:toggleHttpSource(s.id)">
              <svg class="sr-http-icon" :style="{color:s.enabled?'var(--b3-theme-primary)':''}">
                <use :xlink:href="s.id==='anna'?'#lucide-library-big':s.id==='gutenberg'?'#lucide-book-open':s.id==='standardebooks'?'#lucide-book-marked':s.type==='custom'?'#lucide-globe':'#lucide-rss'"/>
              </svg>
              <span class="sr-http-title">{{s.name}}</span>
              <button v-if="s.type==='custom'" class="sr-del-btn" @click.stop="removeCustomSource(s.id)"><svg><use xlink:href="#lucide-trash-2"/></svg></button>
              <svg v-else class="sr-toggle-icon" :class="{on:s.enabled}"><use xlink:href="#lucide-toggle-left"/></svg>
            </div>
            <Transition name="expand">
              <div v-if="s.enabled" class="sr-http-body">
                <template v-if="s.id==='anna'">
                  <div class="sr-field">
                    <label>格式筛选</label>
                    <div class="sr-chips">
                      <span v-for="e in ['epub','pdf','mobi','azw3']" :key="e" @click="toggleExt(e)" :class="['sr-chip',{active:annaExts.includes(e)}]">{{e.toUpperCase()}}</span>
                    </div>
                  </div>
                  <div class="sr-field">
                    <label>域名</label>
                    <select v-model="annaDomain" @change="switchDomain">
                      <option v-for="d in annaDomains" :key="d" :value="d">{{d.replace('https://','').replace('annas-archive.','')}}</option>
                    </select>
                  </div>
                  <div class="sr-field">
                    <input v-model="newDomain" placeholder="添加域名 https://..." @keyup.enter="addDomain">
                  </div>
                </template>
                <template v-else-if="s.type==='custom'">
                  <div class="sr-desc">{{s.url}}</div>
                  <div v-if="s.searchUrl" class="sr-desc">搜索: {{s.searchUrl}}</div>
                </template>
                <div v-else class="sr-desc">{{s.id==='gutenberg'?'70,000+ 公版英文书籍':s.id==='standardebooks'?'600+ 高质量排版书籍':'5,000+ 公版多语言书籍'}}</div>
              </div>
            </Transition>
          </div>

          <div class="sr-http-card sr-add-card">
            <div class="sr-http-header" @click="showAddCustom=!showAddCustom">
              <svg class="sr-http-icon"><use xlink:href="#lucide-plus-circle"/></svg>
              <span class="sr-http-title">添加自定义书源</span>
              <svg class="sr-toggle-icon" :class="{on:showAddCustom}"><use xlink:href="#lucide-chevron-down"/></svg>
            </div>
            <Transition name="expand">
              <div v-if="showAddCustom" class="sr-http-body">
                <div class="sr-field">
                  <label>名称</label>
                  <input v-model="customName" placeholder="书源名称">
                </div>
                <div class="sr-field">
                  <label>URL</label>
                  <input v-model="customUrl" placeholder="https://example.com">
                </div>
                <div class="sr-field">
                  <label>搜索URL（可选）</label>
                  <input v-model="customSearchUrl" placeholder="https://example.com/search?q={keyword}">
                </div>
                <button class="sr-add-btn" @click="addCustomSource">添加</button>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { bookSourceManager } from '@/utils/BookSearch'
import { httpSourceManager } from '@/utils/HttpSources'
import { showMessage } from 'siyuan'

const props = defineProps<{ i18n?: any }>()
const emit = defineEmits(['close'])

const sources = ref<BookSource[]>([])
const httpSources = ref<any[]>([])
const status = ref<Record<string, 'checking'|'valid'|'invalid'>>({})
const [checking, keyword, selected, stopCheck, showMenu, removingSource, confirmAction, showHttpPanel] = 
  [ref(false), ref(''), ref<Set<string>>(new Set()), ref(false), ref<string|null>(null), ref<string|null>(null), ref<'batch'|'invalid'|null>(null), ref(false)]
const [annaExts, annaDomain, annaDomains, newDomain] = [ref<string[]>([]), ref(''), ref<string[]>([]), ref('')]
const [showAddCustom, customName, customUrl, customSearchUrl] = [ref(false), ref(''), ref(''), ref('')]

const loadHttpSources = () => {
  httpSources.value = httpSourceManager.getSources()
  const anna = httpSources.value.find(s => s.id === 'anna')
  if (anna) { annaExts.value = anna.filters?.extensions || []; annaDomain.value = anna.currentDomain || ''; annaDomains.value = anna.domains || [] }
}

const httpEnabled = computed(() => httpSources.value.some(s => s.enabled))
const filtered = computed(() => keyword.value ? sources.value.filter(s => [s.bookSourceName, s.bookSourceUrl, s.bookSourceGroup].some(x => x?.toLowerCase().includes(keyword.value.toLowerCase()))) : sources.value)
const invalidCount = computed(() => sources.value.filter(s => status.value[s.bookSourceUrl] === 'invalid').length)
const isSelected = (url: string) => selected.value.has(url)
const reload = () => sources.value = bookSourceManager.getSources()
const toggleSelect = (url: string) => selected.value.has(url) ? selected.value.delete(url) : selected.value.add(url)

const toggleHttpSource = async (id: string) => {
  await httpSourceManager.toggleSource(id)
  loadHttpSources()
  const s = httpSources.value.find(x => x.id === id)
  showMessage(s?.enabled ? `已启用 ${s.name}` : `已禁用 ${s?.name}`, 1500)
}

const toggleExt = async (e: string) => {
  annaExts.value.includes(e) ? annaExts.value.splice(annaExts.value.indexOf(e), 1) : annaExts.value.push(e)
  await httpSourceManager.setAnnaExtensions(annaExts.value)
  loadHttpSources()
}

const switchDomain = async () => { await httpSourceManager.switchAnnaDomain(annaDomain.value); loadHttpSources(); showMessage('域名已切换', 1500) }
const addDomain = async () => {
  if (!newDomain.value.startsWith('http')) return showMessage('请输入完整URL', 2000, 'error')
  await httpSourceManager.addAnnaDomain(newDomain.value)
  loadHttpSources()
  newDomain.value = ''
  showMessage('域名已添加', 1500)
}

const addCustomSource = async () => {
  if (!customName.value.trim() || !customUrl.value.trim()) return showMessage('请填写名称和URL', 2000, 'error')
  await httpSourceManager.addCustomSource({ name: customName.value, url: customUrl.value, searchUrl: customSearchUrl.value, enabled: true })
  loadHttpSources()
  customName.value = customUrl.value = customSearchUrl.value = ''
  showAddCustom.value = false
  showMessage('已添加', 1500)
}

const removeCustomSource = async (id: string) => { await httpSourceManager.removeSource(id); loadHttpSources(); showMessage('已删除', 1500) }

const batchEnable = (enable: boolean) => {
  let count = 0
  selected.value.forEach(url => { const s = sources.value.find(x => x.bookSourceUrl === url); s && s.enabled !== enable && (s.enabled = enable, bookSourceManager.addSource(s), count++) })
  reload(); selected.value.clear(); showMessage(`${enable ? '启用' : '禁用'} ${count} 个书源`)
}

const execDelete = () => {
  if (confirmAction.value === 'batch') {
    const count = selected.value.size
    selected.value.forEach(url => (bookSourceManager.removeSource(url), delete status.value[url]))
    selected.value.clear()
    showMessage(`删除 ${count} 个书源`)
  } else {
    const invalid = sources.value.filter(s => status.value[s.bookSourceUrl] === 'invalid')
    invalid.forEach(s => (bookSourceManager.removeSource(s.bookSourceUrl), delete status.value[s.bookSourceUrl]))
    showMessage(`已删除 ${invalid.length} 个`)
  }
  reload(); confirmAction.value = null
}

const toggle = (s: BookSource) => (s.enabled = !s.enabled, bookSourceManager.addSource(s), reload())
const execRemove = (s: BookSource) => (bookSourceManager.removeSource(s.bookSourceUrl), delete status.value[s.bookSourceUrl], reload(), removingSource.value = null, showMessage('已删除'))

const check = async (s: BookSource) => {
  if (stopCheck.value) return
  status.value[s.bookSourceUrl] = 'checking'
  for (const kw of ['小说', '网文', '书', '青春']) {
    if (stopCheck.value) return
    try {
      const results = await Promise.race([bookSourceManager.searchBooks(kw, s.bookSourceUrl), new Promise<never>((_, rej) => setTimeout(rej, 12000))])
      if (results.length > 0) return status.value[s.bookSourceUrl] = 'valid'
    } catch {}
  }
  !stopCheck.value && (status.value[s.bookSourceUrl] = 'invalid')
}

const checkAll = async () => {
  stopCheck.value = false
  checking.value = true
  const enabled = sources.value.filter(s => s.enabled)
  for (let i = 0; i < enabled.length && !stopCheck.value; i += 5) await Promise.allSettled(enabled.slice(i, i + 5).map(check))
  checking.value = false
  const validCount = enabled.filter(s => status.value[s.bookSourceUrl] === 'valid').length
  showMessage(stopCheck.value ? `检测停止: ${validCount} 有效` : `检测完成: ${validCount}/${enabled.length} 有效`)
}

onMounted(async () => { await bookSourceManager.loadSources(); reload(); loadHttpSources() })
onBeforeUnmount(() => (stopCheck.value = true, checking.value = false))
</script>

<style scoped lang="scss">
@use './deck/deck.scss';
.sr-source-mgr{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--b3-theme-background);z-index:10}
.sr-confirm-bar{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--b3-theme-border);background:var(--b3-theme-surface);font-size:13px;span{flex:1;font-weight:500}button{padding:6px 12px;font-size:13px;line-height:1.4;border:1px solid var(--b3-border-color);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);border-radius:4px;cursor:pointer;transition:all .15s;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;&:hover{background:var(--b3-list-hover)}&.btn-delete{background:var(--b3-theme-error)!important;color:white!important;border-color:var(--b3-theme-error)!important;&:hover{opacity:.9!important;background:var(--b3-theme-error)!important}}}}
.slide-enter-active,.slide-leave-active,.fade-enter-active,.fade-leave-active{transition:all .2s}
.slide-enter-from,.slide-leave-to{opacity:0;transform:translateY(-100%)}
.fade-enter-from,.fade-leave-to{opacity:0;transform:scale(.9)}
.sr-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px}
.sr-card{position:relative;display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--b3-theme-surface);border-radius:4px;cursor:pointer;transition:transform .15s;&:hover{transform:translateY(-1px)}&.off{opacity:.5}&.bad{border:1px solid var(--b3-theme-error);background:color-mix(in srgb,var(--b3-theme-error) 5%,transparent)}&.sel{border:1px solid var(--b3-theme-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--b3-theme-primary) 20%,transparent)}}
.sr-icon{width:16px;height:16px;flex-shrink:0;&.spin{animation:spin 1.2s linear infinite}&.ok{color:var(--b3-theme-primary)}&.no{color:var(--b3-theme-error)}}
@keyframes spin{to{transform:rotate(360deg)}}
.sr-info{flex:1;min-width:0}
.sr-name{font-size:13px;font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-url{font-size:11px;opacity:.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-btn{width:28px;height:28px;padding:0;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:background .15s;flex-shrink:0;svg{width:16px;height:16px}&:hover{background:var(--b3-theme-background)}}

// 侧滑栏
.slide-panel-enter-active,.slide-panel-leave-active{transition:all .2s}
.slide-panel-enter-from,.slide-panel-leave-to{opacity:0;transform:translateX(15px)}
.sr-panel{position:absolute;top:0;right:0;bottom:0;width:340px;background:var(--b3-theme-surface);border-left:1px solid var(--b3-border-color);box-shadow:-2px 0 8px rgba(0,0,0,.1);z-index:100;display:flex;flex-direction:column}
.sr-panel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--b3-border-color);font-size:14px;font-weight:600;button{width:24px;height:24px;padding:0;border:none;background:transparent;cursor:pointer;svg{width:16px;height:16px}&:hover{color:var(--b3-theme-primary)}}}
.sr-panel-body{flex:1;overflow-y:auto;padding:12px}

// HTTP书源卡片
.sr-http-card{background:var(--b3-theme-background);border-radius:6px;margin-bottom:8px;border:1px solid var(--b3-border-color);transition:border-color .15s;&:hover{border-color:var(--b3-theme-primary)}}
.sr-http-header{display:flex;align-items:center;gap:10px;padding:12px;cursor:pointer;transition:background .15s;&:hover{background:var(--b3-list-hover)}}
.sr-http-icon{width:20px;height:20px;flex-shrink:0;transition:color .15s}
.sr-http-title{flex:1;font-size:13px;font-weight:600}
.sr-toggle-icon{width:32px;height:20px;flex-shrink:0;opacity:.3;transition:all .15s;&.on{opacity:1;color:var(--b3-theme-primary);transform:scaleX(-1)}}
.sr-http-body{padding:0 12px 12px}
.expand-enter-active,.expand-leave-active{transition:all .2s;overflow:hidden}
.expand-enter-from,.expand-leave-to{opacity:0;max-height:0}
.expand-enter-to,.expand-leave-from{opacity:1;max-height:500px}
.sr-field{margin-bottom:10px;&:last-child{margin-bottom:0}label{display:block;font-size:11px;font-weight:500;color:var(--b3-theme-on-surface-variant);margin-bottom:6px}input,select{width:100%;padding:6px 10px;border:1px solid var(--b3-border-color);border-radius:4px;font-size:12px;background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);box-sizing:border-box;transition:border-color .15s;&:focus{outline:none;border-color:var(--b3-theme-primary)}&::placeholder{color:var(--b3-theme-on-surface-variant);opacity:.5}}}
.sr-desc{font-size:11px;color:var(--b3-theme-on-surface-variant);padding:4px 0}
.sr-chips{display:flex;gap:6px;flex-wrap:wrap;.sr-chip{padding:4px 10px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);color:var(--b3-theme-on-surface);border-radius:12px;font-size:11px;font-weight:500;cursor:pointer;transition:all .15s;&:hover{background:var(--b3-list-hover);transform:translateY(-1px)}&.active{background:var(--b3-theme-primary);color:white;border-color:var(--b3-theme-primary);box-shadow:0 2px 4px rgba(var(--b3-theme-primary-rgb),.3)}}}
.sr-del-btn{width:28px;height:28px;padding:0;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:4px;transition:all .15s;svg{width:14px;height:14px}&:hover{background:var(--b3-theme-error-lighter);color:var(--b3-theme-error)}}
.sr-add-card{border-style:dashed;&:hover{border-color:var(--b3-theme-primary);background:color-mix(in srgb,var(--b3-theme-primary) 3%,transparent)}}
.sr-add-btn{width:100%;padding:8px;border:none;background:var(--b3-theme-primary);color:white;border-radius:4px;font-size:12px;font-weight:500;cursor:pointer;transition:opacity .15s;&:hover{opacity:.9}}
</style>