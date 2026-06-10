export type PageScriptRunAt = 'document-start' | 'document-end' | 'idle'

export interface PageScript {
  id: string
  name: string
  enabled?: boolean
  matches: string[]
  excludes?: string[]
  runAt?: PageScriptRunAt
  code?: string
  css?: string
  builtIn?: boolean
}

export interface PageScriptMenuItem {
  id: string
  title: string
  description?: string
  type?: 'button' | 'checkbox' | 'number' | 'text' | 'select' | 'separator'
  command?: string
  payload?: Record<string, unknown>
  activeKey?: string
  activeValue?: unknown
  valueKey?: string
  prompt?: string
  unit?: string
  color?: string
  options?: Array<{ label: string; value: unknown }>
  children?: PageScriptMenuItem[]
}

export interface PageScriptToolbarItem {
  id: string
  title: string
  icon?: string
  text?: string
  order?: number
  activeKey?: string
  command?: string
  menu?: PageScriptMenuItem[]
}

const escapeRegExp = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
const wildcardToRegExp = (pattern: string) => new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'i')
const matchesPattern = (url: string, pattern: string) => wildcardToRegExp(pattern).test(url)

export const scriptMatchesUrl = (script: PageScript, url: string) =>
  script.enabled !== false
  && script.matches.some(pattern => matchesPattern(url, pattern))
  && !(script.excludes || []).some(pattern => matchesPattern(url, pattern))

const runtimeScripts: PageScript[] = []

export const registerPageScript = (script: PageScript) => {
  const index = runtimeScripts.findIndex(item => item.id === script.id)
  if (index >= 0) runtimeScripts[index] = script
  else runtimeScripts.push(script)
  return script
}

export const unregisterPageScript = (id: string) => {
  const index = runtimeScripts.findIndex(item => item.id === id)
  if (index >= 0) runtimeScripts.splice(index, 1)
}

export const listPageScripts = () => [...runtimeScripts]

export const setPageScriptEnabled = (id: string, enabled: boolean) => {
  const script = runtimeScripts.find(item => item.id === id)
  if (script) script.enabled = enabled
  return script
}

export const getRuntimePageScriptsForUrl = (url: string) => runtimeScripts.filter(script => scriptMatchesUrl(script, url))

export const createPageBridgeScript = () => `(() => {
  const root = window.__sireaderPageBridge || {
    toolbarItems: [],
    state: {},
    commands: {},
  }
  const clone = value => JSON.parse(JSON.stringify(value ?? null))
  const emit = type => {
    try { window.dispatchEvent(new CustomEvent('sireader-page:' + type, { detail: root.dump() })) } catch {}
  }
  const styleId = id => 'sireader-page-style-' + String(id || 'default').replace(/[^\\w-]/g, '-')
  const publicItem = item => {
    const next = { ...item }
    delete next.onClick
    if (Array.isArray(next.menu)) next.menu = next.menu.map(publicItem)
    if (Array.isArray(next.children)) next.children = next.children.map(publicItem)
    return next
  }
  root.dump = () => clone({
    toolbarItems: root.toolbarItems,
    state: root.state,
  })
  root.runCommand = async (id, payload) => {
    const fn = root.commands[id]
    if (!fn) return root.dump()
    const result = await fn(payload || {})
    if (result && typeof result === 'object') root.state = { ...root.state, ...result }
    emit('state')
    return root.dump()
  }
  root.makeApi = script => ({
    version: '1.0.0',
    scriptId: script.id,
    url: location.href,
    getSetting(key, fallback) {
      const raw = localStorage.getItem('sireader.script.' + script.id + '.' + key)
      if (raw == null) return fallback
      try { return JSON.parse(raw) } catch { return raw }
    },
    setSetting(key, value) {
      localStorage.setItem('sireader.script.' + script.id + '.' + key, JSON.stringify(value))
      return value
    },
    getSettings() {
      const prefix = 'sireader.script.' + script.id + '.'
      const out = {}
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key || !key.startsWith(prefix)) continue
        const shortKey = key.slice(prefix.length)
        try { out[shortKey] = JSON.parse(localStorage.getItem(key)) } catch { out[shortKey] = localStorage.getItem(key) }
      }
      return out
    },
    setSettings(patch) {
      Object.entries(patch || {}).forEach(([key, value]) => this.setSetting(key, value))
      return this.getSettings()
    },
    addStyle(css, id) {
      const nodeId = styleId(script.id + '-' + (id || 'style'))
      let style = document.getElementById(nodeId)
      if (!style) {
        style = document.createElement('style')
        style.id = nodeId
        document.documentElement.appendChild(style)
      }
      style.textContent = css || ''
      return nodeId
    },
    registerCommand(command) {
      if (!command?.id || typeof command.run !== 'function') return
      root.commands[script.id + ':' + command.id] = command.run
    },
    registerToolbarItem(item) {
      if (!item?.id) return
      const next = publicItem({ ...item, scriptId: script.id, id: script.id + ':' + item.id })
      root.toolbarItems = root.toolbarItems.filter(old => old.id !== next.id).concat(next).sort((a, b) => (a.order || 0) - (b.order || 0))
      emit('toolbar')
    },
    setState(patch) {
      root.state = { ...root.state, ...patch }
      emit('state')
      return root.state
    },
    getState() {
      return root.state
    },
    emit(type, detail) {
      emit(type, detail)
    },
  })
  window.__sireaderPageBridge = root
  window.sireaderPage = root.makeApi({ id: 'anonymous', name: 'anonymous' })
})()`

export const wrapPageScript = (script: PageScript) => `(() => {
  const script = ${JSON.stringify({ id: script.id, name: script.name })}
  if (!window.__sireaderPageBridge?.makeApi) return
  window.sireaderPage = window.__sireaderPageBridge.makeApi(script);
  ${script.css ? `window.sireaderPage.addStyle(${JSON.stringify(script.css)}, 'main');` : ''}
  ${script.code || ''}
})()`
