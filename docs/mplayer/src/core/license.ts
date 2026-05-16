type LicensePayload = {
  userId: string;
  userName: string;
  type: string;
  activatedAt: number;
  expiresAt: number;
  features: string[];
  licenseVersion: number;
  lastVerifiedAt: number;
  signatureAlg?: 'ES256' | 'HS256';
};

export type LicenseInfo = LicensePayload & {
  signature: string;
  isValid: boolean;
};

type ActivateResult = {
  success: boolean;
  license?: LicenseInfo;
  message?: string;
  error?: string;
  isHtml?: boolean;
};

type StoredLicense = {
  encrypted?: string;
  lastReport?: string;
};

const LICENSE_PUBLIC_KEY_SPKI_BASE64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE4rNPyGs3sD+CseHSm0bPvXvwRXEDtdJuqfiz0tQ4bnaxDbHdvcKyQFHC4wmoCqatsVlT7Ou2chfFl/Lje/WKmA==';

export class LicenseManager {
  static cached: LicenseInfo | null = null;
  static LICENSE_FILE = 'license';
  static LICENSE_CACHE_KEY = 'siyuan-media-player-license-cache';
  // 授权服务接口地址（默认）
  static API_BASE = 'https://api.745201.xyz/simedia';
  // 校验刷新周期（毫秒）
  static REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000;
  // 离线宽限期（毫秒）
  static GRACE_PERIOD = 3 * 24 * 60 * 60 * 1000;
  static encryptionKey: ArrayBuffer | null = null;
  static hasSecureStorage() {
    return !!globalThis.crypto?.subtle;
  }

  static notifyPro() {
    try {
      ;(window as any).__mediaPlayerProRequired = true
      ;(window as any)._mediaPlayerOpenSetting?.()
      ;(window as any)._mediaPlayerOpenLicense?.()
      window.dispatchEvent(new CustomEvent('mediaPlayerProRequired'))
    } catch {}
  }

