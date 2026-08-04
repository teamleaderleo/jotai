from pathlib import Path

path = Path("tests/react/vanilla-utils/atomWithStorageKeyIsolation.test.ts")
text = path.read_text(encoding="utf-8")

old_import = "import { createJSONStorage } from 'jotai/vanilla/utils'\n"
new_import = (
    "import { createJSONStorage } from 'jotai/vanilla/utils'\n"
    "import type { SyncStringStorage } from 'jotai/vanilla/utils/atomWithStorage'\n"
)
if text.count(old_import) != 1:
    raise SystemExit(f"expected one utility import, found {text.count(old_import)}")
text = text.replace(old_import, new_import, 1)

old_fixture = """    const storage = createJSONStorage<StoredValue>(() =>
      available ? stringStorage : undefined,
    )
"""
new_fixture = """    const getStringStorage = () =>
      (available ? stringStorage : undefined) as SyncStringStorage
    const storage = createJSONStorage<StoredValue>(getStringStorage)
"""
if text.count(old_fixture) != 1:
    raise SystemExit(
        f"expected one unavailable-storage fixture, found {text.count(old_fixture)}"
    )
text = text.replace(old_fixture, new_fixture, 1)
path.write_text(text, encoding="utf-8")
