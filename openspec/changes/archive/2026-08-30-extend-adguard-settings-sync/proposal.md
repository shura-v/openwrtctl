## Why

`openwrtctl` должен синхронизировать управляемые настройки AdGuard Home без обязательного rewrite-артефакта. Текущий контракт требует `rewrites` или `userRules`, не управляет rate-limit/EDNS-настройками и требует значения, для которых библиотека может безопасно предоставить defaults.

## What Changes

- Секция `adguard` принимает ноль или один источник правил: `rewrites`, `userRules` либо settings-only режим без обоих полей.
- Settings-only режим очищает `filtering.rewrites` и `user_rules`, чтобы итоговое состояние не зависело от предыдущей синхронизации.
- `querylogInterval` и `upstreamMode` становятся опциональными и нормализуются библиотекой в `6h` и `load_balance`.
- Добавляются опциональные поля `rateLimit`, `rateLimitSubnetLenIpv4`, `rateLimitSubnetLenIpv6`, `rateLimitWhitelist` и `ednsClientSubnet` с безопасными defaults и отображением в нативные поля `dns.*` AdGuard Home.
- Сохраняются текущие pull/backup/patch/`AdGuardHome --check-config`/transaction/readiness проверки и управление dnsmasq.
- README, `config.example.yaml`, тесты и patch changeset описывают новый пользовательский контракт.
- Общая Zod-схема валидирует и нормализует AdGuard settings во всех локальных входных путях до генерации YAML.

## Capabilities

### New Capabilities

- `adguard-settings-sync`: Валидация, defaults и транзакционная синхронизация управляемых AdGuard Home DNS-настроек с опциональным источником правил.

### Modified Capabilities

Нет: основной spec-каталог пока не содержит существующих capabilities.

## Impact

- Меняются `config.example.yaml`, `scripts/lib/config.js`, `scripts/sync-adguard.js`, `scripts/adguard-config.js` и связанные тесты/fixtures.
- Пользовательский config API получает новые опциональные поля; существующие валидные конфиги остаются совместимыми.
- Отсутствие `rewrites` и `userRules` получает явную очистительную семантику и больше не является ошибкой.
- README и новый `.changeset/*.md` требуют patch-релиза.
- Runtime dependencies получают Zod 4; локальный `~/.config/openwrtctl/config.yaml` синхронизируется только по новым полям с сохранением пользовательских значений.
