import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/Settings.vue'), 'utf8')
const licenseSource = readFileSync(resolve(process.cwd(), 'src/core/license.ts'), 'utf8')
const settingSource = readFileSync(resolve(process.cwd(), 'src/composables/useSetting.ts'), 'utf8')

describe('license QR presentation', () => {
  it('uses a fixed image container for the direct QR URL', () => {
    expect(source).toContain('sr-license-qr-frame')
    expect(source).toContain('<img v-else :src="qr.data"')
  })
  it('renders a bound free account as a basic plan instead of an unbound state', () => {
    expect(licenseSource).toContain("type: 'free'")
    expect(settingSource).toContain("type === 'free'")
    expect(settingSource).toContain('基础版')
    expect(licenseSource).toContain("license.type !== 'free'")
  })
})
