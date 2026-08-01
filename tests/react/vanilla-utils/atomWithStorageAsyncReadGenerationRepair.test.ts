import { describe, expect, it } from 'vitest'
import { createJSONStorage } from 'jotai/vanilla/utils'

type StoredValue = {
  nested: {
    count: number
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const encoded = (count: number) => JSON.stringify({ nested: { count } })

const createDeferredStorage = () => {
  const reads: Deferred<string | null>[] = []
  const storage = createJSONStorage<StoredValue>(() => ({
    getItem: () => {
      const read = deferred<string | null>()
      reads.push(read)
      return read.promise
    },
    setItem: async () => {},
    removeItem: async () => {},
  }))
  return { reads, storage }
}

describe('createJSONStorage async read generation repair', () => {
  it('keeps the newer same-key completion authoritative', async () => {
    const { reads, storage } = createDeferredStorage()

    const olderRead = storage.getItem('alpha', { nested: { count: -1 } })
    const newerRead = storage.getItem('alpha', { nested: { count: -2 } })

    reads[1]!.resolve(encoded(2))
    const newerValue = await newerRead
    reads[0]!.resolve(encoded(1))
    const olderValue = await olderRead

    const currentRead = storage.getItem('alpha', { nested: { count: -3 } })
    reads[2]!.resolve(encoded(2))
    const currentValue = await currentRead

    expect(olderValue).toEqual({ nested: { count: 1 } })
    expect(currentValue).toBe(newerValue)
  })

  it('prevents a pre-removal read from repopulating cache authority', async () => {
    const { reads, storage } = createDeferredStorage()

    const preRemovalRead = storage.getItem('alpha', {
      nested: { count: -1 },
    })
    await storage.removeItem('alpha')

    reads[0]!.resolve(encoded(1))
    const staleValue = await preRemovalRead

    const restoredRead = storage.getItem('alpha', {
      nested: { count: -2 },
    })
    reads[1]!.resolve(encoded(1))
    const restoredValue = await restoredRead

    const repeatedRead = storage.getItem('alpha', {
      nested: { count: -3 },
    })
    reads[2]!.resolve(encoded(1))
    const repeatedValue = await repeatedRead

    expect(restoredValue).not.toBe(staleValue)
    expect(repeatedValue).toBe(restoredValue)
  })

  it('prevents an older valid read from restoring authority after newer missing storage', async () => {
    const { reads, storage } = createDeferredStorage()

    const olderRead = storage.getItem('alpha', { nested: { count: -1 } })
    const newerRead = storage.getItem('alpha', { nested: { count: -2 } })

    reads[1]!.resolve(null)
    const newerValue = await newerRead
    reads[0]!.resolve(encoded(1))
    const olderValue = await olderRead

    const restoredRead = storage.getItem('alpha', {
      nested: { count: -3 },
    })
    reads[2]!.resolve(encoded(1))
    const restoredValue = await restoredRead

    const repeatedRead = storage.getItem('alpha', {
      nested: { count: -4 },
    })
    reads[3]!.resolve(encoded(1))
    const repeatedValue = await repeatedRead

    expect(newerValue).toEqual({ nested: { count: -2 } })
    expect(restoredValue).not.toBe(olderValue)
    expect(repeatedValue).toBe(restoredValue)
  })

  it('prevents an older valid read from restoring authority after newer malformed JSON', async () => {
    const { reads, storage } = createDeferredStorage()

    const olderRead = storage.getItem('alpha', { nested: { count: -1 } })
    const newerRead = storage.getItem('alpha', { nested: { count: -2 } })

    reads[1]!.resolve('{malformed')
    const newerValue = await newerRead
    reads[0]!.resolve(encoded(1))
    const olderValue = await olderRead

    const restoredRead = storage.getItem('alpha', {
      nested: { count: -3 },
    })
    reads[2]!.resolve(encoded(1))
    const restoredValue = await restoredRead

    const repeatedRead = storage.getItem('alpha', {
      nested: { count: -4 },
    })
    reads[3]!.resolve(encoded(1))
    const repeatedValue = await repeatedRead

    expect(newerValue).toEqual({ nested: { count: -2 } })
    expect(restoredValue).not.toBe(olderValue)
    expect(repeatedValue).toBe(restoredValue)
  })

  it('prevents a stale malformed completion from deleting newer valid identity', async () => {
    const { reads, storage } = createDeferredStorage()

    const olderRead = storage.getItem('alpha', { nested: { count: -1 } })
    const newerRead = storage.getItem('alpha', { nested: { count: -2 } })

    reads[1]!.resolve(encoded(2))
    const newerValue = await newerRead
    reads[0]!.resolve('{malformed')
    const olderValue = await olderRead

    const currentRead = storage.getItem('alpha', { nested: { count: -3 } })
    reads[2]!.resolve(encoded(2))
    const currentValue = await currentRead

    expect(olderValue).toEqual({ nested: { count: -1 } })
    expect(currentValue).toBe(newerValue)
  })

  it('keeps an unrelated key stable through same-key completion reordering', async () => {
    const { reads, storage } = createDeferredStorage()

    const firstBetaRead = storage.getItem('beta', { nested: { count: -1 } })
    reads[0]!.resolve(encoded(9))
    const firstBeta = await firstBetaRead

    const olderAlphaRead = storage.getItem('alpha', {
      nested: { count: -2 },
    })
    const newerAlphaRead = storage.getItem('alpha', {
      nested: { count: -3 },
    })
    reads[2]!.resolve(encoded(2))
    await newerAlphaRead
    reads[1]!.resolve(encoded(1))
    await olderAlphaRead

    const secondBetaRead = storage.getItem('beta', {
      nested: { count: -4 },
    })
    reads[3]!.resolve(encoded(9))
    const secondBeta = await secondBetaRead

    expect(secondBeta).toBe(firstBeta)
  })

  it('keeps cached identity after a newer read rejects and an older read resolves', async () => {
    const { reads, storage } = createDeferredStorage()

    const seedRead = storage.getItem('alpha', { nested: { count: -1 } })
    reads[0]!.resolve(encoded(1))
    const seededValue = await seedRead

    const olderRead = storage.getItem('alpha', { nested: { count: -2 } })
    const newerRead = storage.getItem('alpha', { nested: { count: -3 } })

    reads[2]!.reject(new Error('read failed'))
    await expect(newerRead).rejects.toThrow('read failed')
    reads[1]!.resolve(encoded(2))
    await olderRead

    const currentRead = storage.getItem('alpha', { nested: { count: -4 } })
    reads[3]!.resolve(encoded(1))
    expect(await currentRead).toBe(seededValue)
  })

  it('prevents an older successful read from establishing empty cache after a newer rejection', async () => {
    const { reads, storage } = createDeferredStorage()

    const olderRead = storage.getItem('alpha', { nested: { count: -1 } })
    const newerRead = storage.getItem('alpha', { nested: { count: -2 } })

    reads[1]!.reject(new Error('read failed'))
    await expect(newerRead).rejects.toThrow('read failed')
    reads[0]!.resolve(encoded(2))
    const olderValue = await olderRead

    const laterRead = storage.getItem('alpha', { nested: { count: -3 } })
    reads[2]!.resolve(encoded(2))
    const laterValue = await laterRead

    expect(laterValue).not.toBe(olderValue)
  })

  it('allows a later successful read to establish identity after a rejection', async () => {
    const { reads, storage } = createDeferredStorage()

    const rejectedRead = storage.getItem('alpha', { nested: { count: -1 } })
    reads[0]!.reject(new Error('read failed'))
    await expect(rejectedRead).rejects.toThrow('read failed')

    const successfulRead = storage.getItem('alpha', {
      nested: { count: -2 },
    })
    reads[1]!.resolve(encoded(3))
    const successfulValue = await successfulRead

    const repeatedRead = storage.getItem('alpha', {
      nested: { count: -3 },
    })
    reads[2]!.resolve(encoded(3))
    expect(await repeatedRead).toBe(successfulValue)
  })

  it('keeps rejection caller-visible without mutating unrelated-key identity', async () => {
    const { reads, storage } = createDeferredStorage()

    const firstBetaRead = storage.getItem('beta', { nested: { count: -1 } })
    reads[0]!.resolve(encoded(9))
    const firstBeta = await firstBetaRead

    const rejectedRead = storage.getItem('alpha', { nested: { count: -2 } })
    reads[1]!.reject(new Error('read failed'))
    await expect(rejectedRead).rejects.toThrow('read failed')

    const secondBetaRead = storage.getItem('beta', {
      nested: { count: -3 },
    })
    reads[2]!.resolve(encoded(9))
    expect(await secondBetaRead).toBe(firstBeta)
  })

  it('preserves same-string identity when a stale caller resolves with current bytes', async () => {
    const { reads, storage } = createDeferredStorage()

    const olderRead = storage.getItem('alpha', { nested: { count: -1 } })
    const newerRead = storage.getItem('alpha', { nested: { count: -2 } })

    reads[1]!.resolve(encoded(4))
    const newerValue = await newerRead
    reads[0]!.resolve(encoded(4))
    const olderValue = await olderRead

    expect(olderValue).toBe(newerValue)
  })
})
