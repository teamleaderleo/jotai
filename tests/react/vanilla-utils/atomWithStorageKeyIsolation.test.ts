import { describe, expect, it } from 'vitest'
import { createJSONStorage } from 'jotai/vanilla/utils'

type StoredValue = {
  nested: {
    count: number
  }
}

const encoded = (count: number) => JSON.stringify({ nested: { count } })

describe('createJSONStorage key isolation', () => {
  it('preserves same-key identity across interleaved reads', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const firstAlpha = storage.getItem('alpha', { nested: { count: -1 } })
    const beta = storage.getItem('beta', { nested: { count: -2 } })
    const secondAlpha = storage.getItem('alpha', { nested: { count: -3 } })

    expect(secondAlpha).toBe(firstAlpha)
    expect(beta).not.toBe(firstAlpha)
  })

  it('does not share parsed objects between keys with equal JSON', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const alpha = storage.getItem('alpha', { nested: { count: -1 } })
    const beta = storage.getItem('beta', { nested: { count: -2 } })

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

    const alpha = await storage.getItem('alpha', { nested: { count: -1 } })
    const beta = await storage.getItem('beta', { nested: { count: -2 } })
    const alphaAgain = await storage.getItem('alpha', {
      nested: { count: -3 },
    })

    expect(alphaAgain).toBe(alpha)
    expect(beta).not.toBe(alpha)
  })

  it('runs the reviver once per key and preserves later same-key identity', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    let rootReviverCalls = 0
    const storage = createJSONStorage<StoredValue>(
      () => ({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      }),
      {
        reviver: (key, value) => {
          if (key === '') {
            rootReviverCalls += 1
          }
          return value
        },
      },
    )

    const alpha = storage.getItem('alpha', { nested: { count: -1 } })
    const beta = storage.getItem('beta', { nested: { count: -2 } })
    const alphaAgain = storage.getItem('alpha', { nested: { count: -3 } })

    expect(rootReviverCalls).toBe(2)
    expect(alphaAgain).toBe(alpha)
    expect(beta).not.toBe(alpha)
  })

  it('invalidates only the synchronously removed key cache', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const firstAlpha = storage.getItem('alpha', { nested: { count: -1 } })
    const firstBeta = storage.getItem('beta', { nested: { count: -2 } })

    storage.removeItem('alpha')
    values.set('alpha', encoded(1))

    const secondAlpha = storage.getItem('alpha', { nested: { count: -3 } })
    const secondBeta = storage.getItem('beta', { nested: { count: -4 } })

    expect(secondAlpha).not.toBe(firstAlpha)
    expect(secondBeta).toBe(firstBeta)
  })

  it('invalidates cached identity when synchronous removal throws', () => {
    const values = new Map([['alpha', encoded(1)]])
    const removalError = new Error('remove failed')
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: () => {
        throw removalError
      },
    }))

    const firstAlpha = storage.getItem('alpha', { nested: { count: -1 } })

    expect(() => storage.removeItem('alpha')).toThrow(removalError)
    expect(storage.getItem('alpha', { nested: { count: -2 } })).not.toBe(
      firstAlpha,
    )
  })

  it('invalidates cached identity when asynchronous removal rejects', async () => {
    const values = new Map([['alpha', encoded(1)]])
    const removalError = new Error('remove failed')
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
      removeItem: async () => {
        throw removalError
      },
    }))

    const firstAlpha = await storage.getItem('alpha', {
      nested: { count: -1 },
    })

    await expect(storage.removeItem('alpha')).rejects.toThrow(removalError)
    expect(await storage.getItem('alpha', { nested: { count: -2 } })).not.toBe(
      firstAlpha,
    )
  })

  it('preserves identity while async removal is pending, then invalidates', async () => {
    const values = new Map([['alpha', encoded(1)]])
    let finishRemoval: (() => void) | undefined
    const removal = new Promise<void>((resolve) => {
      finishRemoval = () => {
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

    const firstAlpha = await storage.getItem('alpha', {
      nested: { count: -1 },
    })
    const pendingRemoval = storage.removeItem('alpha')

    expect(await storage.getItem('alpha', { nested: { count: -2 } })).toBe(
      firstAlpha,
    )

    finishRemoval?.()
    await pendingRemoval
    values.set('alpha', encoded(1))

    expect(await storage.getItem('alpha', { nested: { count: -3 } })).not.toBe(
      firstAlpha,
    )
  })

  it('does not resurrect identity after commit-then-reject removal', async () => {
    const values = new Map([['alpha', encoded(1)]])
    const removalError = new Error('acknowledgement lost')
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
      removeItem: async (key) => {
        values.delete(key)
        throw removalError
      },
    }))

    const firstAlpha = await storage.getItem('alpha', {
      nested: { count: -1 },
    })

    await expect(storage.removeItem('alpha')).rejects.toThrow(removalError)
    values.set('alpha', encoded(1))

    expect(await storage.getItem('alpha', { nested: { count: -2 } })).not.toBe(
      firstAlpha,
    )
  })

  it('clears only the settled asynchronous removal key', async () => {
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

    const firstAlpha = await storage.getItem('alpha', {
      nested: { count: -1 },
    })
    const firstBeta = await storage.getItem('beta', {
      nested: { count: -2 },
    })

    await storage.removeItem('alpha')
    values.set('alpha', encoded(1))

    const secondAlpha = await storage.getItem('alpha', {
      nested: { count: -3 },
    })
    const secondBeta = await storage.getItem('beta', {
      nested: { count: -4 },
    })

    expect(secondAlpha).not.toBe(firstAlpha)
    expect(secondBeta).toBe(firstBeta)
  })
})