  static async activate(code = '', plugin: any): Promise<ActivateResult> {
    try {
      const cached = await this.load(plugin).catch(() => null);
      const trimmed = String(code || '').trim();
      if (trimmed) {
        cached && (await this.clear(plugin));
        // 激活码优先，成功后写入许可文件
        const license = await this.activateWithCode(trimmed);
        await this.save(license, plugin, this.today());
        return { success: true, license, message: '激活成功' };
      }
      if (cached) {
        return { success: true, license: cached, message: this.getStatusMessage(cached) };
      }
      // 无激活码时尝试恢复授权
      const recovered = await this.verifyFromServer();
      if (recovered) {
        await this.save(recovered, plugin, this.today());
        return { success: true, license: recovered, message: '授权已恢复' };
      }
      return { success: false, error: '未检测到有效授权' };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error || '激活失败') };
    }
  }

  static async load(plugin: any): Promise<LicenseInfo | null> {
    try {
      const raw = await plugin.loadData(this.LICENSE_FILE);
      const { license, lastReport } = await this.loadStored(raw);
      if (!license) return (this.cached = null), null;
      if (this.hasSecureStorage()) {
        const ok = await this.verifySignature(license);
        if (!ok) {
          await this.clear(plugin);
          return (this.cached = null), null;
        }
      }
      if (!this.isValid(license)) {
        await this.clear(plugin);
        return null;
      }
      // 有效许可则按需刷新，并每日上报一次
      const refreshed = await this.refreshIfNeeded(license, plugin).catch(() => null);
      if (!refreshed) {
        await this.clear(plugin);
        return (this.cached = null), null;
      }
      await this.reportDaily(refreshed, lastReport, plugin).catch(() => {});
      return (this.cached = refreshed), refreshed;
    } catch {
      return (this.cached = null), null;
    }
  }

  static async save(license: LicenseInfo, plugin: any, lastReport = '') {
    const stored: StoredLicense = this.hasSecureStorage()
      ? { encrypted: await this.encrypt(JSON.stringify(license)), lastReport }
      : { lastReport };
    if (this.hasSecureStorage()) this.clearLocalLicense();
    else this.saveLocalLicense(license);
    await plugin.saveData(this.LICENSE_FILE, stored, 2);
    this.cached = license;
  }

  static async clear(plugin: any) {
    await plugin.saveData(this.LICENSE_FILE, null, 2);
    this.clearLocalLicense();
    this.cached = null;
  }

  static isValid(license: LicenseInfo) {
    return !(license.expiresAt > 0 && license.expiresAt < Date.now());
  }

  static async refreshIfNeeded(license: LicenseInfo, plugin: any): Promise<LicenseInfo | null> {
    // 过期强制刷新
    if (license.expiresAt > 0 && license.expiresAt < Date.now()) {
      const fresh = await this.verifyFromServer();
      if (fresh) {
        await this.save(fresh, plugin, this.today());
        return fresh;
      }
      throw new Error('授权已过期，请重新校验');
    }
    // 未到刷新周期直接返回
    if (Date.now() - (license.lastVerifiedAt || 0) < this.REFRESH_INTERVAL) return license;
    try {
      const fresh = await this.verifyFromServer();
      if (!fresh) return license;
      await this.save(fresh, plugin, this.today());
      return fresh;
    } catch {
      if (Date.now() - (license.lastVerifiedAt || 0) <= this.GRACE_PERIOD) return license;
      throw new Error('授权已过期，请重新校验');
    }
  }

  static getStatusMessage(license: LicenseInfo) {
    const name = {
      trial: '体验会员',
      monthly: '月付会员',
      annual: '年付会员',
      lifetime: '恶龙会员',
    }[license.type] || license.type;
    if (license.expiresAt === 0) return `${name}已激活`;
    return `${name}已激活（到期：${new Date(license.expiresAt).toLocaleDateString()}）`;
  }

  static hasFeature(license: LicenseInfo | null, code: string) {
    return !!license?.features?.includes(code);
  }

  static can(code: string, license: LicenseInfo | null = this.cached) {
    if (!code) return true;
    if (!license) return false;
    if (!this.isValid(license)) return false;
    if (Array.isArray(license.features)) return license.features.includes(code);
    return true;
  }

  static async activateWithCode(code: string): Promise<LicenseInfo> {
    const user = await this.getSiYuanUserInfo();
    if (!user) throw new Error('请先登录思源账号');
    // 激活码绑定当前思源账号
    const response = await this.callApi('/activate', {
      code,
      userId: user.userId,
      userName: user.userName,
    });
    return this.normalizeLicense(response);
  }

  static async verifyFromServer(): Promise<LicenseInfo | null> {
    const user = await this.getSiYuanUserInfo();
    if (!user) return null;
    // 仅凭 userId 恢复或校验
    const response = await this.callApi('/verify', { userId: user.userId, userName: user.userName });
    return this.normalizeLicense(response);
  }

  static normalizeLicense(payload: any): LicenseInfo {
    const base = payload as LicensePayload;
    const license: LicenseInfo = {
      ...base,
      signature: String(payload?.signature || ''),
      signatureAlg: (payload?.signatureAlg || 'ES256') as any,
      isValid: this.isValid({
        ...(base as LicenseInfo),
        signature: String(payload?.signature || ''),
        isValid: true,
      }),
    };
    return license;
  }

  static async verifySignature(license: LicenseInfo): Promise<boolean> {
    if (!this.hasSecureStorage()) return true;
    if (!license.signature) return false;
    if (license.signatureAlg !== 'ES256') return false;
    if (!LICENSE_PUBLIC_KEY_SPKI_BASE64) return false;
    const data = this.serializePayload(license);
    const keyData = base64ToBytes(LICENSE_PUBLIC_KEY_SPKI_BASE64);
    const cryptoKey = await crypto.subtle.importKey(
      'spki',
      keyData,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      base64ToBytes(license.signature),
      new TextEncoder().encode(data),
    );
  }

  static serializePayload(license: LicensePayload) {
    const payload: LicensePayload = {
      userId: license.userId,
      userName: license.userName,
      type: license.type,
      activatedAt: license.activatedAt,
      expiresAt: license.expiresAt,
      features: license.features || [],
      licenseVersion: license.licenseVersion || 1,
      lastVerifiedAt: license.lastVerifiedAt,
      signatureAlg: license.signatureAlg || 'ES256',
    };
    return JSON.stringify(payload);
  }

  static async callApi(path: string, payload: Record<string, any>) {
    const url = `${this.API_BASE}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || `请求失败(${res.status})`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  static async reportDaily(license: LicenseInfo, lastReport: string, plugin: any) {
    const today = this.today();
    if (!license?.userId || lastReport === today) return;
    try {
      // 每天仅上报一次，降低 CF 压力
      await this.callApi('/report', { userId: license.userId });
      await this.save(license, plugin, today);
    } catch {
      // ignore report failure
    }
  }

  static async loadStored(raw: any): Promise<{ license: LicenseInfo | null; lastReport: string }> {
    if (!raw) return { license: this.loadLocalLicense(), lastReport: '' };

    if (typeof raw === 'string') {
      return { license: await this.parseLicense(raw), lastReport: '' };
    }

    if (typeof raw !== 'object') return { license: null, lastReport: '' };
    const stored = raw as Partial<StoredLicense>;
    const lastReport = stored.lastReport || '';

    if (!stored.encrypted) {
      return { license: this.loadLocalLicense(), lastReport };
    }
    return { license: await this.parseLicense(stored.encrypted), lastReport };
  }

  static async getEncryptionKey() {
    if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持安全存储');
    if (this.encryptionKey) return this.encryptionKey;
    this.encryptionKey = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('siyuan-media-player'),
    );
    return this.encryptionKey;
  }

  static async encrypt(text: string) {
    const key = await this.getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
    const buffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      new TextEncoder().encode(text),
    );
    const out = new Uint8Array(iv.length + buffer.byteLength);
    out.set(iv);
    out.set(new Uint8Array(buffer), iv.length);
    return btoa(String.fromCharCode(...out));
  }

  static async decrypt(input: string) {
    const bytes = new Uint8Array(
      [...atob(String(input).replace(/[^A-Za-z0-9+/=]/g, ''))].map((c) => c.charCodeAt(0)),
    );
    const iv = bytes.slice(0, 16);
    const data = bytes.slice(16);
    const key = await this.getEncryptionKey();
    const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
    const buffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
    return new TextDecoder().decode(buffer);
  }

  static async getSiYuanUserInfo() {
    try {
      if (window.siyuan?.user?.userId) {
        return {
          userId: window.siyuan.user.userId,
          userName: window.siyuan.user.userName || 'Unknown',
        };
      }
      // 兜底：走系统配置接口取用户
      const res = await fetch('/api/system/getConf');
      if (res.status === 200) {
        const text = await res.text();
        if (text.trim()) {
          const json = JSON.parse(text);
          if (json.code === 0 && json.data?.user) {
            return {
              userId: json.data.user.userId,
              userName: json.data.user.userName,
            };
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  static today() {
    // 以日期字符串做每日上报标记
    return new Date().toISOString().slice(0, 10);
  }

  static saveLocalLicense(license: LicenseInfo) {
    try {
      localStorage.setItem(this.LICENSE_CACHE_KEY, JSON.stringify(license));
    } catch {}
  }

  static loadLocalLicense(): LicenseInfo | null {
    try {
      const raw = localStorage.getItem(this.LICENSE_CACHE_KEY);
      return raw ? (JSON.parse(raw) as LicenseInfo) : null;
    } catch {
      return null;
    }
  }

  static clearLocalLicense() {
    try {
      localStorage.removeItem(this.LICENSE_CACHE_KEY);
    } catch {}
  }

  static async parseLicense(encrypted: string): Promise<LicenseInfo | null> {
    const decrypted = await this.decrypt(encrypted).catch(() => null);
    if (!decrypted) return null;
    try {
      return JSON.parse(decrypted) as LicenseInfo;
    } catch {
      return null;
    }
  }
}

function base64ToBytes(input: string) {
  const binary = atob(input.replace(/[\r\n\s]/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
