import { describe, expect, it } from 'vitest'
import { createStore } from 'jotai/vanilla'
import { RESET, atomWithStorage } from 'jotai/vanilla/utils'

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

const deferred = <T>(): Deferred<T> => {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

const createStorage = () => {
  const writes: number[] = []
  let removals = 0
  const storage = {
    getItem: async (_key: string, initialValue: number) => initialValue,
    setItem: async (_key: string, value: number) => {
      writes.push(value)
    },
    removeItem: async () => {
      removals += 1
    },
  }
  return { removals: () => removals, storage, writes }
}

describe('atomWithStorage promised write generation', () => {
  it('keeps a newer direct update authoritative', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    await store.set(countAtom, 2)

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })

  it('keeps reset authoritative over an older promised update', async () => {
    const { removals, storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    await store.set(countAtom, RESET)

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(0)
    expect(removals()).toBe(1)
    expect(writes).toEqual([])
  })

  it('orders promised updates by invocation', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()
    const newerValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    const newerWrite = store.set(countAtom, newerValue.promise)

    newerValue.resolve(2)
    await newerWrite
    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })

  it('applies invocation authority to functional promised updates', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()

    const olderWrite = store.set(countAtom, (currentValue) => {
      expect(currentValue).toBe(0)
      return olderValue.promise
    })
    await store.set(countAtom, 2)

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })

  it('treats a newer rejected promise as a superseding invocation', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()
    const newerValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    const newerWrite = store.set(countAtom, newerValue.promise)

    newerValue.reject(new Error('newer update failed'))
    await expect(newerWrite).rejects.toThrow('newer update failed')

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(0)
    expect(writes).toEqual([])
  })

  it('keeps write generations local to each atom instance', async () => {
    const { storage, writes } = createStorage()
    const firstAtom = atomWithStorage('first', 0, storage)
    const secondAtom = atomWithStorage('second', 0, storage)
    const store = createStore()
    const firstValue = deferred<number>()

    const firstWrite = store.set(firstAtom, firstValue.promise)
    await store.set(secondAtom, 2)

    firstValue.resolve(1)
    await firstWrite

    expect(store.get(firstAtom)).toBe(1)
    expect(store.get(secondAtom)).toBe(2)
    expect(writes).toEqual([2, 1])
  })

  it('keeps stale rejection caller-visible without changing newer state', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    await store.set(countAtom, 2)

    olderValue.reject(new Error('older update failed'))
    await expect(olderWrite).rejects.toThrow('older update failed')

    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })
})
