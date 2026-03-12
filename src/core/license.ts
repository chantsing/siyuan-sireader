/**
 * 思阅授权管理 - 极简版
 */

export interface LicenseInfo {
  userId: string
  userName: string
  type: string
  activatedAt: number
  expiresAt: number
  features: string[]
  daysRemaining?: number
  lastVerified?: number
}

// 功能权限定义（未定义=免费）
const PAID_FEATURES: Record<string, string> = {
  // 阅读功能
  'reader-theme': 'trial',      // 主题配色
  'reader-stats': 'trial',      // 阅读统计
  
  // 标注功能
  'quick-mark': 'annual',       // 快速标注
  'quick-send': 'annual',       // 快捷发送
  
  // 书架功能
  'folder-group': 'trial',      // 文件夹分组
  'smart-group': 'monthly',     // 智能分组
  'book-edit': 'trial',         // 书籍编辑
  'batch-operation': 'trial',   // 批量操作
  'advanced-add': 'trial',      // 高级添加方式
  'doc-assets': 'monthly',      // 文档assets同步
  
  // 搜书功能
  'book-search': 'monthly',     // 在线搜书
  
  // TTS功能
  'tts': 'trial',               // TTS基础功能
  'tts-online': 'monthly',      // 在线语音
  
  // 翻译功能
  'translate': 'trial',         // 翻译功能
  
  // 词典功能
  'dict-offline': 'trial',      // 离线词典
  'dict-advanced': 'trial',     // 高级词典（剑桥/海词/汉字/词语/汉典）
  'dict-deck': 'trial',         // 加入卡组
  
  // 同步功能
  'siyuan-sync': 'monthly',     // 思源同步
  
  // 闪卡功能
  'fsrs': 'annual',             // FSRS算法
}

// 会员等级
const LEVELS: Record<string, number> = { free: 0, trial: 1, monthly: 2, annual: 3, lifetime: 4 }

export class LicenseManager {
  private static readonly API = 'https://api.745201.xyz'
  private static readonly KEY = 'sireader_license'
  private static readonly REFRESH_DAYS = 7

  // 检查权限
  static can(feature: string, license: LicenseInfo | null): boolean {
    const required = PAID_FEATURES[feature]
    if (!required) return true
    if (!license || (license.expiresAt > 0 && license.expiresAt < Date.now())) return false
    return LEVELS[license.type] >= LEVELS[required]
  }

  // 激活
  static async activate(code: string, plugin: any) {
    const user = await this.getUser()
    if (!user) return { success: false, error: '请先登录思源账号' }

    try {
      const res = await fetch(`${this.API}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase(), userId: user.userId, userName: user.userName })
      })

      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error || '激活失败' }

      const license: LicenseInfo = { userId: user.userId, userName: user.userName, ...data, lastVerified: Date.now() }
      await this.save(license, new Date().toDateString(), plugin)

      return { success: true, message: '激活成功', license: this.enrich(license) }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '激活失败' }
    }
  }

  // 验证
  static async verify(plugin: any): Promise<boolean> {
    const data = await this.load(plugin)
    if (!data) return false

    const { license, lastReport } = data
    if (this.needRefresh(license)) return await this.refresh(license, plugin)

    this.reportDaily(license, lastReport, plugin).catch(() => {})
    return true
  }

  // 刷新
  private static async refresh(license: LicenseInfo, plugin: any): Promise<boolean> {
    try {
      const res = await fetch(`${this.API}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: license.userId })
      })

      const data = await res.json()
      if (!res.ok) return false

      Object.assign(license, data, { lastVerified: Date.now() })
      await this.save(license, new Date().toDateString(), plugin)
      return true
    }
    catch { return false }
  }

  // 每日上报
  private static async reportDaily(license: LicenseInfo, lastReport: string, plugin: any) {
    if (lastReport !== new Date().toDateString()) await this.refresh(license, plugin)
  }

  // 需要刷新
  private static needRefresh(license: LicenseInfo): boolean {
    return (license.expiresAt > 0 && license.expiresAt < Date.now()) || 
           (license.lastVerified && Date.now() - license.lastVerified > this.REFRESH_DAYS * 86400000)
  }

  // 保存（加密）
  private static async save(license: LicenseInfo, lastReport: string, plugin: any) {
    const key = await this.deriveKey(license.userId)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(license))
    )

    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    await plugin.saveData(this.KEY, { 
      encrypted: btoa(String.fromCharCode(...combined)),
      lastReport
    })
  }

  // 读取（解密）
  private static async load(plugin: any): Promise<{ license: LicenseInfo, lastReport: string } | null> {
    try {
      const data = await plugin.loadData(this.KEY)
      if (!data?.encrypted) return null

      const user = await this.getUser()
      if (!user) return null

      const key = await this.deriveKey(user.userId)
      const combined = Uint8Array.from(atob(data.encrypted), c => c.charCodeAt(0))
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: combined.slice(0, 12) },
        key,
        combined.slice(12)
      )

      return { license: JSON.parse(new TextDecoder().decode(decrypted)), lastReport: data.lastReport || '' }
    }
    catch { return null }
  }

  // 派生密钥
  private static async deriveKey(userId: string) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(userId.slice(0, 32).padEnd(32, '0')),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('sireader-license'), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  // 获取用户
  private static async getUser(): Promise<{ userId: string, userName: string } | null> {
    try {
      const res = await fetch('/api/setting/getCloudUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (res.ok) {
        const { code, data } = await res.json()
        if (code === 0 && data?.userId) {
          return { userId: data.userId, userName: data.userName || data.userNickname || data.userId }
        }
      }
      return null
    }
    catch { return null }
  }

  // 获取头像
  static async getUserAvatar(): Promise<string | null> {
    try {
      const res = await fetch('/api/setting/getCloudUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      if (res.ok) {
        const { code, data } = await res.json()
        return (code === 0 && data?.userAvatarURL) ? data.userAvatarURL : null
      }
      return null
    }
    catch { return null }
  }

  // 丰富信息
  private static enrich(license: LicenseInfo): LicenseInfo {
    if (license.expiresAt > 0) {
      license.daysRemaining = Math.max(0, Math.floor((license.expiresAt - Date.now()) / 86400000))
    }
    return license
  }

  // 清除
  static async clear(plugin: any) {
    await plugin.saveData(this.KEY, null)
  }

  // 获取许可证
  static async getLicense(plugin: any): Promise<LicenseInfo | null> {
    await this.verify(plugin)
    const data = await this.load(plugin)
    return data ? this.enrich(data.license) : null
  }
}
