import { describe, expect, it } from 'vitest'
import { createStore } from 'jotai/vanilla'
import { RESET, atomWithStorage } from 'jotai/vanilla/utils'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

describe('atomWithStorage promised write ordering', () => {
  it('allows an older promised update to overwrite a newer direct update', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    await store.set(countAtom, 2)

    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(1)
    expect(writes).toEqual([2, 1])
  })

  it('allows an older promised update to restore data after reset', async () => {
    const { removals, storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    await store.set(countAtom, RESET)

    expect(store.get(countAtom)).toBe(0)
    expect(removals()).toBe(1)
    expect(writes).toEqual([])

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(1)
    expect(removals()).toBe(1)
    expect(writes).toEqual([1])
  })

  it('orders promised updates by resolution instead of invocation', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()
    const newerValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    const newerWrite = store.set(countAtom, newerValue.promise)

    newerValue.resolve(2)
    await newerWrite
    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(1)
    expect(writes).toEqual([2, 1])
  })
})
