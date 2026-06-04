<template>
  <Transition name="fade">
    <div v-if="visible && (tts.isActive.value || tts.currentText.value)" ref="popupRef" class="tts-mini" @click.stop>
      <div class="tts-mini-top">
        <div class="tts-mini-icon"><svg><use xlink:href="#lucide-volume-2" /></svg></div>
        <div class="tts-mini-info">
          <div class="tts-mini-title">{{ tts.title.value || '朗读中' }}</div>
          <div class="tts-mini-state">{{ tts.paused.value ? '已暂停' : '正在播放' }}</div>
        </div>
        <div class="tts-mini-tools">
          <button class="block__icon block__icon--show" aria-label="上一段" @click="tts.jump(-1)">
            <svg><use xlink:href="#iconLeft" /></svg>
          </button>
          <button class="block__icon block__icon--show" :aria-label="tts.paused.value ? '继续' : '暂停'" @click="tts.togglePause()">
            <svg><use :xlink:href="tts.paused.value ? '#iconPlay' : '#iconPause'" /></svg>
          </button>
          <button class="block__icon block__icon--show" aria-label="下一段" @click="tts.jump(1)">
            <svg><use xlink:href="#iconRight" /></svg>
          </button>
          <button class="block__icon block__icon--show" aria-label="停止" @click="stop">
            <svg><use xlink:href="#iconClose" /></svg>
          </button>
        </div>
      </div>
      <div class="tts-mini-text">{{ tts.currentText.value || '准备朗读...' }}</div>
      <div v-if="ttsSettings" class="tts-mini-controls">
        <div class="tts-mini-line">
          <label class="tts-mini-voice">
            <span>语音</span>
            <select class="b3-select" :value="ttsSettings.voice" @focus="loadVoices" @change="setVoice">
              <option v-for="voice in voiceOptions" :key="voice.name" :value="voice.name">{{ voice.displayName || voice.name }}</option>
            </select>
          </label>
          <label class="tts-mini-rate">
            <span>{{ Number(ttsSettings.rate || 1).toFixed(1) }}x</span>
            <input class="b3-slider" type="range" min="0.5" max="2" step="0.1" :value="ttsSettings.rate || 1" @input="setRate">
          </label>
        </div>
        <div class="tts-mini-switches">
          <label><input class="b3-switch" type="checkbox" :checked="ttsSettings.autoTurnPage" @change="setCheck('autoTurnPage', $event)"> 自动翻页</label>
          <label><input class="b3-switch" type="checkbox" :checked="ttsSettings.highlightText" @change="setCheck('highlightText', $event)"> 高亮文本</label>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { settingsManager, type ReaderSettings } from '@/composables/useSetting'
import { getTTSController } from '@/services/TTSPlayer'
import type { TTSVoice } from '@/services/TTSEngine'

const tts = getTTSController()
const visible = ref(false)
const popupRef = ref<HTMLElement>()
const settings = ref<ReaderSettings | null>((window as any).__sireader_settings || null)
const voices = ref<TTSVoice[]>([])
const loadingVoices = ref(false)
let saveTimer: number | undefined

const position = () => nextTick(() => {
  const btn = document.querySelector('#tts-btn') as HTMLElement | null
  if (!btn || !popupRef.value) return
  const rect = btn.getBoundingClientRect()
  popupRef.value.style.right = `${window.innerWidth - rect.right}px`
  popupRef.value.style.bottom = `${window.innerHeight - rect.top + 8}px`
})
const syncSettings = (e?: Event) => settings.value = (e as CustomEvent)?.detail || (window as any).__sireader_settings || settings.value
const toggle = () => (visible.value = !visible.value, visible.value && (syncSettings(), position()))
const clickOut = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  if (target?.closest('#tts-btn') || target?.closest('.tts-mini')) return
  visible.value = false
}
const stop = () => {
  tts.destroy()
  visible.value = false
}
const ttsSettings = computed(() => settings.value?.tts)
const voiceOptions = computed(() => {
  const current = ttsSettings.value?.voice
  const favorites = settings.value?.tts?.favoriteVoices || []
  const list = [...voices.value.filter(v => v.isLocal), ...favorites.filter(v => !voices.value.some(local => local.name === v.name))]
  return current && !list.some(v => v.name === current) ? [{ name: current, displayName: current, locale: '', isLocal: false }, ...list] : list
})
const loadVoices = async () => {
  if (loadingVoices.value || voices.value.length) return
  loadingVoices.value = true
  try {
    const { loadLocalVoices } = await import('@/services/TTSEngine')
    voices.value = await loadLocalVoices()
  } finally { loadingVoices.value = false }
}
const saveSettings = () => {
  if (!settings.value) return
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => settings.value && settingsManager.save(settings.value).catch(() => {}), 200)
}
const setTTS = (key: string, value: any) => {
  if (!settings.value?.tts) return
  ;(settings.value.tts as any)[key] = value
  tts.updateConfig(settings.value.tts)
  saveSettings()
}
const setRate = (e: Event) => setTTS('rate', Number((e.target as HTMLInputElement).value))
const setVoice = (e: Event) => setTTS('voice', (e.target as HTMLSelectElement).value)
const setCheck = (key: 'autoTurnPage' | 'highlightText', e: Event) => setTTS(key, (e.target as HTMLInputElement).checked)

