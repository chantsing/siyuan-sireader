import { describe, expect, it, vi } from 'vitest'
vi.mock('siyuan', () => ({}), { virtual: true })
import { fileModificationTime } from '@/api'

describe('file modification timestamps', () => {
  it('returns a millisecond epoch timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1790660046000)
    expect(fileModificationTime()).toBe(1790660046000)
    vi.restoreAllMocks()
  })
})
