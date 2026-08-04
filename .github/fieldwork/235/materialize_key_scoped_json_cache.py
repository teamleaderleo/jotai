from pathlib import Path

SOURCE = Path("src/vanilla/utils/atomWithStorage.ts")
TEST = Path("tests/react/vanilla-utils/atomWithStorageKeyIsolation.test.ts")

source = SOURCE.read_text(encoding="utf-8")
old = """  let lastStr: string | undefined
  let lastValue: Value

  const storage: AsyncStorage<Value> | SyncStorage<Value> = {
    getItem: (key, initialValue) => {
      const parse = (str: string | null) => {
        str = str || ''
        if (lastStr !== str) {
          try {
            lastValue = JSON.parse(str, options?.reviver)
          } catch {
            return initialValue
          }
          lastStr = str
        }
        return lastValue
      }
      const str = getStringStorage()?.getItem(key) ?? null
      if (isPromiseLike(str)) {
        return str.then(parse) as never
      }
      return parse(str) as never
    },
    setItem: (key, newValue) =>
      getStringStorage()?.setItem(
        key,
        JSON.stringify(newValue, options?.replacer),
      ),
    removeItem: (key) => getStringStorage()?.removeItem(key),
  }
"""
new = """  const cachedValues = new Map<string, { str: string; value: Value }>()

  const storage: AsyncStorage<Value> | SyncStorage<Value> = {
    getItem: (key, initialValue) => {
      const parse = (str: string | null) => {
        str = str || ''
        const cached = cachedValues.get(key)
        if (cached?.str === str) {
          return cached.value
        }
        try {
          const value = JSON.parse(str, options?.reviver) as Value
          cachedValues.set(key, { str, value })
          return value
        } catch {
          cachedValues.delete(key)
          return initialValue
        }
      }
      const str = getStringStorage()?.getItem(key) ?? null
      if (isPromiseLike(str)) {
        return str.then(parse) as never
      }
      return parse(str) as never
    },
    setItem: (key, newValue) =>
      getStringStorage()?.setItem(
        key,
        JSON.stringify(newValue, options?.replacer),
      ),
    removeItem: (key) => {
      const invalidate = () => {
        cachedValues.delete(key)
      }
      const stringStorage = getStringStorage()
      if (!stringStorage) {
        invalidate()
        return
      }
      try {
        const result = stringStorage.removeItem(key)
        if (isPromiseLike(result)) {
          return result.then(
            () => {
              invalidate()
            },
            (error) => {
              invalidate()
              throw error
            },
          ) as never
        }
        invalidate()
        return result
      } catch (error) {
        invalidate()
        throw error
      }
    },
  }
"""

if source.count(old) != 1:
    raise SystemExit(f"expected one JSON cache block, found {source.count(old)}")
SOURCE.write_text(source.replace(old, new, 1), encoding="utf-8")

TEST.parent.mkdir(parents=True, exist_ok=True)
TEST.write_text(
    """import { describe, expect, it } from 'vitest'
import { createJSONStorage } from 'jotai/vanilla/utils'

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
    const storage = createJSONStorage<StoredValue>(() =>
      available ? stringStorage : undefined,
    )

    const alpha = storage.getItem('alpha', initial(-1))
    available = false
    expect(storage.getItem('alpha', initial(-2))).toEqual(initial(-2))
    available = true
    expect(storage.getItem('alpha', initial(-3))).not.toBe(alpha)
  })
})
""",
    encoding="utf-8",
)
