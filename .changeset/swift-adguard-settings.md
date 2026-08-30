---
"openwrtctl": patch
---

Добавлена settings-only синхронизация AdGuard Home без обязательного источника правил, defaults для `querylogInterval` и `upstreamMode`, а также управление rate-limit и EDNS Client Subnet настройками.
Единая Zod-схема теперь валидирует эти настройки в project config, генераторе и standalone CLI до записи AdGuard Home YAML.
