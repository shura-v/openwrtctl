---
"openwrtctl": major
---

DNS-настройки AdGuard перенесены в обязательный mapping `adguard.dns`: `dnsPort` переименован в `dns.port`, остальные DNS-поля вложены без compatibility aliases.
Добавлено управление cache и полной EDNS Client Subnet mapping с общей валидацией project config, генератора и standalone CLI.
