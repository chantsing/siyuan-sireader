
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { showMessage } from 'siyuan'
import type { ReaderSettings, FontFileInfo } from '@/composables/useSetting'
import { PRESET_THEMES, UI_CONFIG, useSetting, useConfirm } from '@/composables/useSetting'
import BookSearch from './BookSearch.vue'
import BookShelf from './BookShelf.vue'
import ReaderToc from './ReaderToc.vue'
import { bookshelfManager } from '@/core/bookshelf'
import { offlineDictManager, onlineDictManager } from '@/utils/dictionary'
import { usePlugin } from '@/main'
import { useReaderState } from '@/core/epub'
import { useLicense } from '@/composables/useLicense'

const props = defineProps<{modelValue:ReaderSettings;i18n:any;onSave:()=>Promise<void>}>()
const emit = defineEmits<{'update:modelValue':[value:ReaderSettings]}>()

// 基础状态
const settings = ref<ReaderSettings>(props.modelValue)
const activeTab = ref<'appearance'|'bookshelf'|'search'|'toc'|'bookmark'|'mark'|'deck'>('bookshelf')
const previewExpanded = ref(localStorage.getItem('sr-preview-expanded')!=='0')
const activeAccordion = ref('')
const activeSub = ref('')
const licenseRef = ref<HTMLElement>()
const plugin = usePlugin()
const {canShowToc} = useReaderState()
const {customFonts,isLoadingFonts,loadCustomFonts,resetStyles:resetStylesRaw} = useSetting(plugin)
const {interfaceItems,customThemeItems,appearanceGroups,ttsItems,ttsVoiceParams,ttsOptions} = UI_CONFIG
const {confirming:resetConfirm,handleClick:handleReset} = useConfirm(() => {resetStylesRaw();save()})

// TTS
const ttsVoices = ref<any[]>([])
const loadingTTS = ref(false)
const loadTTS = async () => {
  if (loadingTTS.value||ttsVoices.value.length) return
  loadingTTS.value = true
  try {
    const {loadOnlineVoices,loadLocalVoices} = await import('@/services/TTSEngine')
    const [local,online] = await Promise.allSettled([loadLocalVoices(),loadOnlineVoices()])
    ttsVoices.value = [...(local.status==='fulfilled'?local.value:[]),...(online.status==='fulfilled'?online.value:[])]
    if (!ttsVoices.value.length) showMessage(props.i18n.loadVoicesFailed||'加载失败',3000,'error')
  } catch (e:any) {
    showMessage(e.message||props.i18n.loadVoicesFailed||'加载失败',3000,'error')
  } finally {
    loadingTTS.value = false
  }
}
const selectVoice = (name:string,isLocal:boolean) => {if (!isLocal&&!can.value('tts-online')) return showUpgrade('在线语音'); if (settings.value.tts) {settings.value.tts.voice=name;save()}}
const toggleFav = (voice:any) => {
  if (!settings.value.tts) return
  const fav = settings.value.tts.favoriteVoices||[]
  const idx = fav.findIndex(v => v.name===voice.name)
  idx>=0?fav.splice(idx,1):fav.push({name:voice.name,displayName:voice.displayName,locale:voice.locale,isLocal:voice.isLocal})
  settings.value.tts.favoriteVoices = fav
  showMessage(idx>=0?(props.i18n.deleted||'已删除'):(props.i18n.ttsVoiceFavorited||'已收藏'),1500,'info')
  save()
}
const isFav = (name:string) => (settings.value.tts?.favoriteVoices||[]).some(v => v.name===name)
const myVoices = computed(() => [...ttsVoices.value.filter(v => v.isLocal),...(settings.value.tts?.favoriteVoices||[]).filter(v => !v.isLocal)])
const onlineVoices = computed(() => ttsVoices.value.filter(v => !v.isLocal))
watch(() => props.modelValue,v => settings.value=v,{immediate:true})

// 词典
const offlineDicts = ref<any[]>([])
const onlineDicts = ref<any[]>([])
const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)
const loadingDict = ref(true)
const fontsLoaded = ref(false)
const removingDict = ref<string|null>(null)
const quickDocSearch = ref('')
const quickDocResults = ref<any[]>([])
const {license,userAvatar,code:activationCode,loading:loadingLicense,activating,load:loadLicense,activate:activateLicense,clear:clearLicense,status:getLicenseStatus,can,showUpgrade} = useLicense(plugin,props.i18n)

