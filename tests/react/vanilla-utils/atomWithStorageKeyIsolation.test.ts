import { describe, expect, it } from 'vitest'
import { createJSONStorage } from 'jotai/vanilla/utils'
import type { SyncStringStorage } from 'jotai/vanilla/utils/atomWithStorage'

type StoredValue = { nested: { count: number } }

const encoded = (count: number) => JSON.stringify({ nested: { count } })
const initial = (count: number): StoredValue => ({ nested: { count } })

describe('createJSONStorage key-scoped identity', () => {
  it('preserves same-key identity without aliasing equal JSON across keys', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const alpha = storage.getItem('alpha', initial(-1))
    const beta = storage.getItem('beta', initial(-2))
    const alphaAgain = storage.getItem('alpha', initial(-3))

    expect(alphaAgain).toBe(alpha)
    expect(beta).not.toBe(alpha)
    alpha.nested.count = 99
    expect(beta).toEqual({ nested: { count: 1 } })
  })

  it('isolates equal JSON across keys with asynchronous storage', async () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
      removeItem: async (key) => {
        values.delete(key)
      },
    }))

    const alpha = await storage.getItem('alpha', initial(-1))
    const beta = await storage.getItem('beta', initial(-2))
    expect(await storage.getItem('alpha', initial(-3))).toBe(alpha)
    expect(beta).not.toBe(alpha)
  })

  it('runs a reviver once per key and reuses later same-key identity', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    let rootCalls = 0
    const storage = createJSONStorage<StoredValue>(
      () => ({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      }),
      {
        reviver: (key, value) => {
          if (key === '') rootCalls += 1
          return value
        },
      },
    )

    const alpha = storage.getItem('alpha', initial(-1))
    storage.getItem('beta', initial(-2))
    expect(storage.getItem('alpha', initial(-3))).toBe(alpha)
    expect(rootCalls).toBe(2)
  })

  it('invalidates only the synchronously removed key', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const alpha = storage.getItem('alpha', initial(-1))
    const beta = storage.getItem('beta', initial(-2))
    storage.removeItem('alpha')
    values.set('alpha', encoded(1))

    expect(storage.getItem('alpha', initial(-3))).not.toBe(alpha)
    expect(storage.getItem('beta', initial(-4))).toBe(beta)
  })

  it('invalidates identity when synchronous removal throws', () => {
    const values = new Map([['alpha', encoded(1)]])
    const error = new Error('remove failed')
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: () => {
        throw error
      },
    }))

    const alpha = storage.getItem('alpha', initial(-1))
    expect(() => storage.removeItem('alpha')).toThrow(error)
    expect(storage.getItem('alpha', initial(-2))).not.toBe(alpha)
  })

  it('preserves identity while async removal is pending, then invalidates', async () => {
    const values = new Map([['alpha', encoded(1)]])
    let release!: () => void
    const removal = new Promise<void>((resolve) => {
      release = () => {
        values.delete('alpha')
        resolve()
      }
    })
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
      removeItem: () => removal,
    }))

    const alpha = await storage.getItem('alpha', initial(-1))
    const pending = storage.removeItem('alpha')
    expect(await storage.getItem('alpha', initial(-2))).toBe(alpha)
    release()
    await pending
    values.set('alpha', encoded(1))
    expect(await storage.getItem('alpha', initial(-3))).not.toBe(alpha)
  })

  it('invalidates identity after asynchronous rejection', async () => {
    const values = new Map([['alpha', encoded(1)]])
    const error = new Error('acknowledgement lost')
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
      removeItem: async (key) => {
        values.delete(key)
        throw error
      },
    }))

    const alpha = await storage.getItem('alpha', initial(-1))
    await expect(storage.removeItem('alpha')).rejects.toThrow(error)
    values.set('alpha', encoded(1))
    expect(await storage.getItem('alpha', initial(-2))).not.toBe(alpha)
  })

  it('clears stale identity after missing or malformed storage', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const alpha = storage.getItem('alpha', initial(-1))
    const beta = storage.getItem('beta', initial(-2))
    values.delete('alpha')
    expect(storage.getItem('alpha', initial(-3))).toEqual(initial(-3))
    values.set('alpha', encoded(1))
    expect(storage.getItem('alpha', initial(-4))).not.toBe(alpha)

    const restoredAlpha = storage.getItem('alpha', initial(-5))
    values.set('alpha', '{malformed')
    expect(storage.getItem('alpha', initial(-6))).toEqual(initial(-6))
    values.set('alpha', encoded(1))
    expect(storage.getItem('alpha', initial(-7))).not.toBe(restoredAlpha)
    expect(storage.getItem('beta', initial(-8))).toBe(beta)
  })

  it('invalidates a cached key when storage becomes unavailable', () => {
    const values = new Map([['alpha', encoded(1)]])
    let available = true
    const stringStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    }
    const getStringStorage = () =>
      (available ? stringStorage : undefined) as SyncStringStorage
    const storage = createJSONStorage<StoredValue>(getStringStorage)

    const alpha = storage.getItem('alpha', initial(-1))
    available = false
    expect(storage.getItem('alpha', initial(-2))).toEqual(initial(-2))
    available = true
    expect(storage.getItem('alpha', initial(-3))).not.toBe(alpha)
  })
})
