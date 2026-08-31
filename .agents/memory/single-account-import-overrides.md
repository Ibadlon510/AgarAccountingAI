---
name: Single-account import overrides
description: Compatibility rule for explicit user choices when grouped extraction also represents ordinary one-account statements.
---

For a statement with exactly one extracted account group, an explicit confirmation currency and explicit selected bank account remain authoritative over detected group identity.

**Why:** Representing every extraction as groups can silently change established single-account behavior if detected identity is allowed to override the reviewer’s existing top-level choices.

**How to apply:** Any grouped-import change must test the ordinary one-account preview-to-confirm flow with a corrected currency and with a selected account that differs from the detected identity.