// 方法
const toggleAccordion = (key:string) => activeAccordion.value=activeAccordion.value===key?'':key
const toggleSub = async (key:string) => {
  activeSub.value = activeSub.value===key?'':key
  if (key==='customFont'&&!fontsLoaded.value&&activeSub.value===key) {await loadCustomFonts();fontsLoaded.value=true}
  if ((key==='ttsFavorites'||key==='ttsVoices')&&activeSub.value===key&&!ttsVoices.value.length) await loadTTS()
}
const handleUpload = async (e:Event) => {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length) return
  uploading.value = true
  try {
    await offlineDictManager.addDict(files)
    offlineDicts.value = offlineDictManager.getDicts()
    showMessage(`${props.i18n.addedDict||'添加'} ${files.length} ${props.i18n.dictFiles||'个词典文件'}`,2000,'info')
  } catch (e:any) {
    showMessage(e.message||props.i18n.addFailed||'添加失败',3000,'error')
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}
const removeDict = async (id:string) => {await offlineDictManager.removeDict(id);offlineDicts.value=offlineDictManager.getDicts();removingDict.value=null;showMessage(props.i18n.deleted||'已删除',1500,'info')}
const toggleDict = async (manager:any,ref:any,id:string) => {await manager.toggleDict(id);ref.value=manager.getDicts()}
const searchQuickDocs=async()=>{const k=quickDocSearch.value.trim();if(!k){quickDocResults.value=[];return};const{searchDocs}=await import('@/composables/useSetting');quickDocResults.value=(await searchDocs(k)).slice(0,10)}
const addQuickDoc=(doc:any)=>{const id=doc.path?.split('/').pop()?.replace('.sy','')||doc.id;const name=doc.hPath||doc.content||'无标题';if(!settings.value.quickSendDocs)settings.value.quickSendDocs=[];if(settings.value.quickSendDocs.some(d=>d.id===id))return showMessage('已存在',2000,'error');settings.value.quickSendDocs.push({id,name});quickDocSearch.value='';quickDocResults.value=[];save()}
const removeQuickDoc=(i:number)=>{settings.value.quickSendDocs.splice(i,1);save()}
// 拖拽
let dragFrom=-1
const dragStart=(e:DragEvent,i:number)=>{dragFrom=i;(e.target as HTMLElement).style.opacity='0.4'}
const dragEnd=(e:DragEvent)=>{(e.target as HTMLElement).style.opacity='1';dragFrom=-1}
const dragOver=(e:DragEvent)=>e.preventDefault()
const dragDrop=async(e:DragEvent,to:number,type:'nav'|'dict'|'quickDoc',ref?:any,mgr?:any)=>{
  e.preventDefault()
  if(dragFrom===-1||dragFrom===to)return
  if(type==='nav'){const arr=[...navItems.value];arr.splice(to,0,...arr.splice(dragFrom,1));arr.forEach((v,i)=>v.order=i);settings.value.navItems=arr;save()}
  else if(type==='quickDoc'){const arr=[...settings.value.quickSendDocs];arr.splice(to,0,...arr.splice(dragFrom,1));settings.value.quickSendDocs=arr;save()}
  else{const arr=[...ref.value];arr.splice(to,0,...arr.splice(dragFrom,1));await mgr.sortDicts(arr.map((d:any)=>d.id));ref.value=arr}
}
const ttsI18nKey = (key:string,suffix='') => `tts${key.charAt(0).toUpperCase()}${key.slice(1)}${suffix}`

// 计算属性
const tooltipDir = computed(() => ({'left':'e','right':'w','top':'s','bottom':'n'}[settings.value.navPosition]||'n'))
const navItems = computed(() => (settings.value.navItems || [
  {id:'bookshelf',icon:'lucide-library-big',tip:'bookshelf',enabled:true,order:0},
  {id:'search',icon:'lucide-book-search',tip:'search',enabled:true,order:1},
  {id:'deck',icon:'lucide-wallet-cards',tip:'卡包',enabled:true,order:2},
  {id:'toc',icon:'lucide-scroll-text',tip:'目录',enabled:true,order:3},
  {id:'bookmark',icon:'lucide-bookmark-check',tip:'书签',enabled:true,order:4},
  {id:'mark',icon:'lucide-square-pen',tip:'标注',enabled:true,order:5},
  {id:'appearance',icon:'lucide-settings-2',tip:'设置',enabled:true,order:7}
]).filter(item => item.id !== 'dictionary').sort((a,b) => a.order - b.order))
const tabs = computed(() => navItems.value.filter(item => item.enabled && (item.id === 'appearance' || item.id === 'bookshelf' || item.id === 'search' || item.id === 'deck' || canShowToc.value)).map(item => ({id:item.id as any,icon:item.icon,tip:item.tip})))
// 预览样式
const previewStyle = computed(() => {
  const theme = settings.value.theme === 'custom' ? settings.value.customTheme : PRESET_THEMES[settings.value.theme]
  if (!theme) return {}
  const {textSettings:t,paragraphSettings:p,layoutSettings:l,visualSettings:v,viewMode} = settings.value
  const filters = [v.brightness!==1&&`brightness(${v.brightness})`,v.contrast!==1&&`contrast(${v.contrast})`,v.sepia>0&&`sepia(${v.sepia})`,v.saturate!==1&&`saturate(${v.saturate})`,v.invert&&'invert(1) hue-rotate(180deg)'].filter(Boolean).join(' ')
  const fontFamily = t.fontFamily==='custom'&&t.customFont.fontFamily?`"${t.customFont.fontFamily}", sans-serif`:t.fontFamily||'inherit'
  return {color:theme.color,backgroundColor:theme.bgImg?'transparent':theme.bg,backgroundImage:theme.bgImg?`url("${theme.bgImg}")`:'none',backgroundSize:'cover',backgroundPosition:'center',fontFamily,fontSize:`${t.fontSize}px`,letterSpacing:`${t.letterSpacing}em`,lineHeight:p.lineHeight,filter:filters||'none','--paragraph-spacing':p.paragraphSpacing,'--text-indent':p.textIndent,'--margin-h':`${l.marginHorizontal}px`,'--margin-v':`${l.marginVertical}px`,'--gap':`${l.gap}%`,'--header-footer':`${l.headerFooterMargin}px`,'--max-block':l.maxBlockSize>0?`${l.maxBlockSize}px`:'none','--column-count':viewMode==='double'?2:1}
})

