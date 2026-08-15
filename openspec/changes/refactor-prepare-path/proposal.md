## Why

`openwrtctl` сейчас жёстко зависит от `singboxctl`: три sync-потока запускают его генератор, а внутренние модули разбирают sing-box config, чтобы восстановить правила для sing-box, AdGuard Home и nfqws2. Для персонального приватного инструмента эта связность не даёт пользы и мешает использовать готовые или созданные любым внешним инструментом артефакты.

Нужно оставить в `openwrtctl` только универсальную подготовку локального артефакта, его проверку и service-specific синхронизацию, а знания о `singboxctl` и личных rule sets перенести в переносимые POSIX `sh` producers из `/Users/super/git/rc/bin`.

## What Changes

- Добавляется общий контракт локального артефакта: обязательный `path` и опциональный `prepare.command` с `{output}`.
- Секции `singbox`, `adguard` и `nfqws2` становятся опциональными: config управляет только явно присутствующими сервисами, а общий `sync` пропускает остальные.
- sing-box начинает принимать полный финальный JSON и синхронизировать его без локального semantic patching.
- AdGuard Home начинает принимать нативный YAML-массив `filtering.rewrites`, сохраняя текущий pull/patch/validate/apply lifecycle.
- nfqws2 начинает принимать отдельный YAML-манифест `userList`/`ipsetList`, не извлекая ресурсы из sing-box config.
- Новый контракт позволяет использовать POSIX `sh` producers из `/Users/super/git/rc/bin`, которые инкапсулируют `singboxctl`, профили и личные rule sets; их создание является внешней предпосылкой для live cutover и не входит в repo-local apply scope этого change.
- **BREAKING**: старая секция `singboxctl`, старые поля profile/rule-set и весь compatibility/migration слой удаляются без fallback.
- **BREAKING**: `adguard.rewriteIp` удаляется; каждый нативный rewrite artifact уже содержит собственный `answer`.
- Удаляются runtime dependency `singboxctl`, разбор route rules и старый generator/parser pipeline из `openwrtctl`.

## Capabilities

### New Capabilities

- `local-artifact-sources`: Получение статического или подготовленного внешней argv-командой локального артефакта с безопасной подстановкой output, валидацией и атомарным сохранением.
- `service-config-artifacts`: Контракты и синхронизация полного sing-box JSON, нативных AdGuard rewrites и отдельного nfqws2 resources manifest без знания о producer.

### Modified Capabilities

Нет: основной spec-каталог пока не содержит существующих capabilities.

## Impact

- Конфигурационный интерфейс `config.example.yaml`, `scripts/lib/config.js` и локальный `~/.config/openwrtctl/config.yaml` меняются одним hard cut; минимальный config может управлять только одним сервисом.
- Меняются `sync-singbox`, `sync-adguard`, `sync-nfqws2` и их config builders/tests; remote lifecycle и validators сохраняются.
- Удаляются `scripts/singbox-config.js`, `scripts/lib/router-resources.js`, package-bin helper и связанные тесты/fixtures.
- Удаляется npm-зависимость `singboxctl`; README и changeset описывают только новый контракт.
- Для live cutover отдельно требуются три POSIX `sh` producer-команды в соседнем приватном репозитории `/Users/super/git/rc`; текущий OpenSpec change не имеет этот репозиторий в `allowedEditRoots`.
