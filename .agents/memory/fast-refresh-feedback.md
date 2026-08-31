---
name: Fast refresh feedback
description: UI feedback rule for explicit refetch actions that may complete before users can perceive them.
---

Explicit refresh actions must show a loading state inside the affected surface for a short minimum duration, keep the surrounding page mounted, and leave a persistent completion marker for the current page session.

**Why:** Fast or unchanged responses can make a working refresh button appear broken; short transient success cues can also disappear before users or assistive checks perceive them.

**How to apply:** Use this pattern for user-triggered list or panel refreshes. Do not replace the whole page with a loading screen, and do not rely only on a spinning button or toast.