---
"openwrtctl": minor
---

Keep the router DNS service unchanged and manage the AdGuard Home DNS listener through `adguard.dnsPort`, which defaults to `5353` in the config template.

Existing configurations must add `adguard.dnsPort` before upgrading.
