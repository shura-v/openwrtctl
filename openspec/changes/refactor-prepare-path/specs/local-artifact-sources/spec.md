## Purpose

Определяет единый пользовательский контракт для статических и внешне подготавливаемых локальных артефактов перед безопасной синхронизацией на роутер.

## ADDED Requirements

### Requirement: Artifact source configuration
Каждый управляемый артефакт SHALL иметь обязательный `path` и MAY иметь опциональный блок `prepare` с argv-командой и полем `prepare.cwd`. Относительные `path` и `prepare.cwd` SHALL разрешаться относительно каталога конфигурационного файла, а `~` SHALL поддерживаться явно. `prepare.cwd` без `prepare.command` MUST быть отклонён.

#### Scenario: Static artifact
- **WHEN** для артефакта задан `path` без `prepare`
- **THEN** система читает и проверяет существующий файл, не запуская внешнюю команду

#### Scenario: Missing required path
- **WHEN** в конфигурации управляемого артефакта отсутствует `path`
- **THEN** загрузка конфигурации завершается ошибкой с точным путём поля

#### Scenario: Default producer working directory
- **WHEN** задан `prepare.command` без `prepare.cwd`
- **THEN** producer запускается из каталога конфигурационного файла

#### Scenario: Working directory without command
- **WHEN** задан `prepare.cwd` без `prepare.command`
- **THEN** загрузка конфигурации завершается ошибкой с точным путём поля

### Requirement: Producer command contract
`prepare.command` SHALL быть непустым argv-массивом и SHALL запускаться без неявной shell-интерпретации. Ровно один argv-элемент SHALL быть равен `{output}` и SHALL заменяться уникальным временным output path; использование маркера как подстроки другого аргумента MUST быть отклонено.

#### Scenario: Successful producer
- **WHEN** producer завершается с кодом 0 и создаёт корректный результат по `{output}`
- **THEN** система принимает candidate для service-specific проверки

#### Scenario: Invalid output marker
- **WHEN** отдельный argv-элемент `{output}` отсутствует, встречается более одного раза или используется как подстрока
- **THEN** конфигурация отклоняется до запуска producer

#### Scenario: Shell syntax in an argument
- **WHEN** аргумент producer содержит shell metacharacters без явного запуска shell как executable
- **THEN** система передаёт аргумент буквально и не интерпретирует его как shell syntax

### Requirement: Failure-safe artifact replacement
Система SHALL создавать candidate внутри sibling staging directory с mode `0700`, SHALL проверять его через `lstat` как regular file, не являющийся symlink, до замены настроенного `path`, SHALL атомарно сохранять успешный результат и SHALL синхронизировать immutable snapshot проверенных байтов. Для producer source отсутствующий parent directory SHALL создаваться с mode `0700`; для static source отсутствующий parent или file SHALL завершать загрузку ошибкой. Неуспешный producer или validator MUST NOT заменять предыдущий корректный артефакт.

#### Scenario: Producer exits with error
- **WHEN** producer завершается с ненулевым кодом, превышает timeout, создаёт symlink или не создаёт regular file
- **THEN** sync останавливается до SSH/upload, candidate удаляется, а существующий `path` остаётся без изменений

#### Scenario: Producer target directory is absent
- **WHEN** producer source указывает `path` в отсутствующем parent directory
- **THEN** система создаёт parent directory с mode `0700` до запуска producer

#### Scenario: Artifact changes after validation
- **WHEN** файл по настроенному `path` изменяется после получения проверенного snapshot
- **THEN** текущий sync использует ранее проверенные байты, а не повторно читает изменившийся файл

### Requirement: Generated artifact privacy
Сгенерированный артефакт SHALL сохраняться с правами `0600`. Диагностика producer MUST NOT печатать полное окружение, полный config, stdout/stderr или секретные аргументы команды.

#### Scenario: Generated artifact is persisted
- **WHEN** producer успешно создаёт и система сохраняет новый артефакт
- **THEN** итоговый файл имеет права `0600`

#### Scenario: Producer reports an error
- **WHEN** producer завершается ошибкой
- **THEN** сообщение указывает компонент, executable и exit condition без раскрытия секретных данных
