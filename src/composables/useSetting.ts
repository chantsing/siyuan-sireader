// ===== 阅读器设置管理 =====
import { ref, toRaw } from 'vue'
import { showMessage, fetchSyncPost } from 'siyuan'
import type { Plugin } from 'siyuan'

export type PdfToolbarStyle = 'float' | 'fixed'
export type PageAnimation = 'slide' | 'none'
export type ViewMode = 'single' | 'double' | 'scroll'
export type NavPosition = 'left' | 'right' | 'top' | 'bottom'
export type NavItem = { id: string; icon: string; tip: string; enabled: boolean; order: number }
export type DocInfo = { id: string; name: string; path: string; notebook: string }
export interface ReadTheme { name: string; color: string; bg: string; bgImg?: string }
export interface FontFileInfo { name: string; displayName: string }
export interface TextSettings { fontFamily: string; fontSize: number; letterSpacing: number; customFont: { fontFamily: string; fontFile: string } }
export interface ParagraphSettings { lineHeight: number; paragraphSpacing: number; textIndent: number }
export interface LayoutSettings { marginHorizontal: number; marginVertical: number; gap: number; headerFooterMargin: number; maxInlineSize?: number; maxBlockSize?: number }
export interface VisualSettings { brightness: number; contrast: number; sepia: number; saturate: number; invert: boolean }
export interface TTSVoice { name: string; displayName: string; locale: string; isLocal?: boolean }
export interface TTSSettings { enabled: boolean; voice: string; rate: number; autoTurnPage: boolean; highlightText: boolean; favoriteVoices: TTSVoice[] }
export interface ReaderSettings { enabled: boolean; openMode: 'newTab' | 'rightTab' | 'bottomTab' | 'newWindow'; navPosition: NavPosition; pageAnimation: PageAnimation; viewMode: ViewMode; theme: string; customTheme: ReadTheme; annotationMode: 'notebook' | 'document'; notebookId?: string; parentDoc?: DocInfo; linkFormat: string; pdfToolbarStyle: PdfToolbarStyle; bookshelfCoverSize: number; openDocAssets: boolean; toolbarOpacity: number; quickSendDocs?: DocInfo[]; navItems?: NavItem[]; textSettings: TextSettings; paragraphSettings: ParagraphSettings; layoutSettings: LayoutSettings; visualSettings: VisualSettings; tts?: TTSSettings }

// ===== 预设主题 =====
export const PRESET_THEMES: Record<string, ReadTheme> = { default: { name: 'themeDefault', color: '#202124', bg: '#ffffff' }, auto: { name: 'themeAuto', color: 'var(--b3-theme-on-background)', bg: 'var(--b3-theme-background)' }, almond: { name: 'themeAlmond', color: '#414441', bg: '#FAF9DE' }, autumn: { name: 'themeAutumn', color: '#414441', bg: '#FFF2E2' }, green: { name: 'themeGreen', color: '#414441', bg: '#E3EDCD' }, blue: { name: 'themeBlue', color: '#414441', bg: '#DCE2F1' }, night: { name: 'themeNight', color: '#fff6e6', bg: '#415062' }, dark: { name: 'themeDark', color: '#d5cecd', bg: '#414441' }, gold: { name: 'themeGold', color: '#b58931', bg: '#081010' } }

// ===== 工具 =====
const fixUrl = (u: string) => u[0] === '/' || u.startsWith('http') ? u : `/${u}`;
const msg = { success: (m: string) => showMessage(m, 2000, 'info'), error: (m: string) => showMessage(m, 3000, 'error') };
const getTheme = (s: ReaderSettings) => s.theme === 'custom' ? s.customTheme : PRESET_THEMES[s.theme];
const getFont = (t: TextSettings) => { const c = t.fontFamily === 'custom' && t.customFont.fontFamily; return { font: c ? `"${t.customFont.fontFamily}", sans-serif` : t.fontFamily || 'inherit', fontFace: c ? `@font-face{font-family:"${t.customFont.fontFamily}";src:url("/plugins/custom-fonts/${t.customFont.fontFile}")}` : '' }; };

