# Draft owned-fork PR body

## Summary

- scope parsed JSON identity by storage key;
- preserve unchanged same-key identity across unrelated-key reads;
- invalidate only the affected key after removal terminal outcomes and unreadable storage observations;
- add target-native sync, async, reviver, mutation-isolation, removal, missing, malformed, and existing-suite controls.

## Exact identity

- base: `56a9cc51de8a5dd762b95a145820f12589cc47c9`
- product-and-test head: `e295dc741a706153b50e7d27fbd424fcc48519cb`
- current execution-carrier head: replace after PR open

## Boundary

Unit 21 owns stale asynchronous read publication generation fencing. This owned-fork PR is an execution carrier and source-review surface for unit 20 only. Public upstream interaction is unauthorized.