// 保存
const save = async () => (emit('update:modelValue',settings.value),await props.onSave())
const debouncedSave = (() => {let t:any;return () => (clearTimeout(t),t=setTimeout(save,300))})()
const setFont = (f?:FontFileInfo) => (settings.value.textSettings.fontFamily=f?'custom':'inherit',settings.value.textSettings.customFont=f?{fontFamily:f.displayName,fontFile:f.name}:{fontFamily:'',fontFile:''},f?debouncedSave():save())
const saveTheme = () => {if(!can.value('reader-theme')){settings.value.theme='default';showUpgrade('主题配色');return}save()}
const handleReadOnline = async (book:any) => {const {openOrActivateBook} = await import('@/utils/bookOpen');openOrActivateBook(plugin,book,settings.value)}
const togglePreview = () => (previewExpanded.value=!previewExpanded.value,localStorage.setItem('sr-preview-expanded',previewExpanded.value?'1':'0'))
const openPurchasePage = () => window.open('https://pay.ldxp.cn/shop/J7MJJ8YR/lillyt','_blank')
const openMembershipInfo = () => window.open('https://github.com/mm-o/siyuan-sireader','_blank')

// 打开授权面板
;(window as any)._openLicense = () => {
  activeTab.value = 'appearance'
  activeAccordion.value = 'license'
  setTimeout(() => {
    licenseRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    licenseRef.value?.classList.add('license-highlight')
    setTimeout(() => licenseRef.value?.classList.remove('license-highlight'), 2000)
  }, 50)
}

// 生命周期
onMounted(() => {
  bookshelfManager.init()
  loadingDict.value = true
  offlineDictManager.init(plugin).then(() => {offlineDicts.value=offlineDictManager.getDicts();onlineDicts.value=onlineDictManager.getDicts()}).finally(() => loadingDict.value=false)
  loadLicense()
})
watch(canShowToc,(show) => !show&&['toc','bookmark','mark'].includes(activeTab.value)&&(activeTab.value='bookshelf'))
</script>

