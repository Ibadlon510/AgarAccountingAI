# Firm white-label landing

Firm Pro (and the 15-day firm trial) includes a public branded landing. It is not a Company Pro feature.

- Unique slug on `agaraccounting_firm_profiles.slug`; URL is `{slug}.agaraccounting.com`, with `/f/{slug}` as the path fallback until wildcard DNS exists.
- Public `GET /api/public/firm-landing/:slug` (and `/logo`) only while `resolveFirmBilling().fullAccess` and `landingEnabled`. Lapsed or locked firms 404.
- Settings thumbnail uses authenticated `GET /api/workspace/firm-branding/logo` so unpublished/lapsed firms still see the saved file. Owners/admins edit; other members are read-only.
- Logo is JPEG/PNG/WebP, max 2 MB, no SVG. Footer still names AgarAccounting AI.
- Reserved hosts (`www`, `api`, `app`, …) never resolve to a firm landing.
- Production also needs Clerk to allow `*.agaraccounting.com`; until then use `/f/{slug}` on the main host.
