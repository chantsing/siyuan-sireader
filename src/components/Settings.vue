
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { showMessage } from 'siyuan'
import type { ReaderSettings, FontFileInfo } from '@/composables/useSetting'
import { PRESET_THEMES, UI_CONFIG, useSetting, useConfirm, useDocSearch, useNotebooks, LINK_FORMAT_PRESETS } from '@/composables/useSetting'
import { bookshelfManager } from '@/core/bookshelf'
import { offlineDictManager, onlineDictManager } from '@/utils/dictionary'
import { usePlugin } from '@/main'
import { useLicense } from '@/composables/useLicense'
import { focusMobileEditable } from '@/utils/mobile'

const props = defineProps<{modelValue:ReaderSettings;i18n:any;onSave:()=>Promise<void>}>()
const emit = defineEmits<{'update:modelValue':[value:ReaderSettings]}>()

// 基础状态
const settings = ref<ReaderSettings>(props.modelValue),
  previewExpanded = ref(localStorage.getItem('sr-preview-expanded')!=='0'),
  activeAccordion = ref(''),
  activeSub = ref(''),
  licenseRef = ref<HTMLElement>()
const plugin = usePlugin()
const {customFonts,isLoadingFonts,loadCustomFonts,resetStyles:resetStylesRaw} = useSetting(plugin)
const {interfaceItems,customThemeItems,appearanceGroups,ttsItems,ttsOptions} = UI_CONFIG
const {confirming:resetConfirm,handleClick:handleReset} = useConfirm(() => {resetStylesRaw();save()})

// TTS
const ttsVoices = ref<any[]>([]), loadingTTS = ref(false)
const loadTTS = async () => {
  if (loadingTTS.value||ttsVoices.value.length) return
  loadingTTS.value = true
  try {
    const {loadOnlineVoices,loadLocalVoices} = await import('@/services/TTSEngine')
    const [local,online] = await Promise.allSettled([loadLocalVoices(),loadOnlineVoices()])
    ttsVoices.value = [...(local.status==='fulfilled'?local.value:[]),...(online.status==='fulfilled'?online.value:[])]
    if (!ttsVoices.value.length) showMessage(props.i18n.loadVoicesFailed||'加载失败',3000,'error')
  } catch (e:any) { showMessage(e.message||props.i18n.loadVoicesFailed||'加载失败',3000,'error') } finally { loadingTTS.value = false }
}
const selectVoice = (name:string,isLocal:boolean) => {
  if (!isLocal&&!can.value('tts-online')) return showUpgrade('在线语音')
  if (!settings.value.tts) return
  settings.value.tts.voice = name
  save()
}
const toggleFav = (voice:any) => {
  if (!settings.value.tts) return
  const fav = settings.value.tts.favoriteVoices||[]
  const idx = fav.findIndex(v => v.name===voice.name)
  idx>=0?fav.splice(idx,1):fav.push({name:voice.name,displayName:voice.displayName,locale:voice.locale,isLocal:voice.isLocal})
  settings.value.tts.favoriteVoices = fav; showMessage(idx>=0?(props.i18n.deleted||'已删除'):(props.i18n.ttsVoiceFavorited||'已收藏'),1500,'info'); save()
}
const isFav = (name:string) => (settings.value.tts?.favoriteVoices||[]).some(v => v.name===name)
const myVoices = computed(() => [...ttsVoices.value.filter(v => v.isLocal),...(settings.value.tts?.favoriteVoices||[]).filter(v => !v.isLocal)])
const onlineVoices = computed(() => ttsVoices.value.filter(v => !v.isLocal))
watch(() => props.modelValue,v => settings.value=v,{immediate:true})
// 词典与笔记插入
const offlineDicts = ref<any[]>([]),
  onlineDicts = ref<any[]>([]),
  fileInput = ref<HTMLInputElement>(),
  uploading = ref(false),
  loadingDict = ref(true),
  fontsLoaded = ref(false),
  removingDict = ref<string|null>(null)
const quickDoc = useDocSearch(), insertDoc = useDocSearch()
const {notebooks,load:loadNotebooks} = useNotebooks()
const {license,userAvatar,code:activationCode,loading:loadingLicense,processing,load:loadLicense,activate:activateLicense,recover:recoverLicense,clear:clearLicense,can,showUpgrade} = useLicense(props.i18n)
const licenseAvatarSrc = computed(() => userAvatar.value || ((globalThis as any)?.window?.siyuan?.user?.userAvatarURL || ''))
const ttsFields = computed(() => [...ttsItems, ...ttsOptions.map(item => ({ ...item, desc: ttsI18nKey(item.key,'Desc') }))])
const noteTargetOptions = ['clipboard','current','notebook','document','dailynote'] as const,
  noteModeOptions = ['insertBlock','prependBlock','appendBlock','updateBlock','prependDoc','appendDoc'] as const,
  linkFormatPresetOptions = Object.keys(LINK_FORMAT_PRESETS) as (keyof typeof LINK_FORMAT_PRESETS)[]