<template>
  <div class="sr-settings" :class="`nav-${settings.navPosition}`">
    <nav class="sr-nav">
      <button v-for="tab in tabs" :key="tab.id" class="sr-nav-tab b3-tooltips" :class="[{'sr-nav-tab--active':activeTab===tab.id},`b3-tooltips__${tooltipDir}`]" :aria-label="i18n?.[tab.tip]||tab.tip" @click="activeTab=tab.id"><svg><use :xlink:href="'#'+tab.icon"/></svg></button>
    </nav>
    <main class="sr-content">
      <div v-if="activeTab==='appearance'" class="sr-preview" :class="{expanded:previewExpanded}" :style="previewStyle">
        <div class="sr-preview-hf" @click="togglePreview"><span>{{i18n.livePreview||'实时预览'}}</span><svg class="sr-preview-toggle"><use :xlink:href="previewExpanded?'#iconContract':'#iconExpand'"/></svg></div>
        <Transition name="expand"><div v-show="previewExpanded" class="sr-preview-body"><p>春江潮水连海平，海上明月共潮生。</p><p>滟滟随波千万里，何处春江无月明。</p></div></Transition>
        <div v-if="previewExpanded" class="sr-preview-hf">{{settings.viewMode==='double'?'双页':settings.viewMode==='scroll'?'连续滚动':'单页'}}</div>
              </div>
      <Transition name="slide" mode="out-in">
        <div v-if="activeTab==='appearance'" :key="activeTab" class="sr-section">
          <div ref="licenseRef" class="ds-card ds-accordion" data-name="license" @click="toggleAccordion('license')">
            <h3>
              <div v-if="license" class="license-avatar">
                <img v-if="userAvatar" :src="userAvatar" :alt="license.userName">
                <div v-else class="license-placeholder">{{license.userName[0].toUpperCase()}}</div>
                <svg class="license-badge" viewBox="0 0 1024 1024"><use :xlink:href="license.type==='lifetime'?'#iconLicenseLifetime':license.type==='annual'?'#iconLicenseAnnual':license.type==='monthly'?'#iconLicenseMonthly':'#iconLicenseTrial'"/></svg>
              </div>
              <div v-if="license" class="license-info">
                <div>{{license.userName}}<span class="license-tag" :class="`license-${license.type}`">{{i18n[license.type==='lifetime'?'lifetimeVersion':license.type==='annual'?'annualVersion':license.type==='monthly'?'monthlyVersion':'trialVersion']}}</span></div>
                <div>ID {{license.userId}}</div>
                <div><template v-if="license.type!=='lifetime'">{{i18n.remaining||'剩余'}}{{license.daysRemaining}}{{i18n.days||'天'}} · </template>{{i18n.activatedAt||'激活于'}} {{new Date(license.activatedAt).toLocaleDateString()}}</div>
              </div>
              <span v-else>{{i18n.membership||'会员订阅'}}<svg class="ds-help-icon" viewBox="0 0 24 24" @click.stop="openMembershipInfo"><use xlink:href="#iconHelp"/></svg></span>
              <svg class="ds-arrow" :class="{expanded:activeAccordion==='license'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
            </h3>
            <Transition name="expand">
              <div v-if="activeAccordion==='license'" @click.stop>
                <div v-if="loadingLicense" class="sr-empty">{{i18n.loading||'加载中'}}...</div>
                <button v-else-if="license" class="b3-button b3-button--text license-btn" @click="clearLicense">{{i18n.logout||'退出登录'}}</button>
                <div v-else class="license-input-group">
                  <input v-model="activationCode" type="text" class="b3-text-field" :placeholder="i18n.enterActivationCode||'请输入激活码'" :disabled="activating">
                  <button class="b3-button b3-button--outline" :disabled="activating||!activationCode.trim()" @click="activateLicense">{{activating?(i18n.activating||'激活中'):(i18n.activate||'激活')}}</button>
                  <button class="b3-button b3-button--primary" @click="openPurchasePage">{{i18n.purchase||'购买'}}</button>
                </div>
              </div>
            </Transition>
          </div>
          <div class="ds-card ds-accordion" @click="toggleAccordion('interface')">
            <h3>{{i18n.interfaceLayout||'界面布局'}}<svg class="ds-arrow" :class="{expanded:activeAccordion==='interface'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></h3>
                        <Transition name="expand">
              <div v-if="activeAccordion==='interface'" @click.stop>
                <div v-for="item in interfaceItems" :key="item.key" class="ds-field" :class="{switch:item.type==='checkbox',select:item.opts}">
                  <label>{{i18n[item.key]||item.key}}</label>
                  <select v-if="item.opts" v-model="settings[item.key]" class="b3-select" @change="save"><option v-for="opt in item.opts" :key="opt" :value="opt">{{i18n[opt]||opt}}</option></select>
                  <div v-else-if="item.type==='range'" class="ds-range"><input v-model.number="settings[item.key]" type="range" class="b3-slider" :min="item.min" :max="item.max" :step="item.step" @input="debouncedSave"><span>{{settings[item.key]}}{{item.unit}}</span></div>
                  <input v-else-if="item.type==='checkbox'" v-model="settings[item.key]" type="checkbox" class="b3-switch" @change="save">
                  <small v-if="i18n[item.key+'Desc']">{{i18n[item.key+'Desc']}}</small>
                </div>
                <div class="ds-divider"></div>
                <div class="ds-sub-accordion" @click.stop="toggleSub('navItems')">
                  <div class="ds-sub-title">{{i18n.navConfig||'导航栏配置'}}<svg class="ds-arrow" :class="{expanded:activeSub==='navItems'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></div>
                  <Transition name="expand">
                    <div v-if="activeSub==='navItems'" class="ds-list">
                      <div v-for="(item,idx) in navItems" :key="item.id" class="ds-list-item" draggable="true" @dragstart="dragStart($event,idx)" @dragend="dragEnd" @dragover="dragOver" @drop="dragDrop($event,idx,'nav')">
                        <svg class="ds-list-handle" viewBox="0 0 24 24"><path d="M9 3h2v2H9V3m4 0h2v2h-2V3M9 7h2v2H9V7m4 0h2v2h-2V7m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2Z"/></svg>
                        <div class="ds-list-label"><div>{{i18n[item.tip]||item.tip}}</div></div>
                        <input v-model="item.enabled" type="checkbox" class="b3-switch" :disabled="item.id==='appearance'" @change="save">
                      </div>
                    </div>
                  </Transition>
                </div>
              </div>
            </Transition>
          </div>
          <div class="ds-card ds-accordion" @click="toggleAccordion('theme')">
            <h3>{{i18n.readingTheme||'阅读主题'}}<svg class="ds-arrow" :class="{expanded:activeAccordion==='theme'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></h3>          
            <Transition name="expand">
              <div v-if="activeAccordion==='theme'" @click.stop>
                <div class="ds-field select">
                  <label>{{i18n.presetTheme||'预设主题'}}</label>
                  <select v-model="settings.theme" class="b3-select" @change="saveTheme">
                    <option v-for="(theme,key) in PRESET_THEMES" :key="key" :value="key">{{i18n[theme.name]||theme.name}}</option>
                    <option value="custom">{{i18n.custom||'自定义'}}</option>
                  </select>
                  <small>{{i18n.presetThemeDesc}}</small>
                </div>
                <Transition name="expand">
                  <div v-if="settings.theme==='custom'">
                    <div class="ds-divider"></div>
                    <div v-for="item in customThemeItems" :key="item.key" class="ds-field">
                      <label>{{i18n[item.label]}}</label>
                      <input v-model="settings.customTheme[item.key]" :type="item.type" :class="item.type==='color'?'ds-color':'b3-text-field'" @change="can('reader-theme')?save():showUpgrade('主题配色')">
                    </div>
                  </div>
                </Transition>
              </div>
            </Transition>
          </div>
          <div v-for="group in appearanceGroups" :key="group.title" class="ds-card ds-accordion" @click="toggleAccordion(group.title)">
            <h3>{{i18n[group.title]}}<svg class="ds-arrow" :class="{expanded:activeAccordion===group.title}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></h3>
            <Transition name="expand">
              <div v-if="activeAccordion===group.title" @click.stop>
                <div v-for="item in group.items" :key="item.key" class="ds-field" :class="{switch:item.type==='checkbox',select:item.type==='select'}">
                  <label>{{i18n[item.key]}}</label>
                  <select v-if="item.type==='select'" v-model="settings[group.title][item.key]" class="b3-select" @change="debouncedSave"><option v-for="(opt,idx) in item.opts" :key="opt" :value="opt">{{i18n[item.labels[idx]]}}</option></select>
                  <div v-else-if="item.type==='range'" class="ds-range"><input v-model.number="settings[group.title][item.key]" type="range" class="b3-slider" :min="item.min" :max="item.max" :step="item.step" @input="debouncedSave"><span>{{settings[group.title][item.key]}}{{item.unit||''}}</span></div>
                  <input v-else-if="item.type==='checkbox'" v-model="settings[group.title][item.key]" type="checkbox" class="b3-switch" @change="save">
                </div>
                <template v-if="group.title==='textSettings'">
                  <div class="ds-divider"></div>
                  <div class="ds-sub-accordion" @click.stop="toggleSub('customFont')">
                    <div class="ds-sub-title">{{i18n.customFont||'自定义字体'}}<svg class="ds-arrow" :class="{expanded:activeSub==='customFont'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></div>
                    <Transition name="expand">
                      <div v-if="activeSub==='customFont'">
                        <small class="ds-hint"><code>data/plugins/custom-fonts/</code> <button class="ds-link-btn" @click.stop="loadCustomFonts(true)" :disabled="isLoadingFonts">{{i18n.fontTip||'刷新'}}</button></small>
                        <div v-if="isLoadingFonts" class="sr-empty">{{i18n.loadingFonts}}</div>
                        <div v-else-if="customFonts.length" class="ds-list ds-list-scroll">
                          <div v-for="f in customFonts" :key="f.name" class="ds-list-item ds-list-item-simple" :class="{active:settings.textSettings.customFont.fontFile===f.name}" @click.stop="setFont(f)">
                            <div class="ds-list-label" :style="{fontFamily:f.displayName}">
                              <div>{{f.displayName}}</div>
                              <small>{{f.name}}</small>
                            </div>
                            <button v-if="settings.textSettings.customFont.fontFile===f.name" @click.stop="setFont()" class="ds-list-btn ds-list-btn-del">×</button>
                          </div>
                        </div>
                        <div v-else class="sr-empty">{{i18n.noCustomFonts}}</div>
                      </div>
                    </Transition>
                  </div>
                </template>
              </div>
            </Transition>
          </div>
          <div class="ds-card ds-accordion" @click="toggleAccordion('dictionary')">
            <h3>{{i18n.dictionaryTools||'词典工具'}}<svg class="ds-arrow" :class="{expanded:activeAccordion==='dictionary'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></h3>
            <Transition name="expand">
              <div v-if="activeAccordion==='dictionary'" @click.stop>
                <div v-if="loadingDict" class="sr-empty">{{i18n.loading||'加载中...'}}</div>
                <template v-else>
                  <div class="ds-sub-accordion" @click.stop="toggleSub('offlineDict')">
                    <div class="ds-sub-title">{{i18n.offlineDict||'离线词典'}}<svg class="ds-arrow" :class="{expanded:activeSub==='offlineDict'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></div>
                    <Transition name="expand">
                      <div v-if="activeSub==='offlineDict'">
                        <input ref="fileInput" type="file" multiple accept=".ifo,.idx,.dz,.index,.syn" style="display:none" @change="handleUpload">
                        <button class="ds-btn-add" :disabled="uploading" @click.stop="can('dict-offline')?fileInput?.click():showUpgrade('离线词典')"><svg><use xlink:href="#iconUpload"/></svg>{{uploading?(i18n.uploading||'上传中...'):(i18n.addDict||'添加词典')}}</button>
                        <small class="ds-hint">{{i18n.dictFormatHint||'支持 StarDict 和 dictd 格式'}} <a href="https://github.com/mm-o/siyuan-sireader/blob/main/docs/离线词典使用说明.md" target="_blank">{{i18n.downloadDict||'下载词典'}}</a></small>
                        <div v-if="offlineDicts.length" class="ds-list">
                          <div v-for="(d,idx) in offlineDicts" :key="d.id" class="ds-list-item" draggable="true" @dragstart="dragStart($event,idx)" @dragend="dragEnd" @dragover="dragOver" @drop="dragDrop($event,idx,'dict',offlineDicts,offlineDictManager)">
                            <svg class="ds-list-handle" viewBox="0 0 24 24"><path d="M9 3h2v2H9V3m4 0h2v2h-2V3M9 7h2v2H9V7m4 0h2v2h-2V7m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2Z"/></svg>
                            <div class="ds-list-label"><div>{{d.name}}</div><small>{{d.type==='stardict'?'StarDict':'dictd'}}</small></div>
                            <Transition name="fade"><div v-if="removingDict===d.id" class="sr-confirm" @click.stop><button @click="removingDict=null">{{i18n.cancel||'取消'}}</button><button @click="removeDict(d.id)" class="btn-delete">{{i18n.delete||'删除'}}</button></div></Transition>
                            <div v-if="removingDict!==d.id" class="ds-list-btns">
                              <input type="checkbox" :checked="d.enabled" class="b3-switch" @change="toggleDict(offlineDictManager,offlineDicts,d.id)">
                              <button @click.stop="removingDict=d.id" class="ds-list-btn ds-list-btn-del">×</button>
                            </div>
                          </div>
                        </div>
                        <div v-else class="sr-empty">{{i18n.noDicts||'暂无离线词典'}}</div>
                      </div>
                    </Transition>
                  </div>
                  <div class="ds-divider"></div>
                  <div class="ds-sub-accordion" @click.stop="toggleSub('onlineDict')">
                    <div class="ds-sub-title">{{i18n.onlineDict||'在线词典'}}<svg class="ds-arrow" :class="{expanded:activeSub==='onlineDict'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></div>
                    <Transition name="expand">
                      <div v-if="activeSub==='onlineDict'" class="ds-list">
                        <div v-for="(d,idx) in onlineDicts" :key="d.id" class="ds-list-item" draggable="true" @dragstart="dragStart($event,idx)" @dragend="dragEnd" @dragover="dragOver" @drop="dragDrop($event,idx,'dict',onlineDicts,onlineDictManager)">
                          <svg class="ds-list-handle" viewBox="0 0 24 24"><path d="M9 3h2v2H9V3m4 0h2v2h-2V3M9 7h2v2H9V7m4 0h2v2h-2V7m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2Z"/></svg>
                          <div class="ds-list-label"><div>{{d.name}}</div><small>{{d.desc}}</small></div>
                          <input type="checkbox" :checked="d.enabled" class="b3-switch" @change="toggleDict(onlineDictManager,onlineDicts,d.id)">
                        </div>
                      </div>
                    </Transition>
                  </div>
                </template>
              </div>
            </Transition>
          </div>
          <div class="ds-card ds-accordion" @click="toggleAccordion('other')">
            <h3>{{i18n.otherSettings||'其他设置'}}<svg class="ds-arrow" :class="{expanded:activeAccordion==='other'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></h3>
            <Transition name="expand">
              <div v-if="activeAccordion==='other'" @click.stop>
                <div class="ds-field">
                  <label>{{i18n.linkFormat||'链接格式'}}</label>
                  <textarea v-model="settings.linkFormat" class="b3-text-field" rows="4" @input="debouncedSave"/>
                  <small>{{i18n?.linkFormatDesc||'可用变量：书名 作者 章节 位置 链接 文本 笔记 截图'}}</small>
                </div>
                <div class="ds-field">
                  <label>{{i18n.quickSendDocs||'快捷发送文档'}}</label>
                  <div v-if="settings.quickSendDocs?.length" class="ds-list">
                    <div v-for="(doc,i) in settings.quickSendDocs" :key="doc.id" class="ds-list-item" draggable="true" @dragstart="dragStart($event,i)" @dragend="dragEnd" @dragover="dragOver" @drop="dragDrop($event,i,'quickDoc')">
                      <svg class="ds-list-handle" viewBox="0 0 24 24"><path d="M9 3h2v2H9V3m4 0h2v2h-2V3M9 7h2v2H9V7m4 0h2v2h-2V7m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2Z"/></svg>
                      <div class="ds-list-label"><div>{{doc.name}}</div></div>
                      <button @click="removeQuickDoc(i)" class="ds-list-btn ds-list-btn-del">×</button>
                    </div>
                  </div>
                  <div style="position:relative;margin-top:8px">
                    <input v-model="quickDocSearch" @input="searchQuickDocs" :placeholder="i18n?.searchDocPlaceholder||'搜索文档...'" class="b3-text-field"/>
                    <div v-if="quickDocResults.length" style="position:absolute;top:100%;left:0;right:0;margin-top:4px;max-height:200px;overflow-y:auto;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.1);z-index:10">
                      <button v-for="doc in quickDocResults" :key="doc.id" @click="addQuickDoc(doc)" style="width:100%;padding:8px;border:none;background:transparent;text-align:left;cursor:pointer;font-size:12px;transition:background .15s;border-bottom:1px solid var(--b3-border-color)" @mouseenter="$event.target.style.background='var(--b3-list-hover)'" @mouseleave="$event.target.style.background='transparent'">{{doc.hPath||doc.content||'无标题'}}</button>
                    </div>
                  </div>
                  <small>{{i18n?.quickSendDocsDesc||'用于快速发送标注'}}</small>
                </div>
              </div>
            </Transition>
          </div>
          <div class="ds-card ds-accordion" @click="toggleAccordion('tts')">
            <h3>{{i18n.ttsSettings||'语音朗读'}}<svg class="ds-arrow" :class="{expanded:activeAccordion==='tts'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></h3>
            <Transition name="expand">
              <div v-if="activeAccordion==='tts'" @click.stop>
                <template v-if="settings.tts">
                  <div v-for="item in ttsItems" :key="item.key" class="ds-field" :class="{switch:item.type==='checkbox'}">
                    <label>{{i18n[ttsI18nKey(item.key)]||item.key}}</label>
                    <div v-if="item.type==='range'" class="ds-range"><input v-model.number="settings.tts[item.key]" type="range" class="b3-slider" :min="item.min" :max="item.max" :step="item.step" @input="debouncedSave"><span>{{settings.tts[item.key]}}{{item.unit}}</span></div>
                    <input v-else-if="item.type==='checkbox'" v-model="settings.tts[item.key]" type="checkbox" class="b3-switch" @change="save">
                  </div>
                  <div class="ds-divider"></div>
                  <div v-for="(item,idx) in ttsOptions" :key="item.key" class="ds-field switch">
                    <label>{{i18n[ttsI18nKey(item.key)]||item.key}}</label>
                    <input v-model="settings.tts[item.key]" type="checkbox" class="b3-switch" @change="save">
                    <small v-if="i18n[ttsI18nKey(item.key,'Desc')]">{{i18n[ttsI18nKey(item.key,'Desc')]}}</small>
                  </div>
                  <div class="ds-divider"></div>
                  <div class="ds-sub-accordion" @click.stop="toggleSub('ttsFavorites')">
                    <div class="ds-sub-title">{{i18n.ttsFavoriteVoices||'我的语音'}}<svg class="ds-arrow" :class="{expanded:activeSub==='ttsFavorites'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></div>
                    <Transition name="expand">
                      <div v-if="activeSub==='ttsFavorites'">
                        <small class="ds-hint">{{i18n.ttsCurrentVoice||'当前'}}: {{settings.tts.voice}}</small>
                        <div v-if="myVoices.length" class="ds-list ds-list-scroll">
                          <div v-for="v in myVoices" :key="v.name" class="ds-list-item ds-list-item-simple" :class="{active:settings.tts.voice===v.name}" @click.stop="selectVoice(v.name,v.isLocal)">
                            <div class="ds-list-label">
                              <div>{{v.displayName}}</div>
                              <small>{{v.isLocal?'🎤 本地':v.locale}}</small>
                            </div>
                            <button v-if="!v.isLocal" @click.stop="toggleFav(v)" class="ds-list-btn ds-list-btn-del">×</button>
                          </div>
                        </div>
                        <div v-else class="sr-empty">{{i18n.ttsNoFavorites||'暂无，请点击下方加载'}}</div>
                      </div>
                    </Transition>
                  </div>
                  <div class="ds-divider"></div>
                  <div class="ds-sub-accordion" @click.stop="toggleSub('ttsVoices')">
                    <div class="ds-sub-title">{{i18n.ttsVoiceList||'在线语音'}}<svg class="ds-arrow" :class="{expanded:activeSub==='ttsVoices'}" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg></div>
                    <Transition name="expand">
                      <div v-if="activeSub==='ttsVoices'">
                        <button class="ds-btn-add" :disabled="loadingTTS" @click.stop="loadTTS"><svg><use xlink:href="#iconRefresh"/></svg>{{loadingTTS?(i18n.loading||'加载中...'):(i18n.ttsLoadVoices||'加载语音列表')}}</button>
                        <small class="ds-hint">{{i18n.ttsOnlineHint||'点击语音名称选择，点击星号收藏'}}</small>
                        <div v-if="loadingTTS" class="sr-empty">{{i18n.loading||'加载中...'}}</div>
                        <div v-else-if="onlineVoices.length" class="ds-list ds-list-scroll">
                          <div v-for="v in onlineVoices" :key="v.name" class="ds-list-item ds-list-item-simple" :class="{active:settings.tts.voice===v.name}" @click.stop="selectVoice(v.name,false)">
                            <div class="ds-list-label">
                              <div>{{v.displayName}}</div>
                              <small>{{v.locale}}</small>
                            </div>
                            <button @click.stop="toggleFav(v)" class="ds-list-btn" :title="isFav(v.name)?'取消收藏':'收藏'">{{isFav(v.name)?'★':'☆'}}</button>
                          </div>
                        </div>
                        <div v-else class="sr-empty">{{i18n.ttsNoVoices||'暂无语音'}}</div>
                      </div>
                    </Transition>
                  </div>
                </template>
                <div v-else class="sr-empty">{{i18n.ttsNotConfigured||'TTS 未配置'}}</div>
              </div>
            </Transition>
          </div>
          <Transition name="fade" mode="out-in">
            <div v-if="resetConfirm" key="confirm" class="ds-reset-group">
              <button @click="resetConfirm=false">{{i18n.cancel||'取消'}}</button>
              <button class="ds-reset-confirm" @click="handleReset">{{i18n.confirm||'确认重置'}}</button>
            </div>
            <button v-else key="reset" class="ds-reset" @click="handleReset">{{i18n.resetDefault||'重置为默认'}}</button>
          </Transition>
        </div>
        <!-- 外部组件，不使用 Transition -->
      </Transition>
      <BookSearch v-show="activeTab==='search'" :i18n="i18n" @read="handleReadOnline"/>
      <BookShelf v-show="activeTab==='bookshelf'" :i18n="i18n" :cover-size="settings.bookshelfCoverSize" :open-doc-assets="settings.openDocAssets" @read="handleReadOnline"/>
      <ReaderToc v-if="['toc','bookmark','mark','deck'].includes(activeTab)" v-model:mode="activeTab" :i18n="props.i18n"/>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use './deck/deck.scss';
