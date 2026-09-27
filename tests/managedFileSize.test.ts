import { describe, expect, test } from 'vitest'
import { validateManagedFileSize } from '@/core/storage/types'

describe('managed file size validation', () => {
  test('accepts a missing HEAD content length', () => {
    expect(() => validateManagedFileSize('', 913821)).not.toThrow()
    expect(() => validateManagedFileSize(null, 913821)).not.toThrow()
  })

  test('rejects a reported size mismatch', () => {
    expect(() => validateManagedFileSize('10', 11)).toThrow('Managed file size mismatch')
  })
})
