# Unit 20 direct-source carrier

This file is a temporary owned-fork execution note for Fieldwork unit 20. It is excluded from any eventual upstream source diff and must be removed after receipts are transferred.

- Fieldwork packet: teamleaderleo/fieldwork#441
- Fieldwork routing: teamleaderleo/fieldwork#435
- Fieldwork lane: teamleaderleo/fieldwork#235
- Exact base: `56a9cc51de8a5dd762b95a145820f12589cc47c9`
- Product-and-test head before temporary execution files: `e295dc741a706153b50e7d27fbd424fcc48519cb`
- Upstream contact authorized: `false`

The candidate scopes parsed JSON identity by storage key, preserves unchanged same-key identity, and invalidates only the affected key after removal settlement or unreadable storage observations.

Known sequencing boundary: unit 21 owns generation fencing for stale asynchronous read completions. Unit 20 remains independently reviewable as the key-identity base, but a final combined delivery decision must account for that successor.