export const applyTheme = (el: HTMLElement, s: ReaderSettings) => { const t = getTheme(s); if (!t) return; const img = t.bgImg; Object.assign(el.style, { color: t.color, backgroundColor: img ? 'transparent' : t.bg, backgroundImage: img ? `url("${fixUrl(img)}")` : '', backgroundSize: img ? 'cover' : '', backgroundPosition: img ? 'center' : '', backgroundRepeat: img ? 'no-repeat' : '' }); };

export const applyPageStyles = (iframe: HTMLIFrameElement, s: ReaderSettings) => { const doc = iframe.contentDocument; if (!doc?.body) return; const { textSettings: t, paragraphSettings: p, layoutSettings: l } = s; doc.querySelectorAll('style[data-sireader-page]').forEach(s => s.remove()); const { font, fontFace } = getFont(t); doc.head.appendChild(Object.assign(doc.createElement('style'), { 'data-sireader-page': 'true', textContent: `${fontFace}body{font-family:${font}!important;font-size:${t.fontSize}px!important;letter-spacing:${t.letterSpacing}em!important;padding:${l.marginVertical}px ${l.marginHorizontal}px!important}p,div{line-height:${p.lineHeight}!important;margin:${p.paragraphSpacing}em 0!important}p{text-indent:${p.textIndent}em!important}` })); };

// ===== 默认配置 =====
const DEFAULT_SETTINGS: ReaderSettings = { enabled: true, openMode: 'newTab', navPosition: 'top', pageAnimation: 'slide', viewMode: 'single', theme: 'auto', customTheme: { name: 'custom', color: '#202124', bg: '#ffffff' }, annotationMode: 'notebook', notebookId: '', parentDoc: undefined, linkFormat: '> [!NOTE] 📑 书名\n> [章节](链接) 文本\n> 截图\n> 笔记', pdfToolbarStyle: 'fixed', bookshelfCoverSize: 120, openDocAssets: true, toolbarOpacity: 70, quickSendDocs: [], textSettings: { fontFamily: 'inherit', fontSize: 16, letterSpacing: 0, customFont: { fontFamily: '', fontFile: '' } }, paragraphSettings: { lineHeight: 1.6, paragraphSpacing: 0.8, textIndent: 0 }, layoutSettings: { marginHorizontal: 40, marginVertical: 20, gap: 5, headerFooterMargin: 0 }, visualSettings: { brightness: 1, contrast: 1, sepia: 0, saturate: 1, invert: false }, tts: { enabled: false, voice: 'zh-CN-XiaoxiaoNeural', rate: 1.0, autoTurnPage: true, highlightText: true, favoriteVoices: [] } }

// ===== UI配置常量 =====
const r = (k: string, min: number, max: number, step: number, unit = '') => ({ key: k, type: 'range' as const, min, max, step, unit })
export const UI_CONFIG = { interfaceItems: [{ key: 'openMode', opts: ['newTab', 'rightTab', 'bottomTab', 'newWindow'] }, { key: 'navPosition', opts: ['left', 'right', 'top', 'bottom'] }, { key: 'viewMode', opts: ['single', 'double', 'scroll'] }, { key: 'pageAnimation', opts: ['slide', 'none'] }, { key: 'pdfToolbarStyle', opts: ['float', 'fixed'] }, r('bookshelfCoverSize', 80, 160, 10, 'px'), r('toolbarOpacity', 0, 100, 5, '%'), { key: 'openDocAssets', type: 'checkbox' as const }], customThemeItems: [{ key: 'color', label: 'textColor', type: 'color' }, { key: 'bg', label: 'bgColor', type: 'color' }, { key: 'bgImg', label: 'bgImage', type: 'text' }], appearanceGroups: [{ title: 'textSettings', items: [r('fontSize', 12, 32, 1, 'px'), r('letterSpacing', 0, 0.2, 0.01, 'em')] }, { title: 'paragraphSettings', items: [r('lineHeight', 1.0, 3.0, 0.1), r('paragraphSpacing', 0, 2, 0.1, 'em'), r('textIndent', 0, 4, 0.5, 'em')] }, { title: 'layoutSettings', items: [r('marginHorizontal', 0, 100, 5, 'px'), r('marginVertical', 0, 80, 5, 'px'), r('gap', 0, 20, 1, '%'), r('headerFooterMargin', 0, 60, 5, 'px'), r('maxInlineSize', 0, 2000, 50, 'px'), r('maxBlockSize', 0, 3000, 50, 'px')] }, { title: 'visualSettings', items: [r('brightness', 0.5, 1.5, 0.05), r('contrast', 0.5, 1.5, 0.05), r('sepia', 0, 1, 0.05), r('saturate', 0, 2, 0.1), { key: 'invert', type: 'checkbox' as const }] }], ttsItems: [{ key: 'enabled', type: 'checkbox' as const }, r('rate', 0.5, 2.0, 0.1, 'x')], ttsOptions: [{ key: 'autoTurnPage', type: 'checkbox' as const }, { key: 'highlightText', type: 'checkbox' as const }] }

