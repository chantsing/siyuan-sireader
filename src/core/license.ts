/**
 * SiReader license manager.
 *
 * The client keeps a persistent license snapshot and only talks to the
 * license service on activation, recovery, or low-frequency verification.
 */

import { loadData, removeData, saveData } from './bookStore'

export interface LicenseInfo {
  userId: string
  userName: string
  type: string
  activatedAt: number
  expiresAt: number
  features: string[]
  daysRemaining?: number
  lastVerified?: number
  nextVerifyAt?: number
  serverTime?: number
  signature?: string
  signatureAlg?: string
  licenseVersion?: number
}

type StoredLicense = {
  version?: number
  license?: LicenseInfo
  encrypted?: string
  lastReport?: string
}

// Undefined features are free.
const PAID_FEATURES: Record<string, string> = {
  'reader-theme': 'trial',
  'reader-stats': 'trial',
  'quick-mark': 'annual',
  'quick-send': 'annual',
  'folder-group': 'trial',
  'smart-group': 'monthly',
  'book-edit': 'trial',
  'batch-operation': 'trial',
  'doc-assets': 'monthly',
  'book-search': 'monthly',
  'tts': 'trial',
  'tts-online': 'monthly',
  'translate': 'trial',
  'dict-offline': 'trial',
  'dict-advanced': 'trial',
  'siyuan-sync': 'monthly',
}

const LEVELS: Record<string, number> = { free: 0, trial: 1, monthly: 2, annual: 3, lifetime: 4 }

export class LicenseManager {
  private static readonly API = 'https://api.745201.xyz'
  private static readonly KEY = 'sireader_license'
  private static readonly STORAGE_VERSION = 2
  private static readonly VERIFY_INTERVAL_DAYS = 30
  private static readonly EXPIRING_REFRESH_DAYS = 3
  private static readonly FAILED_RETRY_HOURS = 12
  private static verifyPromise: Promise<boolean> | null = null
  private static legacyRecoveryPromise: Promise<{ license: LicenseInfo, lastReport: string } | null> | null = null
  private static lastLegacyRecoveryAt = 0

  static can(feature: string, license: LicenseInfo | null): boolean {
    const required = PAID_FEATURES[feature]
    if (!required) return true
    if (!license || !this.isUsable(license)) return false
    return (LEVELS[license.type] || 0) >= (LEVELS[required] || 0)
  }

