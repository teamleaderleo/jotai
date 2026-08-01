import { describe, expect, it } from 'vitest'
import { createJSONStorage } from 'jotai/vanilla/utils'

type StoredValue = {
  nested: {
    count: number
  }
}

const encoded = (count: number) => JSON.stringify({ nested: { count } })

const initial = (count: number): StoredValue => ({ nested: { count } })

describe('createJSONStorage unreadable-state invalidation', () => {
  it('does not resurrect identity after out-of-band removal', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const firstAlpha = storage.getItem('alpha', initial(-1))
    const firstBeta = storage.getItem('beta', initial(-2))

    values.delete('alpha')
    expect(storage.getItem('alpha', initial(-3))).toEqual(initial(-3))
    values.set('alpha', encoded(1))

    expect(storage.getItem('alpha', initial(-4))).not.toBe(firstAlpha)
    expect(storage.getItem('beta', initial(-5))).toBe(firstBeta)
  })

  it('does not resurrect identity after malformed JSON is observed', () => {
    const values = new Map([
      ['alpha', encoded(1)],
      ['beta', encoded(1)],
    ])
    const storage = createJSONStorage<StoredValue>(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }))

    const firstAlpha = storage.getItem('alpha', initial(-1))
    const firstBeta = storage.getItem('beta', initial(-2))

    values.set('alpha', '{malformed')
    expect(storage.getItem('alpha', initial(-3))).toEqual(initial(-3))
    values.set('alpha', encoded(1))

    expect(storage.getItem('alpha', initial(-4))).not.toBe(firstAlpha)
    expect(storage.getItem('beta', initial(-5))).toBe(firstBeta)
  })
})
