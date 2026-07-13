import type { ThemeConfig, ThemePreference } from '@embedpdf/vue-pdf-viewer'
import { PRESET_THEMES, type ReadTheme } from '@/composables/useSetting'

const darkThemes = new Set(['dark', 'night', 'gold'])
const root = () => document.documentElement
const cssVar = (name: string, fallback: string, el: Element = root()) =>
  (getComputedStyle(el).getPropertyValue(name).trim() || getComputedStyle(root()).getPropertyValue(name).trim() || fallback)
const cssVarValue = (value: string, el?: Element) =>
  value.startsWith('var(') ? cssVar(value.slice(4, -1), value, el) : value

const isDarkColor = (color = '') => {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  const parts = hex
    ? (hex.length === 3 ? [...hex].map(c => Number.parseInt(c + c, 16)) : [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16)))
    : color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number)
  return !!parts && (parts[0] * 299 + parts[1] * 587 + parts[2] * 114) / 1000 < 128
}

export const embedPdfThemePreference = (theme = '', el?: Element): ThemePreference => {
  if (darkThemes.has(theme)) return 'dark'
  if (['default', 'almond', 'autumn', 'green', 'blue'].includes(theme)) return 'light'
  const mode = [root().dataset.themeMode, root().className, document.body?.className].join(' ')
  return /dark/i.test(mode) || isDarkColor(cssVar('--b3-theme-background', '#ffffff', el)) ? 'dark' : 'light'
}

export const buildEmbedPdfTheme = (theme = '', el?: Element, customTheme?: ReadTheme): ThemeConfig => {
  const preference = embedPdfThemePreference(theme, el)
  const readTheme = theme === 'custom' ? customTheme : PRESET_THEMES[theme]
  const bg = readTheme?.bg ? cssVarValue(readTheme.bg, el) : cssVar('--b3-theme-background', '#f3f4f6', el)
  const color = readTheme?.color ? cssVarValue(readTheme.color, el) : cssVar('--b3-theme-on-surface', '#111827', el)
  const surface = cssVar('--b3-theme-surface', bg, el)
  const surfaceAlt = cssVar('--b3-theme-background-light', bg, el)
  const primary = cssVar('--b3-theme-primary', '#3b82f6', el)
  const colors = {
    background: {
      app: bg,
      surface,
      surfaceAlt,
      elevated: surface,
      overlay: 'rgba(0,0,0,.45)',
      input: surfaceAlt,
    },
    foreground: {
      primary: color,
      secondary: cssVar('--b3-theme-on-surface-variant', '#374151', el),
      muted: cssVar('--b3-theme-on-surface-variant', '#6b7280', el),
      disabled: cssVar('--b3-theme-on-surface-light', '#9ca3af', el),
      onAccent: cssVar('--b3-theme-on-primary', '#ffffff', el),
    },
    border: { default: cssVar('--b3-border-color', '#d1d5db', el), subtle: cssVar('--b3-border-color', '#e5e7eb', el), strong: primary },
    accent: {
      primary,
      primaryHover: primary,
      primaryActive: primary,
      primaryLight: cssVar('--b3-theme-primary-lightest', surfaceAlt, el),
      primaryForeground: cssVar('--b3-theme-on-primary', '#ffffff', el),
    },
  }
  return { preference, light: colors, dark: colors }
}
