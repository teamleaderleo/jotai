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

describe('atomWithStorage promised write authority boundaries', () => {
  it('uses one write generation across independent stores', async () => {
    const { storage, writes } = createStorage()
    const countAtom = atomWithStorage('count', 0, storage)
    const firstStore = createStore()
    const secondStore = createStore()
    const firstValue = deferred<number>()

    const firstWrite = firstStore.set(countAtom, firstValue.promise)
    await secondStore.set(countAtom, 2)

    firstValue.resolve(1)
    await firstWrite

    // The counter belongs to the atom closure rather than either store. The
    // second store therefore revokes both the first store's state publication
    // and its shared-storage write.
    expect(firstStore.get(countAtom)).toBe(0)
    expect(secondStore.get(countAtom)).toBe(2)
    expect(writes).toEqual([2])
  })

  it('lets an outer updater reclaim authority after a nested later write', async () => {
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

    // writeGeneration advances after updater evaluation, so the outer earlier
    // invocation receives the newer generation after the nested write returns.
    expect(store.get(countAtom)).toBe(1)
    expect(writes).toEqual([2, 1])
  })
})
