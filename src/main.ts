import { Plugin } from 'siyuan'
import { createApp } from 'vue'
import App from './App.vue'
import { initDictModule } from '@/utils/dictionary'
import { mountReaderIconSprite, registerReaderIcons } from '@/utils/icon'
import { initMobile } from '@/utils/mobile'
import { setPlugin } from '@/utils/copy'

let plugin: Plugin | null = null
let app: any = null
let cleanupCallbacks: (() => void)[] = []

export const usePlugin = (p?: Plugin) => p ? (plugin = p) : plugin!
export const registerCleanup = (cb: () => void) => cleanupCallbacks.push(cb)
export const setOpenSettingHandler = (handler: (openLicense?: boolean) => void) => {
  (window as any)._sy_plugin_sample = (window as any)._sy_plugin_sample || {}
  ;(window as any)._sy_plugin_sample.openSetting = handler
}

export function init(p: Plugin) {
  usePlugin(p)
  setPlugin(p)
  initDictModule(p)
  initMobile(p)

  const div = document.createElement('div')
  div.id = p.name
  div.className = 'plugin-sample-vite-vue-app'
  mountReaderIconSprite(div)
  document.body.appendChild(div)
  registerReaderIcons(p)
  app = createApp(App)
  app.mount(div)
}

export function destroy() {
  if (!plugin) return
  cleanupCallbacks.forEach(cb => cb())
  cleanupCallbacks = []
  app?.unmount()
  document.getElementById(plugin.name)?.remove()
  plugin = null
}
