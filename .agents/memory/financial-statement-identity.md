---
name: Financial statement identity
description: Which client identity generated financial statements must present.
---

Generated financial statement covers, page headers, PDFs, and system-generated note narratives must use the selected client’s display/company name. Keep legal-name data separate for legal metadata rather than substituting it into report presentation.

**Why:** A client report displayed a stale legal-name value even though the correct client was selected, making the report appear to belong to another entity.

**How to apply:** Whenever report presentation is added or regenerated, trace the selected client display name through the frozen snapshot and assert that legal-name values cannot replace it.