const noteModeLabels = { insertBlock: 'noteInsertModeCursor', prependBlock: 'noteInsertModeBefore', appendBlock: 'noteInsertModeAfter', updateBlock: 'noteInsertModeReplace', prependDoc: 'noteInsertModeDocTop', appendDoc: 'noteInsertModeDocBottom' } as const
const selectField = (key:string, label:string, value:string, options:any[], set:(value:string)=>void, show=true, empty='') => ({ key, type: 'select', label, value, options, set, show, empty })
const checkboxField = (key:string, label:string, value:boolean, set:(value:boolean)=>void, show=true, hint='') => ({ key, type: 'checkbox', label, value, set, show, hint })
const searchField = (key:string, label:string, docs:any[], input:string, results:any[], setInput:(value:string)=>void, search:()=>void, select:(doc:any)=>void, remove:(doc:any,i:number)=>void, show=true, hint='', drag?:'quickDoc') => ({ key, type: 'search', label, docs, input, results, setInput, search, select, remove, show, hint, drag })
const dictSections = computed(() => [
  {
    key: 'offlineDict', title: props.i18n.offlineDict||'离线词典', items: offlineDicts.value, empty: props.i18n.noDicts||'暂无离线词典',
    extra: true, toggle: (id:string) => toggleDict(offlineDictManager,offlineDicts,id), desc: (d:any) => d.type==='stardict'?'StarDict':'dictd', drop: (e:DragEvent,i:number) => dragDrop(e,i,'dict',offlineDicts,offlineDictManager)
  },
  {
    key: 'onlineDict', title: props.i18n.onlineDict||'在线词典', items: onlineDicts.value, empty: '', toggle: (id:string) => toggleDict(onlineDictManager,onlineDicts,id), desc: (d:any) => d.desc, drop: (e:DragEvent,i:number) => dragDrop(e,i,'dict',onlineDicts,onlineDictManager)
  }
])
const voiceSections = computed(() => [
  {
    key: 'ttsFavorites', title: props.i18n.ttsFavoriteVoices||'我的语音', hint: `${props.i18n.ttsCurrentVoice||'当前'}: ${settings.value.tts?.voice||''}`,
    items: myVoices.value, empty: props.i18n.ttsNoFavorites||'暂无，请点击下方加载', pick: (v:any) => selectVoice(v.name,v.isLocal), action: (v:any) => !v.isLocal && toggleFav(v),
    actionText: (v:any) => v.isLocal ? '' : '×', actionTitle: () => '', meta: (v:any) => v.isLocal ? '🎤 本地' : v.locale, showLoad: false
  },
  {
    key: 'ttsVoices', title: props.i18n.ttsVoiceList||'在线语音', hint: props.i18n.ttsOnlineHint||'点击语音名称选择，点击星号收藏',
    items: onlineVoices.value, empty: props.i18n.ttsNoVoices||'暂无语音', pick: (v:any) => selectVoice(v.name,false), action: (v:any) => toggleFav(v),
    actionText: (v:any) => isFav(v.name)?'★':'☆', actionTitle: (v:any) => isFav(v.name)?'取消收藏':'收藏', meta: (v:any) => v.locale, showLoad: true
  }
])
const noteFields = computed(() => [
  checkboxField('annotationSyncOnAdd', props.i18n.annotationSyncOnAdd || '添加时同步', settings.value.annotationSyncOnAdd, value => (settings.value.annotationSyncOnAdd = value, save()), true, props.i18n.annotationSyncOnAddDesc || '新增标注时自动同步到已绑定文档'),
  checkboxField('annotationSyncOnDelete', props.i18n.annotationSyncOnDelete || '删除时同步', settings.value.annotationSyncOnDelete, value => (settings.value.annotationSyncOnDelete = value, save()), true, props.i18n.annotationSyncOnDeleteDesc || '删除标注时同步删除已绑定块'),
  selectField('noteInsertTarget', props.i18n.noteInsertTarget || '插入位置', settings.value.noteInsertTarget, noteTargetOptions.map(value => ({ value, label: props.i18n[`noteInsertTarget${value.charAt(0).toUpperCase()}${value.slice(1)}`] || value })), value => (settings.value.noteInsertTarget = value as any, save())),
  selectField('noteInsertMode', props.i18n.noteInsertMode || '插入方式', settings.value.noteInsertMode, noteModeOptions.map(value => ({ value, label: props.i18n[noteModeLabels[value]] || value })), value => (settings.value.noteInsertMode = value as any, save()), settings.value.noteInsertTarget === 'current'),
  selectField('notebookId', props.i18n.notebookId || props.i18n.notebook || '笔记本', settings.value.notebookId || '', notebooks.value.map((nb:any) => ({ value: nb.id, label: nb.name })), value => (settings.value.notebookId = value, save()), ['notebook', 'dailynote'].includes(settings.value.noteInsertTarget), props.i18n.notSelected || '未选择'),
  selectField('linkFormatPreset', props.i18n.linkFormatPreset || '模板预设', '', linkFormatPresetOptions.map(value => ({ value, label: props.i18n[`linkFormatPreset${value.charAt(0).toUpperCase()}${value.slice(1)}`] || value })), applyLinkFormatPreset, true, props.i18n.selectPreset || '请选择'),
  { key: 'linkFormat', type: 'textarea', label: props.i18n.linkFormat || '链接格式', value: settings.value.linkFormat, hint: props.i18n.linkFormatDesc || '可用变量：书名 作者 章节 位置 链接 文本 笔记 截图' },
  searchField('parentDoc', props.i18n.parentDoc || '父文档', settings.value.parentDoc ? [settings.value.parentDoc] : [], insertDoc.state.value.input, insertDoc.state.value.results, value => (insertDoc.state.value.input = value, !value.trim() && (insertDoc.state.value.results = [])), insertDoc.search, doc => insertDoc.select(doc, selectInsertDoc), () => clearInsertDoc(), settings.value.noteInsertTarget === 'document'),
  searchField('quickSendDocs', props.i18n.quickSendDocs || '快捷发送文档', settings.value.quickSendDocs || [], quickDoc.state.value.input, quickDoc.state.value.results, value => (quickDoc.state.value.input = value, !value.trim() && (quickDoc.state.value.results = [])), quickDoc.search, doc => quickDoc.select(doc, addQuickDoc), (_doc:any, i:number) => removeQuickDoc(i), true, props.i18n.quickSendDocsDesc || '用于快速发送标注', 'quickDoc')
].filter((item:any) => item.show !== false))

