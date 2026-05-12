import { computed, ref } from 'vue'

const activeView = ref<any>(null)
const activeReader = ref<any>(null)

export const setActiveReader = (view: any, reader?: any, settings?: any) => {
  activeView.value = view
  activeReader.value = reader || null
  ;(window as any).__sireader_active_view = view
  ;(window as any).__sireader_active_reader = reader || null
  ;(window as any).__sireader_settings = settings || null
}

export const clearActiveReader = () => {
  activeView.value = null
  activeReader.value = null
  ;(window as any).__sireader_active_view = null
  ;(window as any).__sireader_active_reader = null
  ;(window as any).__sireader_settings = null
}

export const useReaderState = () => ({
  activeView: computed(() => activeView.value),
  activeReader: computed(() => activeReader.value),
  canShowToc: computed(() => !!activeView.value),
})