// ===== 字体 =====
let cachedFonts: FontFileInfo[] | null = null;
export const scanCustomFonts = async (force = false): Promise<FontFileInfo[]> => { if (!force && cachedFonts) return cachedFonts; try { const r = await fetchSyncPost('/api/file/readDir', { path: '/data/plugins/custom-fonts' }); return cachedFonts = r?.code === 0 && Array.isArray(r.data) ? r.data.filter((f: any) => !f.isDir && /\.(ttf|otf|woff2?)$/i.test(f.name)).map((f: any) => ({ name: f.name, displayName: f.name.replace(/\.(ttf|otf|woff2?)$/i, '') })) : [] } catch { return cachedFonts = [] } };
export const loadFonts = (fonts: FontFileInfo[]) => { const s = document.getElementById('sr-fonts') || Object.assign(document.createElement('style'), { id: 'sr-fonts' }); s.parentNode || document.head.appendChild(s); s.textContent = fonts.map(f => `@font-face{font-family:"${f.displayName}";src:url("/plugins/custom-fonts/${f.name}")}`).join('') };
export const resetToDefaults = (s: any) => Object.assign(s, { textSettings: DEFAULT_SETTINGS.textSettings, paragraphSettings: DEFAULT_SETTINGS.paragraphSettings, layoutSettings: DEFAULT_SETTINGS.layoutSettings, visualSettings: DEFAULT_SETTINGS.visualSettings });

