## Purpose

Определяет независимые форматы локальных артефактов и наблюдаемое поведение синхронизации sing-box, AdGuard Home и nfqws2 без зависимости от способа их генерации.

## ADDED Requirements

### Requirement: Exact sing-box configuration artifact
`singbox.config.path` SHALL указывать на полный финальный JSON-конфиг sing-box. Система MUST NOT изменять TUN, DNS, outbounds или route rules этого артефакта и SHALL применить его только после успешной проверки sing-box на роутере.

#### Scenario: Valid sing-box artifact
- **WHEN** локальный JSON корректен и удалённый `sing-box check` завершается успешно
- **THEN** lifecycle устанавливает ровно проверенный snapshot как активный sing-box config

#### Scenario: Invalid sing-box artifact
- **WHEN** JSON некорректен или удалённый `sing-box check` завершается ошибкой
- **THEN** активный sing-box config не заменяется candidate

### Requirement: Native AdGuard rewrites artifact
`adguard.rewrites.path` SHALL содержать top-level YAML sequence нативных элементов `filtering.rewrites`. Система SHALL нормализовать отсутствующее поле `enabled` в `true`, SHALL сохранять явно заданное boolean-значение и SHALL заменить только управляемые rewrites в загруженном с роутера AdGuard Home config. Система SHALL продолжить применять существующие настройки upstream DNS, bootstrap DNS, upstream mode, DNS/web ports и querylog interval из секции `adguard` и MUST сохранить остальные runtime-поля.

#### Scenario: Valid rewrites artifact
- **WHEN** каждый элемент содержит допустимые `domain` и `answer`, а одинаковые domains не конфликтуют
- **THEN** система устанавливает этот список в `filtering.rewrites` и выполняет существующие backup, validation и apply

#### Scenario: Conflicting rewrites
- **WHEN** один domain получает разные answers в одном артефакте
- **THEN** синхронизация останавливается до изменения remote config

#### Scenario: Empty rewrites artifact
- **WHEN** артефакт содержит пустой YAML sequence
- **THEN** система явно заменяет управляемые rewrites пустым списком

#### Scenario: Rewrite enabled state
- **WHEN** запись не содержит `enabled`, а другая запись явно содержит `enabled: false`
- **THEN** consumer устанавливает первой записи `enabled: true` и сохраняет вторую выключенной

### Requirement: Independent nfqws2 resources artifact
`nfqws2.resources.path` SHALL содержать YAML mapping со строковыми массивами `userList` и `ipsetList`. Система SHALL строить управляемые nfqws2 list files только из этого manifest и MUST NOT извлекать ресурсы из sing-box config.

#### Scenario: Valid nfqws2 manifest
- **WHEN** manifest содержит безопасные строковые элементы без переводов строк
- **THEN** система формирует текущие `user.list` и `ipset.list` из соответствующих массивов

#### Scenario: Invalid nfqws2 element
- **WHEN** элемент имеет неверный тип или содержит перевод строки
- **THEN** синхронизация nfqws2 останавливается до upload

### Requirement: Prepare all artifacts before remote mutation
Общий `sync` SHALL подготовить и проверить snapshots всех настроенных сервисов до первой remote mutation и SHALL пропустить сервисы, секции которых отсутствуют. Ошибка любого настроенного artifact source MUST остановить весь запуск до применения любого сервиса.

#### Scenario: Later artifact preparation fails
- **WHEN** AdGuard artifact готов, а подготовка sing-box или nfqws2 artifact завершается ошибкой
- **THEN** общий sync не изменяет AdGuard Home, sing-box или nfqws2 на роутере

#### Scenario: Sing-box-only aggregate sync
- **WHEN** config содержит только секцию `singbox` из service-секций
- **THEN** общий sync готовит и применяет только sing-box, не требуя AdGuard или nfqws2 artifacts

### Requirement: Hard-cut configuration contract
Конфигурация SHALL требовать общие секции `openwrt` и `backup` и MAY принимать новые service-секции `singbox`, `adguard` и `nfqws2`. Для каждой присутствующей service-секции соответствующий artifact source (`singbox.config`, `adguard.rewrites` или `nfqws2.resources`) и остальные service-specific поля SHALL быть обязательны и полностью провалидированы. Старая секция `singboxctl`, profile/rule-set поля, `adguard.rewriteIp` и compatibility fallback MUST быть отклонены.

#### Scenario: Legacy configuration is loaded
- **WHEN** config содержит старую секцию `singboxctl` или старые rule-set поля
- **THEN** загрузка завершается явной ошибкой без автоматической миграции

#### Scenario: Mixed configuration is loaded
- **WHEN** config содержит одновременно новые artifact sections и любое legacy-поле, включая `adguard.rewriteIp`
- **THEN** загрузка завершается явной ошибкой без выбора неявного приоритета

#### Scenario: New configuration is loaded
- **WHEN** присутствующие новые service-секции содержат корректные обязательные `path`
- **THEN** config загружается без установленной npm-зависимости `singboxctl`

#### Scenario: Optional service sections are omitted
- **WHEN** config содержит `openwrt`, `backup` и только одну корректную service-секцию
- **THEN** config загружается без требований к полям и artifacts отсутствующих сервисов

#### Scenario: Command requires an omitted service configuration
- **WHEN** sync или другая команда требует настройки сервиса, секция которого отсутствует
- **THEN** команда завершается явной ошибкой до подготовки artifact или remote mutation
