---
"openwrtctl": minor
---

Add HTTPS-only nfqws2 strategy testing, install its `ncat` prerequisite during router preparation, and provide a separate command that prints successful TLS 1.2 and TLS 1.3 strategies from the saved router log.

Existing configurations must add `nfqws2.test.httpsDomains` before upgrading.
