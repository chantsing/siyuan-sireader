import { Plugin } from 'siyuan'
import { createApp } from 'vue'
import App from './App.vue'
import { initDictModule } from '@/utils/dictionary'
import { mountReaderIconSprite, registerReaderIcons } from '@/utils/icon'
import { initMobile } from '@/utils/mobile'
import { setPlugin } from '@/utils/copy'
import { flushStorage, storageEngine, recoverBackupRecords } from '@/core/storage'
import { drainPendingTasks, trackPending } from '@/core/storage'
import { installDiagnostics, diagnosticLog, disposeDiagnostics } from '@/core/diagnostics'

let plugin: Plugin | null = null
let app: any = null
let cleanupCallbacks: (() => void | Promise<void>)[] = []

export const usePlugin = (p?: Plugin) => p ? (plugin = p) : plugin!
export const registerCleanup = (cb: () => void | Promise<void>) => cleanupCallbacks.push(cb)
export const setOpenSettingHandler = (handler: (openLicense?: boolean) => void) => {
  (window as any)._sy_plugin_sample = (window as any)._sy_plugin_sample || {}
  ;(window as any)._sy_plugin_sample.openSetting = handler
}

export async function init(p: Plugin) {
  usePlugin(p)
  storageEngine.startAccepting()
  setPlugin(p)
  installDiagnostics({ plugin: p.name, version: (p as any).version || '', frontend: (p as any).platform || '' })
  diagnosticLog('info', 'plugin.init.start', { plugin: p.name })
  // Finish recovery before mounting readers; sync notifications never trigger it.
  await recoverBackupRecords()
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
  diagnosticLog('info', 'plugin.init.done', { plugin: p.name })
}

export async function destroy() {
  if (!plugin) return
  diagnosticLog('info', 'plugin.destroy.start', { plugin: plugin.name })
  const errors: unknown[] = []
  for (const callback of cleanupCallbacks) trackPending(Promise.resolve().then(callback))
  cleanupCallbacks = []
  await drainPendingTasks().catch(error => errors.push(error))
  app?.unmount()
  await drainPendingTasks().catch(error => errors.push(error))
  await flushStorage().catch(error => errors.push(error))
  await drainPendingTasks().catch(error => errors.push(error))
  await flushStorage().catch(error => errors.push(error))
  storageEngine.stopAccepting()
  document.getElementById(plugin.name)?.remove()
  plugin = null
  diagnosticLog('info', 'plugin.destroy.done', { errors: errors.length })
  disposeDiagnostics()
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    const error = new Error(`SiReader cleanup failed (${errors.length} errors)`) as Error & { errors?: unknown[] }
    error.errors = errors
    throw error
  }
}
