import { atom } from '../../vanilla.ts'
import type { WritableAtom } from '../../vanilla.ts'
import { RESET } from './constants.ts'

const isPromiseLike = (x: unknown): x is PromiseLike<unknown> =>
  typeof (x as PromiseLike<unknown>)?.then === 'function'

type Unsubscribe = () => void

type Subscribe<Value> = (
  key: string,
  callback: (value: Value) => void,
  initialValue: Value,
) => Unsubscribe | undefined

type StringSubscribe = (
  key: string,
  callback: (value: string | null) => void,
) => Unsubscribe | undefined

type SetStateActionWithReset<Value> =
  | Value
  | typeof RESET
  | ((prev: Value) => Value | typeof RESET)

export interface AsyncStorage<Value> {
  getItem: (key: string, initialValue: Value) => PromiseLike<Value>
  setItem: (key: string, newValue: Value) => PromiseLike<void>
  removeItem: (key: string) => PromiseLike<void>
  subscribe?: Subscribe<Value>
}

export interface SyncStorage<Value> {
  getItem: (key: string, initialValue: Value) => Value
  setItem: (key: string, newValue: Value) => void
  removeItem: (key: string) => void
  subscribe?: Subscribe<Value>
}

export interface AsyncStringStorage {
  getItem: (key: string) => PromiseLike<string | null>
  setItem: (key: string, newValue: string) => PromiseLike<void>
  removeItem: (key: string) => PromiseLike<void>
  subscribe?: StringSubscribe
}

export interface SyncStringStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, newValue: string) => void
  removeItem: (key: string) => void
  subscribe?: StringSubscribe
}

export function withStorageValidator<Value>(
  validator: (value: unknown) => value is Value,
): {
  (storage: AsyncStorage<unknown>): AsyncStorage<Value>
  (storage: SyncStorage<unknown>): SyncStorage<Value>
}

export function withStorageValidator<Value>(
  validator: (value: unknown) => value is Value,
) {
  return (unknownStorage: AsyncStorage<unknown> | SyncStorage<unknown>) => {
    const storage = {
      ...unknownStorage,
      getItem: (key: string, initialValue: Value) => {
        const validate = (value: unknown) => {
          if (!validator(value)) {
            return initialValue
          }
          return value
        }
        const value = unknownStorage.getItem(key, initialValue)
        if (isPromiseLike(value)) {
          return value.then(validate)
        }
        return validate(value)
      },
    }
    return storage
  }
}

type JsonStorageOptions = {
  reviver?: (key: string, value: unknown) => unknown
  replacer?: (key: string, value: unknown) => unknown
}

export function createJSONStorage<Value>(): SyncStorage<Value>

export function createJSONStorage<Value>(
  getStringStorage: () => AsyncStringStorage,
  options?: JsonStorageOptions,
): AsyncStorage<Value>

export function createJSONStorage<Value>(
  getStringStorage: () => SyncStringStorage,
  options?: JsonStorageOptions,
): SyncStorage<Value>

export function createJSONStorage<Value>(
  getStringStorage: () =>
    | AsyncStringStorage
    | SyncStringStorage
    | undefined = () => {
    try {
      return window.localStorage
    } catch (e) {
      if (import.meta.env?.MODE !== 'production') {
        if (typeof window !== 'undefined') {
          console.warn(e)
        }
      }
      return undefined
    }
  },
  options?: JsonStorageOptions,
): AsyncStorage<Value> | SyncStorage<Value> {
  const cachedValues = new Map<string, { str: string; value: Value }>()

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

  const createHandleSubscribe =
    (subscriber: StringSubscribe): Subscribe<Value> =>
    (key, callback, initialValue) =>
      subscriber(key, (v) => {
        let newValue: Value
        try {
          newValue = JSON.parse(v || '', options?.reviver)
        } catch {
          newValue = initialValue
        }
        callback(newValue)
      })

  let subscriber: StringSubscribe | undefined
  try {
    subscriber = getStringStorage()?.subscribe
  } catch {
    // ignore
  }
  if (
    !subscriber &&
    typeof window !== 'undefined' &&
    typeof window.addEventListener === 'function' &&
    window.Storage
  ) {
    subscriber = (key, callback) => {
      if (!(getStringStorage() instanceof window.Storage)) {
        return () => {}
      }
      const storageEventCallback = (e: StorageEvent) => {
        if (e.storageArea === getStringStorage() && e.key === key) {
          callback(e.newValue)
        }
      }
      window.addEventListener('storage', storageEventCallback)
      return () => {
        window.removeEventListener('storage', storageEventCallback)
      }
    }
  }

  if (subscriber) {
    storage.subscribe = createHandleSubscribe(subscriber)
  }
  return storage
}

const defaultStorage = createJSONStorage()

export function atomWithStorage<Value>(
  key: string,
  initialValue: Value,
  storage: AsyncStorage<Value>,
  options?: { getOnInit?: boolean },
): WritableAtom<
  Value | Promise<Value>,
  [SetStateActionWithReset<Value | Promise<Value>>],
  Promise<void>
>

export function atomWithStorage<Value>(
  key: string,
  initialValue: Value,
  storage?: SyncStorage<Value>,
  options?: { getOnInit?: boolean },
): WritableAtom<Value, [SetStateActionWithReset<Value>], void>

export function atomWithStorage<Value>(
  key: string,
  initialValue: Value,
  storage:
    | SyncStorage<Value>
    | AsyncStorage<Value> = defaultStorage as SyncStorage<Value>,
  options?: { getOnInit?: boolean },
) {
  const getOnInit = options?.getOnInit
  const baseAtom = atom(
    getOnInit
      ? (storage.getItem(key, initialValue) as Value | Promise<Value>)
      : initialValue,
  )

  if (import.meta.env?.MODE !== 'production') {
    baseAtom.debugPrivate = true
  }

  baseAtom.onMount = (setAtom) => {
    setAtom(storage.getItem(key, initialValue) as Value | Promise<Value>)
    return storage.subscribe?.(key, setAtom, initialValue)
  }

  const anAtom = atom(
    (get) => get(baseAtom),
    (get, set, update: SetStateActionWithReset<Value | Promise<Value>>) => {
      const nextValue =
        typeof update === 'function'
          ? (
              update as (
                prev: Value | Promise<Value>,
              ) => Value | Promise<Value> | typeof RESET
            )(get(baseAtom))
          : update
      if (nextValue === RESET) {
        set(baseAtom, initialValue)
        return storage.removeItem(key)
      }
      if (isPromiseLike(nextValue)) {
        return nextValue.then((resolvedValue) => {
          set(baseAtom, resolvedValue)
          return storage.setItem(key, resolvedValue)
        })
      }
      set(baseAtom, nextValue)
      return storage.setItem(key, nextValue)
    },
  )

  return anAtom as never
}
