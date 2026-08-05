import { describe, expect, it } from 'vitest'
import { createStore } from 'jotai/vanilla'
import { atomWithStorage } from 'jotai/vanilla/utils'

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
  const storage = {
    getItem: async (_key: string, initialValue: number) => initialValue,
    setItem: async (_key: string, value: number) => {
      writes.push(value)
    },
    removeItem: async () => {},
  }
  return { storage, writes }
}

describe('atomWithStorage promised write authority split', () => {
  it('keeps state authority local to each store and storage authority shared', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const firstStore = createStore()
    const secondStore = createStore()
    const firstValue = deferred<number>()

    const firstWrite = firstStore.set(countAtom, firstValue.promise)
    await secondStore.set(countAtom, 2)

    firstValue.resolve(1)
    await firstWrite

    expect(firstStore.get(countAtom)).toBe(1)
    expect(secondStore.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })

  it('keeps a nested later write authoritative over an outer promised updater', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const outerValue = deferred<number>()
    let nestedWrite: Promise<void> | undefined

    const outerWrite = store.set(countAtom, (currentValue) => {
      expect(currentValue).toBe(0)
      nestedWrite = store.set(countAtom, 2)
      return outerValue.promise
    })

    await nestedWrite
    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])

    outerValue.resolve(1)
    await outerWrite

    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })

  it('keeps a nested later write authoritative over an outer direct updater', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    let nestedWrite: Promise<void> | undefined

    const outerWrite = store.set(countAtom, (currentValue) => {
      expect(currentValue).toBe(0)
      nestedWrite = store.set(countAtom, 2)
      return 1
    })

    await nestedWrite
    await outerWrite

    expect(store.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })

  it('allocates authority before a throwing updater runs', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()
    const olderValue = deferred<number>()

    const olderWrite = store.set(countAtom, olderValue.promise)
    expect(() =>
      store.set(countAtom, () => {
        throw new Error('newer updater failed')
      }),
    ).toThrow('newer updater failed')

    olderValue.resolve(1)
    await olderWrite

    expect(store.get(countAtom)).toBe(0)
    expect(writes).toEqual([])
  })
})