// 交互方法
const toggleAccordion = (key:string) => activeAccordion.value = activeAccordion.value === key ? '' : key
const toggleSub = async (key:string) => {
  activeSub.value = activeSub.value === key ? '' : key
  if (key === 'customFont' && !fontsLoaded.value && activeSub.value === key) return await loadCustomFonts(), void (fontsLoaded.value = true)
  if (['ttsFavorites','ttsVoices'].includes(key) && activeSub.value === key && !ttsVoices.value.length) await loadTTS()
}
watch(activeAccordion, key => key === 'other' && loadNotebooks())
const handleUpload = async (e:Event) => {
  const files = (e.target as HTMLInputElement).files
  if (!files?.length) return
  uploading.value = true
  try {
    await offlineDictManager.addDict(files)
    offlineDicts.value = offlineDictManager.getDicts()
    showMessage(`${props.i18n.addedDict || '添加'} ${files.length} ${props.i18n.dictFiles || '个词典文件'}`, 2000, 'info')
  } catch (e:any) { showMessage(e.message || props.i18n.addFailed || '添加失败', 3000, 'error') } finally { uploading.value = false; if (fileInput.value) fileInput.value.value = '' }
}
const removeDict = async (id:string) => {
  await offlineDictManager.removeDict(id)
  offlineDicts.value = offlineDictManager.getDicts()
  removingDict.value = null
  showMessage(props.i18n.deleted || '已删除', 1500, 'info')
}
const toggleDict = async (manager:any, ref:any, id:string) => { await manager.toggleDict(id); ref.value = manager.getDicts() }
const addQuickDoc = (doc:any) => {
  if (!settings.value.quickSendDocs) settings.value.quickSendDocs = []
  if (settings.value.quickSendDocs.some(d => d.id === doc.id)) return showMessage(props.i18n.alreadyExists || '已存在', 2000, 'error')
  settings.value.quickSendDocs.push(doc)
  save()
}
const removeQuickDoc = (i:number) => { settings.value.quickSendDocs.splice(i, 1); save() }
const selectInsertDoc = (doc:any) => { settings.value.parentDoc = doc; settings.value.notebookId = doc.notebook; save() }
const clearInsertDoc = () => { settings.value.parentDoc = undefined; insertDoc.reset(); save() }
const applyLinkFormatPreset = (preset:string) => {
  const format = LINK_FORMAT_PRESETS[preset as keyof typeof LINK_FORMAT_PRESETS]
// 拖拽排序
  if (!format) return
  settings.value.linkFormat = format
  save()
}
let dragFrom = -1
const dragStart = (e:DragEvent, i:number) => { dragFrom = i; (e.target as HTMLElement).style.opacity = '0.4' }
const dragEnd = (e:DragEvent) => { (e.target as HTMLElement).style.opacity = '1'; dragFrom = -1 }
const dragOver = (e:DragEvent) => e.preventDefault()
const dragDrop = async (e:DragEvent, to:number, type:'nav'|'dict'|'quickDoc', ref?:any, mgr?:any) => {
  e.preventDefault()
  if (dragFrom === -1 || dragFrom === to) return
  if (type === 'nav') { const arr = [...navItems.value]; arr.splice(to, 0, ...arr.splice(dragFrom, 1)); arr.forEach((v, i) => v.order = i); settings.value.navItems = arr; save() }
  else if (type === 'quickDoc') { const arr = [...settings.value.quickSendDocs]; arr.splice(to, 0, ...arr.splice(dragFrom, 1)); settings.value.quickSendDocs = arr; save() }
  else { const arr = [...ref.value]; arr.splice(to, 0, ...arr.splice(dragFrom, 1)); await mgr.sortDicts(arr.map((d:any) => d.id)); ref.value = arr }
}
const ttsI18nKey = (key:string, suffix='') => `tts${key.charAt(0).toUpperCase()}${key.slice(1)}${suffix}`

// 计算属性
const navItems = computed(() => (settings.value.navItems || [
  { id: 'bookshelf', icon: 'lucide-library-big', tip: 'bookshelf', enabled: true, order: 0 },
  { id: 'search', icon: 'lucide-book-search', tip: 'search', enabled: true, order: 1 },
  { id: 'deck', icon: 'lucide-wallet-cards', tip: '卡包', enabled: true, order: 2 },
  { id: 'toc', icon: 'lucide-scroll-text', tip: '目录', enabled: true, order: 3 },
  { id: 'mark', icon: 'lucide-square-pen', tip: '标注', enabled: true, order: 4 },
  { id: 'appearance', icon: 'lucide-settings-2', tip: '设置', enabled: true, order: 7 }
]).filter(item => item.id !== 'dictionary').sort((a, b) => a.order - b.order))
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
const saveTheme = () => { if (!can.value('reader-theme')) return settings.value.theme='default', showUpgrade('主题配色'); save() }
const togglePreview = () => (previewExpanded.value=!previewExpanded.value,localStorage.setItem('sr-preview-expanded',previewExpanded.value?'1':'0'))
const openPage = (url:string) => window.open(url,'_blank')
const openPurchasePage = () => openPage('https://pay.ldxp.cn/shop/J7MJJ8YR/lillyt')
const openMembershipInfo = () => openPage('https://sireader.745201.xyz')