watch(tts.isActive, active => {
  if (!active) visible.value = false
})

onMounted(() => {
  !settings.value && settingsManager.get().then(v => settings.value = v).catch(() => {})
  window.addEventListener('tts:toggle-mini', toggle)
  window.addEventListener('sireaderSettingsUpdated', syncSettings)
  window.addEventListener('resize', position)
  document.addEventListener('click', clickOut)
})
onUnmounted(() => {
  clearTimeout(saveTimer)
  window.removeEventListener('tts:toggle-mini', toggle)
  window.removeEventListener('sireaderSettingsUpdated', syncSettings)
  window.removeEventListener('resize', position)
  document.removeEventListener('click', clickOut)
})
</script>

<style scoped>
.tts-mini{position:fixed;z-index:99999;width:min(320px,calc(100vw - 16px));border:1px solid var(--b3-border-color);border-radius:var(--b3-border-radius-b);background:var(--b3-theme-surface);box-shadow:0 8px 24px #0002;backdrop-filter:blur(16px);pointer-events:auto;overflow:hidden}
.tts-mini-top{display:flex;align-items:center;gap:10px;min-width:0;padding:10px 10px 6px}
.tts-mini-icon{width:38px;height:38px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:var(--b3-border-radius);background:var(--b3-theme-background-light);color:var(--b3-theme-primary)}
.tts-mini-icon svg{width:18px;height:18px}
.tts-mini-info{flex:1;min-width:0;line-height:1.35}
.tts-mini-title{font-size:12px;font-weight:600;color:var(--b3-theme-on-surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tts-mini-state{font-size:11px;color:var(--b3-theme-on-surface-variant)}
.tts-mini-tools{display:flex;align-items:center;gap:2px;flex-shrink:0}
.tts-mini-tools .block__icon{width:26px;height:26px}
.tts-mini-text{margin:0 10px 10px;padding:8px;border-radius:6px;background:var(--b3-theme-background);font-size:12px;line-height:1.55;color:var(--b3-theme-on-surface-variant);max-height:140px;overflow:auto;word-break:break-word}
.tts-mini-controls{border-top:1px solid var(--b3-border-color);padding:8px 10px 10px;display:grid;gap:8px;font-size:12px;color:var(--b3-theme-on-surface-variant)}
.tts-mini-line{display:grid;grid-template-columns:minmax(0,1fr) 118px;align-items:center;gap:8px;min-width:0}
.tts-mini-voice,.tts-mini-rate{display:flex;align-items:center;gap:6px;min-width:0}
.tts-mini-voice span,.tts-mini-rate span{flex-shrink:0}
.tts-mini-voice .b3-select{width:100%;min-width:0;max-width:150px;height:26px}
.tts-mini-rate .b3-slider{min-width:0}
.tts-mini-switches{display:flex;justify-content:space-between;gap:8px}
.tts-mini-switches label{display:flex;align-items:center;gap:6px;white-space:nowrap}
.fade-enter-active,.fade-leave-active{transition:all .18s}
.fade-enter-from,.fade-leave-to{opacity:0;transform:translateY(8px)}
</style>