// ===== 链接格式化 =====
const applyTpl=(t:string,v:Record<string,string>)=>{const ph:Record<string,string>={};let i=0;Object.entries(v).forEach(([k,val])=>{const p=`\x00${i++}\x00`;ph[p]=val;k.split('|').forEach(s=>t=t.replace(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'),p))});return Object.entries(ph).reduce((r,[p,val])=>r.replace(new RegExp(p,'g'),val),t)}
export const formatBookLink=(u:string,t:string,a:string,c:string,f:string,x:string,fmt:string,n='',i='',id='')=>applyTpl(fmt,{'书名|{{title}}':t,'作者|{{author}}':a,'章节|{{chapter}}':c,'位置|{{location}}':f,'链接|{{url}}':id?`sireader://open?url=${u}_${id}&cfi=${f}`:`sireader://open?url=${u}&cfi=${f}`,'文本|{{text}}':x,'笔记|{{note}}':n,'截图|{{image}}':i}).replace(/> \n/g,'').replace(/\n\n+/g,'\n')
export const parseBookLink=(u:string):{bookUrl:string;cfi:string;id?:string}|null=>{try{const m=u.match(/^sireader:\/\/open\?(.+)$/);if(!m)return null;const p=new URLSearchParams(m[1].replace(/&amp;/g,'&'));let url=p.get('url'),c=p.get('cfi');if(!url||!c)return null;let id:string|undefined;const e=url.indexOf('://');if(e!==-1){const pt=url.slice(e+3);for(const r of[/_(highlight-[^_&]+)$/,/_(note-[^_&]+)$/,/_(shape_\d+_[^_&]+)$/,/_(ink_\d+_[^_&]+)$/,/_(bookmark-[^_&]+)$/,/_(vocab-[^_&]+)$/]){const mt=pt.match(r);if(mt){id=mt[1];url=url.slice(0,-(id.length+1));break}}}return{bookUrl:url,cfi:c,id}}catch{return null}}

// ===== 笔记本和文档管理 =====
export const loadNotebooks = async () => { const r = await fetchSyncPost('/api/notebook/lsNotebooks', {}); return r?.code === 0 ? r.data?.notebooks || [] : [] }
export const searchDocs = async (k: string) => { const r = await fetchSyncPost('/api/filetree/searchDocs', { k }); return r?.code === 0 && Array.isArray(r.data) ? r.data : [] }
export const createDocInfo = (d: any) => ({ id: d.id, name: d.hPath || d.content || '无标题', path: d.path || '', notebook: d.box || '' })
export const useDocSearch = () => { const s = ref({ input: '', results: [] as any[], show: false }); return { state: s, search: async () => { const k = s.value.input.trim(); if (k) (s.value.results = await searchDocs(k), s.value.show = true) }, select: (d: any, f: (doc: DocInfo) => void) => (f(createDocInfo(d)), s.value = { input: '', results: [], show: false }), reset: () => s.value = { input: '', results: [], show: false } } }
export const useNotebooks = () => { const n = ref<{ id: string; name: string; icon: string }[]>([]); return { notebooks: n, load: async () => !n.value.length && (n.value = await loadNotebooks()) } }
export const useConfirm = (f: () => void) => { const c = ref(false); return { confirming: c, handleClick: () => c.value ? (f(), c.value = false) : (c.value = true) } }

// ===== 设置管理 =====
const merge = (d: any, s: any): any => { const r = { ...d }; for (const k in s) if (s[k] !== undefined && s[k] !== null) r[k] = typeof s[k] === 'object' && !Array.isArray(s[k]) && d[k] ? merge(d[k], s[k]) : s[k]; return r; };
let db: any = null;
const getDB = async () => db || (db = await (await import('@/core/database')).getDatabase());
export const settingsManager = {
  get: async (): Promise<ReaderSettings> => { const s = await (await getDB()).getSetting('reader_settings'); return s ? merge(DEFAULT_SETTINGS, s) : { ...DEFAULT_SETTINGS }; },
  save: async (settings: ReaderSettings) => { await (await getDB()).saveSetting('reader_settings', JSON.parse(JSON.stringify(toRaw(settings)))); window.dispatchEvent(new CustomEvent('sireaderSettingsUpdated', { detail: settings })); }
};

// ===== useSetting =====
export function useSetting(plugin: Plugin) { 
  const settings = ref<ReaderSettings>({ ...DEFAULT_SETTINGS }), i18n = plugin.i18n as any, isLoaded = ref(false), customFonts = ref<FontFileInfo[]>([]), isLoadingFonts = ref(false);
  const load = async () => { try { settings.value = await settingsManager.get(), isLoaded.value = true } catch { settings.value = { ...DEFAULT_SETTINGS }, isLoaded.value = true } };
  const save = async () => { try { await settingsManager.save(settings.value), msg.success(i18n?.saved || '设置已保存') } catch { msg.error(i18n?.saveError || '保存失败') } };
  const loadCustomFonts = async (force = false) => { if (!force && customFonts.value.length) return; isLoadingFonts.value = true; try { customFonts.value = await scanCustomFonts(force); loadFonts(customFonts.value) } finally { isLoadingFonts.value = false } };
  const resetStyles = () => resetToDefaults(settings.value);
  load(); 
  return { settings, isLoaded, save, customFonts, isLoadingFonts, loadCustomFonts, resetStyles };
}
