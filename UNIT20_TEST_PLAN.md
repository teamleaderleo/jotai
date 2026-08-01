# Unit 20 test plan

Temporary owned-fork execution note. Remove after the source and receipt records have been transferred to Fieldwork.

## Exact commands

```sh
pnpm install --frozen-lockfile
pnpm vitest run \
  tests/react/vanilla-utils/atomWithStorageKeyIsolation.test.ts \
  tests/react/vanilla-utils/atomWithStorageReadInvalidation.test.ts \
  tests/react/vanilla-utils/atomWithStorage.test.tsx
pnpm eslint \
  src/vanilla/utils/atomWithStorage.ts \
  tests/react/vanilla-utils/atomWithStorageKeyIsolation.test.ts \
  tests/react/vanilla-utils/atomWithStorageReadInvalidation.test.ts
pnpm prettier --check \
  src/vanilla/utils/atomWithStorage.ts \
  tests/react/vanilla-utils/atomWithStorageKeyIsolation.test.ts \
  tests/react/vanilla-utils/atomWithStorageReadInvalidation.test.ts
pnpm tsc --noEmit
pnpm run build
```

## Claim boundary

The focused matrix covers key isolation, same-key identity, revivers, removal terminal outcomes, missing or malformed storage observations, and the existing atom-with-storage suite. Unit 21 owns stale asynchronous completion generation fencing. Browser and React Native integration remain separate compatibility checks.