.sr-settings{display:flex;height:100%;background:var(--b3-theme-background);&.nav-left{flex-direction:row}&.nav-right{flex-direction:row-reverse}&.nav-top{flex-direction:column}&.nav-bottom{flex-direction:column-reverse}}
.sr-nav{background:var(--b3-theme-background);display:flex;flex-shrink:0;.nav-left &,.nav-right &{width:42px;flex-direction:column;border-right:1px solid var(--b3-theme-background-light);padding:8px 0}.nav-top &,.nav-bottom &{height:42px;border-bottom:1px solid var(--b3-theme-background-light);padding:0 8px}.nav-right &{border-right:0;border-left:1px solid var(--b3-theme-background-light)}.nav-bottom &{border-bottom:0;border-top:1px solid var(--b3-theme-background-light)}}
.sr-nav-tab{display:flex;align-items:center;justify-content:center;padding:10px 8px;border:none;background:transparent;cursor:pointer;transition:var(--b3-transition);color:var(--b3-theme-on-surface);svg{width:16px;height:16px}&:hover{color:var(--b3-theme-on-background)}&--active{color:var(--b3-theme-primary)}}
.sr-content{flex:1;overflow:hidden;display:flex;flex-direction:column}
.ds-card{background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:8px;padding:16px;transition:all .2s;&:hover{box-shadow:0 2px 8px rgba(0,0,0,.08)}&.ds-accordion{cursor:pointer;user-select:none;h3{margin:0;font-size:14px;font-weight:600;display:flex;align-items:center;gap:16px;transition:color .15s}}}
.license-avatar{position:relative;width:56px;height:56px;flex-shrink:0;img{width:100%;height:100%;border-radius:50%;object-fit:cover}}
.license-placeholder{width:100%;height:100%;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:600}
.license-badge{position:absolute;bottom:-2px;right:-2px;width:24px;height:24px}
.license-info{flex:1;min-width:0;>div{line-height:1.5;margin-bottom:2px;&:first-child{font-size:16px;font-weight:600}&:not(:first-child){font-size:12px;color:var(--b3-theme-on-surface-light);opacity:.85}}}
.ds-help-icon{width:16px;height:16px;margin-left:6px;opacity:.5;cursor:pointer;transition:all .15s;vertical-align:text-bottom;transform:translateY(-1px);&:hover{opacity:1;color:var(--b3-theme-primary)}}
.license-tag{font-size:11px;padding:2px 7px;border-radius:3px;font-weight:500;margin-left:6px;opacity:.9;&.license-lifetime{background:rgba(156,39,176,.1);color:#9c27b0}&.license-annual{background:rgba(76,175,80,.1);color:#4caf50}&.license-monthly{background:rgba(33,150,243,.1);color:#2196f3}&.license-trial{background:rgba(255,152,0,.1);color:#ff9800}}
.license-btn{width:100%;margin-top:8px}
.license-input-group{display:flex;gap:8px;margin-top:8px;input{flex:1;min-width:0}button{flex-shrink:0;white-space:nowrap}}
.sr-preview{position:sticky;top:0;z-index:10;margin:20px 20px 0;background:var(--b3-theme-surface);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;transition:max-height .3s;column-count:var(--column-count,1);column-gap:var(--gap);max-height:50px;&.expanded{max-height:min(300px,var(--max-block))}p{margin:0;padding:var(--margin-v) var(--margin-h);text-indent:calc(1em * var(--text-indent,0));break-inside:avoid;& + p{margin-top:calc(1em * var(--paragraph-spacing,0.8))}}}
.sr-preview-hf{height:50px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-size:12px;opacity:.6;border:1px dashed currentColor;border-width:1px 0 0;user-select:none;&:first-child{border-width:0 0 1px;font-weight:500}&:hover{opacity:.8;background:var(--b3-list-hover)}}
.sr-preview-toggle{width:14px;height:14px;transition:transform .3s}
.sr-preview-body{flex:1;overflow:auto;min-height:0}
.ds-color{width:55px;height:34px;padding:3px;border-radius:4px;cursor:pointer;border:1px solid var(--b3-border-color)}
.ds-divider{height:1px;background:var(--b3-border-color);margin:16px 0}
.ds-sub-accordion{cursor:pointer;user-select:none;margin-top:8px;&:hover .ds-sub-title{color:var(--b3-theme-primary)}}
.ds-sub-title{font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:space-between;padding:8px 0;transition:color .15s;svg{width:16px;height:16px;fill:currentColor;opacity:.7;transition:transform .2s;flex-shrink:0}&:has(svg.expanded) svg,svg.expanded{transform:rotate(180deg)}}
.ds-hint{display:block;font-size:11px;color:var(--b3-theme-on-surface-variant);opacity:.7;margin:8px 0;line-height:1.5;a{color:var(--b3-theme-primary);text-decoration:none;&:hover{text-decoration:underline}}code{background:var(--b3-theme-background);padding:2px 6px;border-radius:3px;font-size:10px}}
.ds-link-btn{padding:2px 8px;margin-left:6px;border:1px solid var(--b3-border-color);background:transparent;color:var(--b3-theme-primary);border-radius:3px;cursor:pointer;font-size:11px;transition:all .15s;&:hover:not(:disabled){background:var(--b3-list-hover)}&:disabled{opacity:.5;cursor:not-allowed}}
.ds-btn-add{width:100%;padding:8px 12px;margin-bottom:8px;border:1px dashed var(--b3-border-color);background:transparent;color:var(--b3-theme-on-surface);border-radius:4px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s;svg{width:14px;height:14px}&:hover:not(:disabled){background:var(--b3-list-hover);border-color:var(--b3-theme-primary);color:var(--b3-theme-primary)}&:disabled{opacity:.5;cursor:not-allowed}}
.ds-list{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.ds-list-scroll{max-height:300px;overflow-y:auto;padding-right:4px;&::-webkit-scrollbar{width:6px}&::-webkit-scrollbar-track{background:var(--b3-theme-background)}&::-webkit-scrollbar-thumb{background:var(--b3-border-color);border-radius:3px;&:hover{background:var(--b3-theme-on-surface-variant)}}}
.ds-list-item{position:relative;display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--b3-theme-surface);border:1px solid var(--b3-border-color);border-radius:4px;transition:background .15s;cursor:move;&:hover{background:var(--b3-list-hover)}&.active{background:var(--b3-theme-primary-lightest);border-color:var(--b3-theme-primary)}.sr-confirm{position:absolute;right:4px;top:50%;transform:translateY(-50%)}}
.ds-list-item-simple{cursor:pointer !important}
.ds-list-handle{width:16px;height:16px;fill:var(--b3-theme-on-surface);opacity:.3;cursor:grab;flex-shrink:0;&:active{cursor:grabbing}}
.ds-list-label{flex:1;font-size:13px;min-width:0;div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}small{display:block;font-size:11px;opacity:.6;margin-top:2px}}
.ds-list-btns{display:flex;gap:4px;flex-shrink:0}
.ds-list-btn{width:24px;height:24px;padding:0;border:1px solid var(--b3-border-color);background:var(--b3-theme-surface);color:var(--b3-theme-on-surface);border-radius:4px;cursor:pointer;font-size:14px;line-height:1;transition:all .15s;&:hover{background:var(--b3-list-hover)}&:active{transform:scale(.95)}}
.ds-list-btn-del{color:var(--b3-theme-error);&:hover{background:var(--b3-theme-error);color:white;border-color:var(--b3-theme-error)}}
.license-highlight{animation:license-pulse 2s ease;box-shadow:0 0 0 4px var(--b3-theme-primary-light),0 8px 24px rgba(33,150,243,.4) !important}
@keyframes license-pulse{0%,100%{transform:scale(1);box-shadow:0 2px 8px rgba(0,0,0,.08)}10%,30%,50%{transform:scale(1.03);box-shadow:0 0 0 4px var(--b3-theme-primary-light),0 8px 24px rgba(33,150,243,.4)}20%,40%{transform:scale(1);box-shadow:0 0 0 2px var(--b3-theme-primary-lighter),0 4px 16px rgba(33,150,243,.2)}}
@media (max-width:640px){.sr-settings{flex-direction:column !important}.sr-nav{width:100% !important;height:42px !important;flex-direction:row !important;padding:0 4px !important}}
</style>