// 打开授权面板
;(window as any)._openLicenseContent = () => {
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
</script>

<template>
  <div class="fn__flex-1 fn__flex-column sy__file bs-view bs-tree">
    <div class="fn__flex-1 bs-tree__scroll" @contextmenu.prevent.stop>
        <ul class="b3-list b3-list--background">
          <li class="b3-list-item" data-type="navigation-root" @click="togglePreview">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': previewExpanded }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n.livePreview || 'Preview' }}</span>
          </li>
          <li v-if="previewExpanded" class="b3-list-item b3-list-item--hide-action">
            <div class="sr-preview" :style="previewStyle">
              <p>{{ i18n.previewText1 || '预览段落一：在这里调整设置，可以实时看到阅读效果变化。' }}</p>
              <p>{{ i18n.previewText2 || '预览段落二：主题、间距和排版会随着设置即时更新。' }}</p>
            </div>
          </li>
        </ul>

        <ul ref="licenseRef" class="b3-list b3-list--background" data-name="license">
          <li class="b3-list-item" data-type="navigation-root" @click="toggleAccordion('license')">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeAccordion === 'license' }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n.membership || '会员订阅' }}</span>
            <span class="fn__space"></span>
            <span class="b3-list-item__action b3-tooltips b3-tooltips__w" :aria-label="i18n.usageTitle || '使用说明'" @click.stop="openMembershipInfo"><svg><use xlink:href="#iconHelp"></use></svg></span>
          </li>
          <template v-if="activeAccordion === 'license'">
            <li v-if="loadingLicense" class="b3-list-item b3-list-item--hide-action">
              <span class="b3-list-item__text ft__secondary">{{ i18n.loading || 'Loading' }}...</span>
            </li>
            <template v-else-if="license">
              <li class="b3-list-item b3-list-item--hide-action">
                <div class="fn__flex-1" style="min-width:0;display:flex;flex-direction:column;gap:4px;padding:1px 0">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <span style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;flex:0 0 44px">
                      <span style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:999px;background:var(--b3-theme-surface)">
                        <img v-if="licenseAvatarSrc" :src="licenseAvatarSrc" :alt="license.userName" style="width:100%;height:100%;object-fit:cover">
                        <svg v-else style="width:20px;height:20px;color:var(--b3-theme-primary)"><use :xlink:href="license.type === 'lifetime' ? '#iconLicenseLifetime' : license.type === 'annual' ? '#iconLicenseAnnual' : license.type === 'monthly' ? '#iconLicenseMonthly' : '#iconLicenseTrial'"></use></svg>
                      </span>
                      <span style="position:absolute;right:-3px;bottom:-2px;width:14px;height:14px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:var(--b3-theme-surface);box-shadow:0 0 0 1px var(--b3-border-color)">
                        <svg style="width:10px;height:10px;color:var(--b3-theme-primary)"><use :xlink:href="license.type === 'lifetime' ? '#iconLicenseLifetime' : license.type === 'annual' ? '#iconLicenseAnnual' : license.type === 'monthly' ? '#iconLicenseMonthly' : '#iconLicenseTrial'"></use></svg>
                      </span>
                    </span>
                    <span class="b3-list-item__text" style="display:flex;flex-direction:column;gap:1px;min-width:0">
                      <span style="font-size:15px">{{ license.userName }}</span>
                      <span class="ft__secondary" style="font-size:12px">{{ i18n.activated || '已激活' }} - {{ i18n[license.type === 'lifetime' ? 'lifetimeVersion' : license.type === 'annual' ? 'annualVersion' : license.type === 'monthly' ? 'monthlyVersion' : 'trialVersion'] }}</span>
                      <span class="ft__smaller ft__on-surface">ID {{ license.userId }}</span>
                      <span class="ft__smaller ft__on-surface">{{ i18n.activatedAt || '激活于' }} {{ new Date(license.activatedAt).toLocaleDateString() }}</span>
                    </span>
                  </div>
                  <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><button class="b3-button b3-button--text" @click.stop="clearLicense">{{ i18n.logout || 'Logout' }}</button><button class="b3-button b3-button--text" @click.stop="openPurchasePage">{{ i18n.purchase || 'Purchase' }}</button></div>
                </div>
              </li>
            </template>
            <template v-else>
              <li class="b3-list-item b3-list-item--hide-action">
                <span class="b3-list-item__toggle fn__hidden"></span>
                <div class="fn__flex-1" style="min-width:0;display:flex;flex-direction:column;gap:4px;padding:1px 0">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <span style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;flex:0 0 28px">
                      <svg style="width:18px;height:18px;color:var(--b3-theme-primary)"><use xlink:href="#iconLicenseTrial"></use></svg>
                    </span>
                    <div class="fn__flex-1" style="min-width:0">
                      <input
                        v-model="activationCode"
                        type="text"
                        class="b3-text-field"
                        :placeholder="i18n.enterActivationCode || 'Activation code'"
                        :disabled="processing"
                        @mousedown.stop
                        @pointerdown.stop
                        @touchend.stop="focusMobileEditable($event.target)"
                      >
                    </div>
                  </div>
                  <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><button class="b3-button b3-button--outline" :disabled="processing || !activationCode.trim()" @click.stop="activateLicense">{{ processing ? (i18n.processing || 'Processing') : (i18n.activate || 'Activate') }}</button><button class="b3-button b3-button--text" :disabled="processing" @click.stop="recoverLicense">{{ i18n.recover || 'Recover' }}</button><button class="b3-button b3-button--text" @click.stop="openPurchasePage">{{ i18n.purchase || 'Purchase' }}</button></div>
                </div>
              </li>
            </template>
          </template>
        </ul>

        <ul class="b3-list b3-list--background">
          <li class="b3-list-item" data-type="navigation-root" @click="toggleAccordion('interface')">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeAccordion === 'interface' }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n.interfaceLayout || 'Interface' }}</span>
          </li>
          <template v-if="activeAccordion === 'interface'">
            <li v-for="item in interfaceItems" :key="item.key" class="b3-list-item b3-list-item--hide-action">
              <span class="b3-list-item__toggle fn__hidden"></span>
              <span class="b3-list-item__text ariaLabel" :aria-label="i18n[item.key + 'Desc'] || ''">{{ i18n[item.key] || item.key }}</span>
              <span class="fn__space"></span>
              <select v-if="item.opts" v-model="settings[item.key]" class="b3-select sr-control" @change="save">
                <option v-for="opt in item.opts" :key="opt" :value="opt">{{ i18n[opt] || opt }}</option>
              </select>
              <label v-else-if="item.type === 'checkbox'" class="fn__flex-center"><input v-model="settings[item.key]" type="checkbox" class="b3-switch" @change="save"></label>
              <input
                v-else-if="item.type === 'range'"
                v-model.number="settings[item.key]"
                type="range"
                class="b3-slider sr-control b3-tooltips b3-tooltips__n"
                :min="item.min"
                :max="item.max"
                :step="item.step"
                :aria-label="`${settings[item.key]}${item.unit || ''}`"
                @input="debouncedSave"
              >
            </li>
            <li class="b3-list-item" data-type="navigation-root" @click.stop="toggleSub('navItems')">
              <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeSub === 'navItems' }"><use xlink:href="#iconRight"></use></svg>
              </span>
              <span class="b3-list-item__text">{{ i18n.navConfig || 'Navigation' }}</span>
            </li>
            <template v-if="activeSub === 'navItems'">
              <li
                v-for="(item, idx) in navItems"
                :key="item.id"
                class="b3-list-item b3-list-item--hide-action"
                draggable="true"
                @dragstart="dragStart($event, idx)"
                @dragend="dragEnd"
                @dragover="dragOver"
                @drop="dragDrop($event, idx, 'nav')"
              >
                <span class="b3-list-item__toggle fn__hidden"></span>
                <span class="b3-list-item__graphic">⋮⋮</span>
                <span class="b3-list-item__text">{{ i18n[item.tip] || item.tip }}</span>
                <span class="fn__space"></span>
                <label class="fn__flex-center"><input v-model="item.enabled" type="checkbox" class="b3-switch" :disabled="item.id === 'appearance'" @change="save"></label>
              </li>
            </template>
          </template>
        </ul>

        <ul class="b3-list b3-list--background">
          <li class="b3-list-item" data-type="navigation-root" @click="toggleAccordion('theme')">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeAccordion === 'theme' }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n.readingTheme || 'Theme' }}</span>
          </li>
          <template v-if="activeAccordion === 'theme'">
            <li class="b3-list-item b3-list-item--hide-action">
              <span class="b3-list-item__toggle fn__hidden"></span>
              <span class="b3-list-item__text ariaLabel" :aria-label="i18n.presetThemeDesc || ''">{{ i18n.presetTheme || 'Preset theme' }}</span>
              <span class="fn__space"></span>
              <select v-model="settings.theme" class="b3-select sr-control" @change="saveTheme">
                <option v-for="(theme, key) in PRESET_THEMES" :key="key" :value="key">{{ i18n[theme.name] || theme.name }}</option>
                <option value="custom">{{ i18n.custom || 'Custom' }}</option>
              </select>
            </li>
            <template v-if="settings.theme === 'custom'">
              <li v-for="item in customThemeItems" :key="item.key" class="b3-list-item b3-list-item--hide-action">
                <span class="b3-list-item__text ariaLabel" :aria-label="i18n[item.label + 'Desc'] || i18n[item.key + 'Desc'] || ''">{{ i18n[item.label] || item.label }}</span>
                <span class="fn__space"></span>
                <input
                  v-model="settings.customTheme[item.key]"
                  :type="item.type"
                  :class="item.type === 'color' ? 'sr-control' : 'b3-text-field sr-control'"
                  @change="can('reader-theme') ? save() : showUpgrade('reader-theme')"
                >
              </li>
            </template>
          </template>
        </ul>

        <ul v-for="group in appearanceGroups" :key="group.title" class="b3-list b3-list--background">
          <li class="b3-list-item" data-type="navigation-root" @click="toggleAccordion(group.title)">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeAccordion === group.title }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n[group.title] || group.title }}</span>
          </li>
          <template v-if="activeAccordion === group.title">
            <li v-for="item in group.items" :key="item.key" class="b3-list-item b3-list-item--hide-action">
              <span class="b3-list-item__toggle fn__hidden"></span>
              <span class="b3-list-item__text ariaLabel" :aria-label="i18n[item.key + 'Desc'] || ''">{{ i18n[item.key] || item.key }}</span>
              <span class="fn__space"></span>
              <label v-if="item.type === 'checkbox'" class="fn__flex-center"><input v-model="settings[group.title][item.key]" type="checkbox" class="b3-switch" @change="save"></label>
              <select v-else-if="item.type === 'select'" v-model="settings[group.title][item.key]" class="b3-select sr-control" @change="debouncedSave">
                <option v-for="(opt, idx) in item.opts" :key="opt" :value="opt">{{ i18n[item.labels[idx]] }}</option>
              </select>
              <input
                v-else
                v-model.number="settings[group.title][item.key]"
                type="range"
                class="b3-slider sr-control b3-tooltips b3-tooltips__n"
                :min="item.min"
                :max="item.max"
                :step="item.step"
                :aria-label="`${settings[group.title][item.key]}${item.unit || ''}`"
                @input="debouncedSave"
              >
            </li>
            <template v-if="group.title === 'textSettings'">
              <li class="b3-list-item" data-type="navigation-root" @click.stop="toggleSub('customFont')">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                  <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeSub === 'customFont' }"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span class="b3-list-item__text">{{ i18n.customFont || 'Custom font' }}</span>
              </li>
              <template v-if="activeSub === 'customFont'">
                <li class="b3-list-item b3-list-item--hide-action">
                  <span class="b3-list-item__toggle fn__hidden"></span>
                  <span class="b3-list-item__text ariaLabel" :aria-label="i18n.fontTip || '刷新字体列表'"><code>data/plugins/custom-fonts/</code></span>
                  <span class="fn__space"></span>
                  <button class="b3-button b3-button--text" :disabled="isLoadingFonts" @click.stop="loadCustomFonts(true)">{{ i18n.refresh || 'Refresh' }}</button>
                </li>
                <li v-if="isLoadingFonts" class="b3-list-item b3-list-item--hide-action">
                  <span class="b3-list-item__toggle fn__hidden"></span>
                  <span class="b3-list-item__text ft__secondary">{{ i18n.loadingFonts || 'Loading fonts' }}</span>
                </li>
                <template v-else-if="customFonts.length">
                  <li
                    v-for="f in customFonts"
                    :key="f.name"
                    class="b3-list-item b3-list-item--hide-action"
                    :class="{ 'b3-list-item--focus': settings.textSettings.customFont.fontFile === f.name }"
                    @click.stop="setFont(f)"
                  >
                    <span class="b3-list-item__toggle fn__hidden"></span>
                    <span class="b3-list-item__text" :style="{ fontFamily: f.displayName }">{{ f.displayName }}</span>
                    <span class="fn__space"></span>
                    <span class="b3-list-item__meta">{{ f.name }}</span>
                    <button v-if="settings.textSettings.customFont.fontFile === f.name" class="b3-button b3-button--text" @click.stop="setFont()">{{ i18n.clear || 'Clear' }}</button>
                  </li>
                </template>
                <li v-else class="b3-list-item b3-list-item--hide-action">
                  <span class="b3-list-item__toggle fn__hidden"></span>
                  <span class="b3-list-item__text ft__secondary">{{ i18n.noCustomFonts || 'No custom fonts' }}</span>
                </li>
              </template>
            </template>
          </template>
        </ul>

        <ul class="b3-list b3-list--background">
          <li class="b3-list-item" data-type="navigation-root" @click="toggleAccordion('dictionary')">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeAccordion === 'dictionary' }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n.dictionaryTools || 'Dictionary' }}</span>
          </li>
          <template v-if="activeAccordion === 'dictionary'">
            <li v-if="loadingDict" class="b3-list-item b3-list-item--hide-action">
              <span class="b3-list-item__text ft__secondary">{{ i18n.loading || 'Loading' }}...</span>
            </li>
            <template v-else>
              <template v-for="section in dictSections" :key="section.key">
                <li class="b3-list-item" data-type="navigation-root" @click.stop="toggleSub(section.key)">
                  <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeSub === section.key }"><use xlink:href="#iconRight"></use></svg>
                  </span>
                  <span class="b3-list-item__text">{{ section.title }}</span>
                </li>
                <template v-if="activeSub === section.key">
                  <li v-if="section.extra" class="b3-list-item b3-list-item--hide-action">
                    <span class="b3-list-item__toggle fn__hidden"></span>
                    <input ref="fileInput" type="file" multiple accept=".ifo,.idx,.dz,.index,.syn" class="fn__none" @change="handleUpload">
                    <span class="b3-list-item__text ariaLabel" :aria-label="i18n.dictFormatHint || '支持 StarDict 和 dictd 格式'">{{ i18n.addDict || '添加词典' }}</span>
                    <span class="fn__space"></span>
                    <button class="b3-button b3-button--text" :disabled="uploading" @click.stop="can('dict-offline') ? fileInput?.click() : showUpgrade('dict-offline')">
                      {{ uploading ? (i18n.uploading || 'Uploading') : (i18n.addDict || 'Add') }}
                    </button>
                  </li>
                  <li v-if="section.extra" class="b3-list-item b3-list-item--hide-action">
                    <span class="b3-list-item__toggle fn__hidden"></span>
                    <span class="b3-list-item__text">
                      <a href="https://github.com/mm-o/siyuan-sireader/blob/main/docs/%E7%A6%BB%E7%BA%BF%E8%AF%8D%E5%85%B8%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md" target="_blank">{{ i18n.downloadDict || '下载词典' }}</a>
                    </span>
                  </li>
                  <template v-if="section.items.length">
                    <li
                      v-for="(d, idx) in section.items"
                      :key="d.id"
                      class="b3-list-item b3-list-item--hide-action"
                      draggable="true"
                      @dragstart="dragStart($event, idx)"
                      @dragend="dragEnd"
                      @dragover="dragOver"
                      @drop="section.drop($event, idx)"
                    >
                      <span class="b3-list-item__toggle fn__hidden"></span>
                      <span class="b3-list-item__graphic">⋮⋮</span>
                      <span class="b3-list-item__text">{{ d.name }}</span>
                      <span class="fn__space"></span>
                      <span class="b3-list-item__meta">{{ section.desc(d) }}</span>
                      <label class="fn__flex-center"><input type="checkbox" :checked="d.enabled" class="b3-switch" @change="section.toggle(d.id)"></label>
                      <template v-if="section.extra">
                        <div class="fn__space"></div>
                        <button v-if="removingDict === d.id" class="b3-button b3-button--cancel" @click.stop="removingDict = null">{{ i18n.cancel || 'Cancel' }}</button>
                        <div v-if="removingDict === d.id" class="fn__space"></div>
                        <button v-if="removingDict === d.id" class="b3-button b3-button--text" @click.stop="removeDict(d.id)">{{ i18n.delete || 'Delete' }}</button>
                        <button v-else class="b3-button b3-button--text" @click.stop="removingDict = d.id">{{ i18n.delete || 'Delete' }}</button>
                      </template>
                    </li>
                  </template>
                  <li v-else-if="section.empty" class="b3-list-item b3-list-item--hide-action">
                    <span class="b3-list-item__toggle fn__hidden"></span>
                    <span class="b3-list-item__text ft__secondary">{{ section.empty }}</span>
                  </li>
                </template>
              </template>
            </template>
          </template>
        </ul>

        <ul class="b3-list b3-list--background">
          <li class="b3-list-item" data-type="navigation-root" @click="toggleAccordion('other')">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeAccordion === 'other' }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n.noteInsert || 'Note insert' }}</span>
          </li>
          <template v-if="activeAccordion === 'other'">
            <li v-for="field in noteFields" :key="field.key" class="b3-list-item b3-list-item--hide-action">
              <span class="b3-list-item__toggle fn__hidden"></span>
              <div class="fn__flex-1">
                <div class="fn__flex">
                  <span class="b3-list-item__text ariaLabel" :aria-label="field.hint || ''">{{ field.label }}</span>
                  <span class="fn__space"></span>
                  <select v-if="field.type === 'select'" :value="field.value" class="b3-select sr-control" @change="field.set(($event.target as HTMLSelectElement).value)">
                    <option v-if="field.empty" value="">{{ field.empty }}</option>
                    <option v-for="opt in (field.options || [])" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                  </select>
                  <label v-else-if="field.type === 'checkbox'" class="fn__flex-center"><input :checked="field.value" type="checkbox" class="b3-switch" @change="field.set(($event.target as HTMLInputElement).checked)"></label>
                </div>
                <textarea v-if="field.type === 'textarea'" v-model="settings.linkFormat" class="b3-text-field" rows="3" @input="debouncedSave"></textarea>
                <template v-else-if="field.type === 'search'">
                  <div
                    v-for="(doc, i) in (field.docs || [])"
                    :key="doc.id"
                    class="fn__flex"
                    :draggable="!!field.drag"
                    @dragstart="field.drag && dragStart($event, i)"
                    @dragend="field.drag && dragEnd($event)"
                    @dragover="field.drag && dragOver($event)"
                    @drop="field.drag && dragDrop($event, i, field.drag)"
                  >
                  <span v-if="field.drag">⋮⋮</span>
                    <span class="fn__ellipsis">{{ doc.name }}</span>
                    <span class="fn__space"></span>
                    <button class="b3-button b3-button--text" @click="field.remove(doc, i)">{{ i18n.delete || 'Delete' }}</button>
                  </div>
                  <div>
                    <input :value="field.input" class="b3-text-field" :placeholder="i18n?.searchDocPlaceholder || 'Search document'" @input="field.setInput(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value.trim() && field.search()" @keyup.enter="field.search()">
                    <div v-if="(field.results || []).length">
                      <div
                        v-for="doc in (field.results || [])"
                        :key="doc.id"
                        class="b3-list-item b3-list-item--hide-action"
                        @click="field.select(doc)"
                      >
                        <span class="b3-list-item__toggle fn__hidden"></span>
                        <span class="b3-list-item__text">{{ doc.hPath || doc.content || 'Untitled' }}</span>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </li>
          </template>
        </ul>

        <ul class="b3-list b3-list--background">
          <li class="b3-list-item" data-type="navigation-root" @click="toggleAccordion('tts')">
            <span class="b3-list-item__toggle b3-list-item__toggle--hl">
              <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeAccordion === 'tts' }"><use xlink:href="#iconRight"></use></svg>
            </span>
            <span class="b3-list-item__text">{{ i18n.ttsSettings || 'TTS' }}</span>
          </li>
          <template v-if="activeAccordion === 'tts'">
            <template v-if="settings.tts">
              <li v-for="item in ttsFields" :key="item.key" class="b3-list-item b3-list-item--hide-action">
                <span class="b3-list-item__toggle fn__hidden"></span>
                <span class="b3-list-item__text ariaLabel" :aria-label="item.desc && i18n[item.desc] ? i18n[item.desc] : ''">{{ i18n[ttsI18nKey(item.key)] || item.key }}</span>
                <span class="fn__space"></span>
                <label v-if="item.type === 'checkbox'" class="fn__flex-center"><input v-model="settings.tts[item.key]" type="checkbox" class="b3-switch" @change="save"></label>
                <input
                  v-else
                  v-model.number="settings.tts[item.key]"
                  type="range"
                  class="b3-slider sr-control b3-tooltips b3-tooltips__n"
                  :min="item.min"
                  :max="item.max"
                  :step="item.step"
                  :aria-label="`${settings.tts[item.key]}${item.unit || ''}`"
                  @input="debouncedSave"
                >
              </li>
              <template v-for="section in voiceSections" :key="section.key">
                <li class="b3-list-item" data-type="navigation-root" @click.stop="toggleSub(section.key)">
                  <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow" :class="{ 'b3-list-item__arrow--open': activeSub === section.key }"><use xlink:href="#iconRight"></use></svg>
                  </span>
                  <span class="b3-list-item__text ariaLabel" :aria-label="section.hint || ''">{{ section.title }}</span>
                </li>
                <template v-if="activeSub === section.key">
                  <li v-if="section.showLoad" class="b3-list-item b3-list-item--hide-action">
                    <span class="b3-list-item__toggle fn__hidden"></span>
                    <span class="b3-list-item__text">{{ i18n.ttsLoadVoices || 'Load voices' }}</span>
                    <span class="fn__space"></span>
                    <span class="b3-list-item__action b3-tooltips b3-tooltips__w" :aria-label="i18n.ttsLoadVoices || 'Load voices'" @click.stop="!loadingTTS && loadTTS()">
                      <svg><use xlink:href="#iconRefresh"></use></svg>
                    </span>
                  </li>
                  <li v-if="section.showLoad && loadingTTS" class="b3-list-item b3-list-item--hide-action">
                    <span class="b3-list-item__toggle fn__hidden"></span>
                    <span class="b3-list-item__text ft__secondary">{{ i18n.loading || 'Loading' }}...</span>
                  </li>
                  <template v-else-if="section.items.length">
                    <li
                      v-for="v in section.items"
                      :key="v.name"
                      class="b3-list-item b3-list-item--hide-action"
                      :class="{ 'b3-list-item--focus': settings.tts.voice === v.name }"
                      @click.stop="section.pick(v)"
                    >
                      <span class="b3-list-item__toggle fn__hidden"></span>
                      <span class="b3-list-item__text">{{ v.displayName }}</span>
                      <span class="fn__space"></span>
                      <span class="b3-list-item__meta">{{ section.meta(v) }}</span>
                      <span
                        v-if="section.actionText(v)"
                        class="b3-list-item__action b3-tooltips b3-tooltips__w"
                        :aria-label="section.actionTitle(v)"
                        @click.stop="section.action(v)"
                      >
                        <svg><use :xlink:href="isFav(v.name) ? '#iconBookmark' : '#iconBookmark'"></use></svg>
                      </span>
                    </li>
                  </template>
                  <li v-else class="b3-list-item b3-list-item--hide-action">
                    <span class="b3-list-item__toggle fn__hidden"></span>
                    <span class="b3-list-item__text ft__secondary">{{ section.empty }}</span>
                  </li>
                </template>
              </template>
            </template>
            <li v-else class="b3-list-item b3-list-item--hide-action">
              <span class="b3-list-item__text ft__secondary">{{ i18n.ttsNotConfigured || 'TTS not configured' }}</span>
            </li>
          </template>
        </ul>

      <div class="sr-settings-actions">
        <template v-if="resetConfirm">
          <button class="b3-button b3-button--cancel" @click="resetConfirm = false">{{ i18n.cancel || 'Cancel' }}</button>
          <button class="b3-button" @click="handleReset">{{ i18n.confirm || 'Confirm' }}</button>
        </template>
        <button v-else class="b3-button" @click="handleReset">{{ i18n.resetDefault || 'Reset' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
@use './deck/deck.scss';

.bs-view{min-height:0;height:100%;padding:0;box-sizing:border-box}
.bs-tree{overflow:hidden;--bs-tree-border:color-mix(in srgb,var(--b3-theme-on-surface-light) 30%,transparent);--b3-list-hover:color-mix(in srgb,var(--b3-theme-primary) 12%,transparent)}
.bs-tree__scroll{display:flex;flex-direction:column;gap:6px;min-height:0;overflow:auto;scrollbar-gutter:stable;padding:8px 0 8px 8px;box-sizing:border-box}
.bs-tree :deep(ul){padding:0;list-style:none}
.bs-tree :deep(.b3-list){margin:0;background:transparent}
.bs-tree :deep(.b3-list-item){overflow:visible}
.bs-tree :deep(.b3-list-item[data-type="navigation-root"]){margin:0;border-radius:var(--b3-border-radius)}
.bs-tree :deep(.b3-list-item--hide-action + .b3-list-item--hide-action){border-top:1px solid var(--b3-border-color)}
.bs-tree :deep(.b3-list-item--hide-action:last-child){padding-bottom:6px}
.bs-tree :deep(.b3-list-item__text),.bs-tree :deep(.b3-text-field){min-width:0}
.bs-tree :deep(.b3-text-field){width:100%;max-width:100%;box-sizing:border-box}
.bs-tree :deep(ul.b3-list.b3-list--background){border:1px solid var(--bs-tree-border);border-radius:var(--b3-border-radius)}
.sr-control{width:80px}
.sr-settings-actions{display:flex;justify-content:center;align-items:center;gap:8px;padding:8px 0 0}
.bs-tree :deep(input[type="color"].sr-control){height:24px;padding:0;border:none;background:transparent}
.sr-preview{width:100%;overflow:hidden;border-radius:var(--b3-border-radius);column-count:var(--column-count, 1);column-gap:var(--gap)}
.sr-preview p{margin:0;padding:var(--margin-v) var(--margin-h);text-indent:calc(1em * var(--text-indent, 0));break-inside:avoid}
.sr-preview p + p{margin-top:calc(1em * var(--paragraph-spacing, 0.8))}
.license-highlight{animation:license-pulse 2s ease}
@keyframes license-pulse {
  0%,100%{box-shadow:0 0 0 0 transparent}
  50%{box-shadow:0 0 0 4px var(--b3-theme-primary-light)}
}
</style>
