import { describe, expect, it } from 'vitest'
import { createStore } from 'jotai/vanilla'
import { atomWithStorage } from 'jotai/vanilla/utils'

type PendingWrite = {
  commit: () => void
  value: number
}

describe('atomWithStorage backend settlement ordering', () => {
  it('does not serialize two already-authorized asynchronous backend writes', async () => {
    const pendingWrites: PendingWrite[] = []
    let durableValue = 0
    const storage = {
      getItem: () => durableValue,
      setItem: (_key: string, value: number) =>
        new Promise<void>((resolve) => {
          pendingWrites.push({
            value,
            commit: () => {
              durableValue = value
              resolve()
            },
          })
        }),
      removeItem: async () => {
        durableValue = 0
      },
    }
    const countAtom = atomWithStorage('count', 0, storage)
    const store = createStore()

    const olderWrite = store.set(countAtom, 1)
    const newerWrite = store.set(countAtom, 2)

    expect(store.get(countAtom)).toBe(2)
    expect(pendingWrites.map(({ value }) => value)).toEqual([1, 2])

    pendingWrites[1]?.commit()
    await newerWrite
    pendingWrites[0]?.commit()
    await olderWrite

    expect(store.get(countAtom)).toBe(2)
    expect(durableValue).toBe(1)
  })
})
