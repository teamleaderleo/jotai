from pathlib import Path

source_path = Path("src/vanilla/utils/atomWithStorage.ts")
text = source_path.read_text(encoding="utf-8")

old_setup = """  const getOnInit = options?.getOnInit
  let writeGeneration = 0
  const baseAtom = atom(
"""
new_setup = """  const getOnInit = options?.getOnInit
  let storageWriteGeneration = 0
  const stateWriteGenerationAtom = atom(0)
  const baseAtom = atom(
"""
if text.count(old_setup) != 1:
    raise SystemExit(f"expected one generation setup, found {text.count(old_setup)}")
text = text.replace(old_setup, new_setup, 1)

old_debug = """  if (import.meta.env?.MODE !== 'production') {
    baseAtom.debugPrivate = true
  }
"""
new_debug = """  if (import.meta.env?.MODE !== 'production') {
    stateWriteGenerationAtom.debugPrivate = true
    baseAtom.debugPrivate = true
  }
"""
if text.count(old_debug) != 1:
    raise SystemExit(f"expected one debug block, found {text.count(old_debug)}")
text = text.replace(old_debug, new_debug, 1)

old_write = """    (get, set, update: SetStateActionWithReset<Value | Promise<Value>>) => {
      const nextValue =
        typeof update === 'function'
          ? (
              update as (
                prev: Value | Promise<Value>,
              ) => Value | Promise<Value> | typeof RESET
            )(get(baseAtom))
          : update
      const generation = ++writeGeneration
      if (nextValue === RESET) {
        set(baseAtom, initialValue)
        return storage.removeItem(key)
      }
      if (isPromiseLike(nextValue)) {
        return nextValue.then((resolvedValue) => {
          if (generation !== writeGeneration) {
            return
          }
          set(baseAtom, resolvedValue)
          return storage.setItem(key, resolvedValue)
        })
      }
      set(baseAtom, nextValue)
      return storage.setItem(key, nextValue)
    },
"""
new_write = """    (get, set, update: SetStateActionWithReset<Value | Promise<Value>>) => {
      // State authority belongs to each store. Persistence authority belongs to
      // the atom instance because every store writes through the same storage.
      // Allocate both receipts before updater evaluation so a nested later write
      // cannot be overtaken when the outer updater returns.
      const stateGeneration = get(stateWriteGenerationAtom) + 1
      set(stateWriteGenerationAtom, stateGeneration)
      const storageGeneration = ++storageWriteGeneration
      const isCurrentStateWrite = () =>
        get(stateWriteGenerationAtom) === stateGeneration
      const isCurrentStorageWrite = () =>
        storageWriteGeneration === storageGeneration

      const nextValue =
        typeof update === 'function'
          ? (
              update as (
                prev: Value | Promise<Value>,
              ) => Value | Promise<Value> | typeof RESET
            )(get(baseAtom))
          : update
      if (nextValue === RESET) {
        if (isCurrentStateWrite()) {
          set(baseAtom, initialValue)
        }
        if (isCurrentStorageWrite()) {
          return storage.removeItem(key)
        }
        return
      }
      if (isPromiseLike(nextValue)) {
        return nextValue.then((resolvedValue) => {
          if (isCurrentStateWrite()) {
            set(baseAtom, resolvedValue)
          }
          if (isCurrentStorageWrite()) {
            return storage.setItem(key, resolvedValue)
          }
        })
      }
      if (isCurrentStateWrite()) {
        set(baseAtom, nextValue)
      }
      if (isCurrentStorageWrite()) {
        return storage.setItem(key, nextValue)
      }
    },
"""
if text.count(old_write) != 1:
    raise SystemExit(f"expected one write block, found {text.count(old_write)}")
source_path.write_text(text.replace(old_write, new_write, 1), encoding="utf-8")

test_path = Path(
    "tests/react/vanilla-utils/atomWithStoragePromiseWriteAuthoritySplit.test.ts"
)
test_path.write_text(
    """import { describe, expect, it } from 'vitest'
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
""",
    encoding="utf-8",
)