  static async activate(code: string) {
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

      const license = this.normalizeLicense({ userId: user.userId, userName: user.userName, ...data }, Date.now())
      await this.save(license, new Date().toDateString())

      return { success: true, message: '激活成功', license: this.enrich(license) }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '激活失败' }
    }
  }

  static async recover() {
    const user = await this.getUser()
    if (!user) return { success: false, error: '请先登录思源账号' }

    try {
      const res = await fetch(`${this.API}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId })
      })

      const data = await res.json()
      if (!res.ok) return { success: false, error: data.error || '未找到授权信息' }

      const license = this.normalizeLicense({ userId: user.userId, userName: user.userName, ...data }, Date.now())
      await this.save(license, new Date().toDateString())

      return { success: true, message: '恢复成功', license: this.enrich(license) }
    }
    catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '恢复失败' }
    }
  }

  static async verify(): Promise<boolean> {
    const data = await this.load()
    if (!data) return false

    const { license, lastReport } = data
    if (!this.needRefresh(license)) return this.isUsable(license)
    if (await this.refresh(license)) return true

    if (this.isUsable(license)) {
      license.nextVerifyAt = Date.now() + this.FAILED_RETRY_HOURS * 3600000
      await this.save(license, lastReport)
      return true
    }
    return false
  }

  static async getUserAvatar(): Promise<string | null> {
    const cachedUser = (globalThis as any)?.window?.siyuan?.user
    if (cachedUser?.userAvatarURL) return cachedUser.userAvatarURL
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

  static async clear() {
    await removeData(this.KEY)
  }

  static async getLicense(): Promise<LicenseInfo | null> {
    const data = await this.load()
    if (!data) return null
    this.queueVerifyIfNeeded(data.license)
    return this.enrich(data.license)
  }

  private static async refresh(license: LicenseInfo): Promise<boolean> {
    const now = Date.now()
    try {
      const res = await fetch(`${this.API}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: license.userId })
      })

      const data = await res.json()
      if (!res.ok) return false

      Object.assign(license, this.normalizeLicense({ ...license, ...data }, now))
      await this.save(license, new Date().toDateString())
      return true
    }
    catch { return false }
  }

  private static needRefresh(license: LicenseInfo): boolean {
    const now = Date.now()
    if (!license.lastVerified) return true
    if (license.nextVerifyAt && now >= license.nextVerifyAt) return true
    if (license.expiresAt > 0 && license.expiresAt <= now + this.EXPIRING_REFRESH_DAYS * 86400000) return true
    return now - license.lastVerified > this.VERIFY_INTERVAL_DAYS * 86400000
  }

  private static async save(license: LicenseInfo, lastReport: string) {
    await saveData(this.KEY, {
      version: this.STORAGE_VERSION,
      license: this.normalizeLicense(license),
      lastReport
    })
  }

  private static async load(): Promise<{ license: LicenseInfo, lastReport: string } | null> {
    try {
      const data = await loadData<StoredLicense>(this.KEY)
      if (!data) return null
      if (data.version === this.STORAGE_VERSION && data.license) {
        return { license: this.normalizeLicense(data.license), lastReport: data.lastReport || '' }
      }

      let legacy: { license: LicenseInfo, lastReport: string } | null = null
      try {
        legacy = await this.loadLegacy(data)
      }
      catch {}
      if (legacy) await this.save(legacy.license, legacy.lastReport)
      if (legacy) return legacy
      if (data.encrypted) return await this.recoverLegacy(data.lastReport || '')
      return null
    }
    catch { return null }
  }

  private static async loadLegacy(data: StoredLicense): Promise<{ license: LicenseInfo, lastReport: string } | null> {
    if (!data.encrypted) return null
    const user = await this.getUser()
    if (!user) return null

    const key = await this.deriveKey(user.userId)
    const combined = this.base64ToBytes(data.encrypted)
    const decrypted = await this.getCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv: combined.slice(0, 12) },
      key,
      combined.slice(12)
    )

    return { license: this.normalizeLicense(JSON.parse(new TextDecoder().decode(decrypted))), lastReport: data.lastReport || '' }
  }

  private static async recoverLegacy(lastReport: string): Promise<{ license: LicenseInfo, lastReport: string } | null> {
    if (this.legacyRecoveryPromise) return await this.legacyRecoveryPromise
    if (Date.now() - this.lastLegacyRecoveryAt < this.FAILED_RETRY_HOURS * 3600000) return null
    this.lastLegacyRecoveryAt = Date.now()
    this.legacyRecoveryPromise = this.doRecoverLegacy(lastReport).finally(() => {
      this.legacyRecoveryPromise = null
    })
    return await this.legacyRecoveryPromise
  }

  private static async doRecoverLegacy(lastReport: string): Promise<{ license: LicenseInfo, lastReport: string } | null> {
    const user = await this.getUser()
    if (!user) return null

    try {
      const res = await fetch(`${this.API}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.userId })
      })

      const data = await res.json()
      if (!res.ok) return null

      const license = this.normalizeLicense({ userId: user.userId, userName: user.userName, ...data }, Date.now())
      await this.save(license, lastReport)
      return { license, lastReport }
    }
    catch {
      return null
    }
  }

  private static queueVerifyIfNeeded(license: LicenseInfo) {
    if (!this.needRefresh(license) || this.verifyPromise) return
    this.verifyPromise = this.verify().finally(() => {
      this.verifyPromise = null
    })
  }

  private static async deriveKey(userId: string) {
    const subtle = this.getCrypto().subtle
    if (!subtle) throw new Error('WebCrypto is unavailable')
    const keyMaterial = await subtle.importKey(
      'raw',
      new TextEncoder().encode(userId.slice(0, 32).padEnd(32, '0')),
      'PBKDF2',
      false,
      ['deriveKey']
    )

    return subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('sireader-license'), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  }

  private static async getUser(): Promise<{ userId: string, userName: string } | null> {
    const cached = this.getCachedUser()
    if (cached) return cached
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

  private static enrich(license: LicenseInfo): LicenseInfo {
    if (license.expiresAt > 0) {
      license.daysRemaining = Math.max(0, Math.floor((license.expiresAt - Date.now()) / 86400000))
    }
    return license
  }

  private static normalizeLicense(license: LicenseInfo, verifiedAt?: number): LicenseInfo {
    const lastVerified = verifiedAt || license.lastVerified || Date.now()
    const nextVerifyAt = license.nextVerifyAt || lastVerified + this.VERIFY_INTERVAL_DAYS * 86400000
    return { ...license, lastVerified, nextVerifyAt }
  }

  private static isUsable(license: LicenseInfo): boolean {
    return license.expiresAt <= 0 || license.expiresAt > Date.now()
  }

  private static getCrypto(): Crypto {
    const c = (globalThis as any).crypto
    if (!c?.getRandomValues) throw new Error('Crypto is unavailable')
    return c as Crypto
  }

  private static base64ToBytes(value: string) {
    return Uint8Array.from(atob(value), c => c.charCodeAt(0))
  }

  private static getCachedUser(): { userId: string, userName: string } | null {
    const user = (globalThis as any)?.window?.siyuan?.user
    return user?.userId ? { userId: user.userId, userName: user.userName || user.userNickname || user.userId } : null
  }
}
