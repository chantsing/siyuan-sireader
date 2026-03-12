// 翻译服务：Google、Azure、Yandex
export async function translateGoogle(text: string, targetLang: string = 'zh-CN'): Promise<string> {
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.append('client', 'gtx')
  url.searchParams.append('dt', 't')
  url.searchParams.append('sl', 'auto')
  url.searchParams.append('tl', targetLang)
  url.searchParams.append('q', text)
  
  const response = await fetch(url.toString())
  const data = await response.json()
  
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return data[0].filter((s: any) => Array.isArray(s) && s[0]).map((s: any) => s[0]).join('')
  }
  return text
}

let azureToken: { token: string; expiresAt: number } | null = null

async function getAzureToken(): Promise<string> {
  const now = Date.now()
  if (azureToken && azureToken.expiresAt > now) return azureToken.token
  
  const response = await fetch('https://edge.microsoft.com/translate/auth', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  const token = await response.text()
  azureToken = { token, expiresAt: now + 8 * 60 * 1000 }
  return token
}

export async function translateAzure(text: string, targetLang: string = 'zh-CN'): Promise<string> {
  const token = await getAzureToken()
  const url = 'https://api-edge.cognitive.microsofttranslator.com/translate'
  const params = new URLSearchParams({ to: targetLang, 'api-version': '3.0' })
  
  const response = await fetch(`${url}?${params}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify([{ Text: text }])
  })
  
  const data = await response.json()
  return data[0]?.translations[0]?.text || text
}

export async function translateYandex(text: string, targetLang: string = 'zh-CN'): Promise<string> {
  const lang = `en-${targetLang}`
  const response = await fetch('https://translate.toil.cc/v2/translate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, service: 'yandexgpt', text })
  })
  
  const data = await response.json()
  return data.translations?.[0] || text
}

export async function translateAIFree(text: string, targetLang: string = 'zh-CN'): Promise<string> {
  const isChinese = /[\u4e00-\u9fa5]/.test(text)
  const lang = isChinese ? `zh-CN-${targetLang}` : `en-${targetLang}`
  const response = await fetch('https://translate.toil.cc/v2/translate/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, service: 'chatgpt', text })
  })
  const data = await response.json()
  return data.translations?.[0] || text
}

export async function translateAISiyuan(text: string, targetLang: string = 'zh-CN'): Promise<string> {
  const hideProgress = () => {
    const el = document.querySelector('#progress:has(.b3-dialog__loading)')
    if (el) el.remove()
    else requestAnimationFrame(hideProgress)
  }
  hideProgress()
  
  const langMap: Record<string, string> = {
    'zh-CN': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어',
    'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский'
  }
  const targetName = langMap[targetLang] || targetLang
  const response = await fetch('/api/ai/chatGPT', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg: `请将以下文本翻译成${targetName}，只返回译文，不要解释：\n\n${text}` })
  })
  const data = await response.json()
  if (data.code !== 0) throw new Error(data.msg || '翻译失败')
  return data.data || text
}

export const translators = {
  google: { name: 'Google', translate: translateGoogle },
  azure: { name: 'Azure', translate: translateAzure },
  yandex: { name: 'Yandex', translate: translateYandex },
  'ai-free': { name: 'AI翻译(免费)', translate: translateAIFree },
  ai: { name: 'AI翻译(思源)', translate: translateAISiyuan }
}
