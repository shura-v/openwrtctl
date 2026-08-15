# Refactor: `prepare` + `path` artifacts

## Цель

Полностью удалить знание о `singboxctl` и разбор сгенерированного sing-box config из `openwrtctl`.

`openwrtctl` должен:

- при необходимости запустить внешний producer;
- получить артефакт по обязательному `path`;
- проверить формат артефакта;
- синхронизировать его через существующий service-specific lifecycle.

Знание о `singboxctl`, его профилях, rule sets и преобразовании правил переносится в локальные POSIX `sh`-скрипты из `/Users/super/git/rc/bin`. Каталог уже находится в `PATH`.

Обратная совместимость и миграция старого формата не требуются: пользователей у проекта нет. Старый контракт удаляется одним hard cut.

## Итоговый конфигурационный контракт

```yaml
singbox:
  config:
    path: ./strategies/generated/sing-box.json
    prepare:
      command:
        - openwrtctl-singbox-config
        - router
        - "{output}"
      cwd: .

adguard:
  rewrites:
    path: ./strategies/generated/adguard-rewrites.yaml
    prepare:
      command:
        - openwrtctl-adguard-rewrites
        - router
        - "{output}"
      cwd: .

nfqws2:
  resources:
    path: ./strategies/generated/nfqws2-resources.yaml
    prepare:
      command:
        - openwrtctl-nfqws2-resources
        - router
        - "{output}"
      cwd: .
```

Правила контракта:

- `singbox`, `adguard` и `nfqws2` — независимые опциональные service-секции; config может управлять только одним сервисом;
- `path` обязателен для каждого артефакта;
- `prepare` опционален: без него используется готовый статический файл;
- `prepare.command` — непустой argv-массив, запуск выполняется без shell;
- `{output}` должен встречаться ровно один раз и заменяется временным sibling-файлом;
- `cwd` опционален и по умолчанию равен каталогу конфигурационного файла;
- относительные пути и `cwd` разрешаются от каталога config, `~` разворачивается явно;
- ошибка producer, отсутствие результата или ошибка валидации останавливают sync до SSH/upload;
- после успешной валидации candidate атомарно заменяет `path`, а sync использует уже прочитанный snapshot;
- сгенерированные файлы создаются с правами `0600`.

Shell-строки и multiline `preSync` не поддерживаются. Для сложного pipeline пользователь явно запускает собственный POSIX `sh`-скрипт из `PATH`.

## Форматы артефактов

### sing-box

`singbox.config.path` содержит полный финальный JSON для роутера.

`openwrtctl` не меняет TUN, DNS или route rules и не извлекает из файла ресурсы. Остаются только проверка доступности файла, upload, удалённый `sing-box check` и существующий lifecycle применения.

### AdGuard Home

`adguard.rewrites.path` содержит нативный YAML-массив элементов `filtering.rewrites`:

```yaml
- domain: example.com
  answer: 192.0.2.10
- domain: "*.example.com"
  answer: 192.0.2.10
```

`openwrtctl` загружает текущий `AdGuardHome.yaml` с роутера, заменяет только `filtering.rewrites`, сохраняет остальные управляемые настройки и runtime-поля, затем выполняет существующие backup, remote validation и rollback.

### nfqws2

`nfqws2.resources.path` содержит YAML-манифест готовых значений для двух списков:

```yaml
userList:
  - ^exact.example
  - suffix.example
ipsetList:
  - 192.0.2.0/24
  - 2001:db8::/32
```

`openwrtctl` проверяет только структуру и безопасные строковые значения, затем использует существующую сборку и установку `user.list`/`ipset.list`. Семантика профилей и sing-box rules в репозитории отсутствует.

## Архитектурная граница

```text
/Users/super/git/rc/bin
  profile + singboxctl + local rules
                  |
                  v
       final service artifact
                  |
                  v
openwrtctl: prepare -> validate -> snapshot -> upload -> remote check -> apply
```

Общий только prepare/path runner. Формат, проверка и применение остаются отдельными для sing-box, AdGuard Home и nfqws2.

## Инкременты

## Фактический статус на 2026-08-15

Repo-local часть `openwrtctl` реализована: 93/93 тестов проходят, dependency
`singboxctl` отсутствует, а `sync` готовит snapshots всех настроенных сервисов
до первого service apply. `git diff --check` проходит в `openwrtctl` и `rc`.

Три producer-команды установлены в `/Users/super/git/rc/bin` и доступны через
`PATH`. Локальные generated artifacts лежат в `strategies/generated`, а
единственная sing-box-only static strategy — в `strategies/static`.
`~/.config/openwrtctl/Makefile` применяет выбранный sing-box config целями
`generated` и `static`, не синхронизируя AdGuard Home или nfqws2.
Пользовательские поля сохранены, mode конфигов и артефактов остаётся `0600`.
`config.example.yaml`, основной локальный config и static strategy успешно
загружаются новым loader. Remote smoke test ещё не выполнялся.

### 1. Создать POSIX producers в `rc/bin`

**Репозиторий:** `/Users/super/git/rc`

**Зависит от:** —

**Результат:** все знания о `singboxctl` могут быть вызваны как самостоятельные локальные команды, а `openwrtctl` ещё не изменён.

- [x] Добавить `bin/openwrtctl-singbox-config <profile> <output>`: вызвать `singboxctl generate`, перенести текущие TUN/DNS/route-преобразования и записать полный финальный JSON.
- [x] Добавить `bin/openwrtctl-adguard-rewrites <profile> <output>`: собрать только правила `route: dns` и записать нативный YAML-массив rewrites.
- [x] Добавить `bin/openwrtctl-nfqws2-resources <profile> <output>`: собрать `userList` и `ipsetList` без привязки потребителя к sing-box JSON.
- [x] Использовать `#!/bin/sh`, `set -eu`, `umask 077`, quoted paths, temporary output и atomic `mv`; не использовать Bash-only конструкции.
- [x] Явно проверять внешние зависимости (`singboxctl`, `jq`, Mike Farah `yq` v4 при использовании) через `command -v`.

**Проверка:**

- [x] `sh -n` проходит для каждого producer; POSIX fixture suite запускает каждый скрипт через `sh`.
- [x] sing-box output проходит `jq empty`; YAML outputs проходят parser/fixture validation.
- [x] Повторный запуск на одинаковом входе создаёт byte-stable результат.
- [x] Ошибка producer не заменяет предыдущий корректный output.

**Граница отката:** удалить новые additive-скрипты; `openwrtctl` продолжает работать по старому пути.

### 2. Добавить общий artifact runner в `openwrtctl`

**Репозиторий:** `/Users/super/git/openwrtctl`

**Зависит от:** инкремент 1 только для интеграционного smoke test; unit-тесты не должны знать о `singboxctl`.

**Результат:** библиотека умеет получить статический или сгенерированный артефакт, но sync-команды ещё не переключены.

- [x] Добавить `scripts/lib/local-artifact.js` с разрешением `path`/`cwd`, argv-запуском producer и подстановкой `{output}`.
- [x] Создавать candidate рядом с `path`, читать и валидировать candidate до atomic rename, затем возвращать immutable byte snapshot.
- [x] Ограничить выполнение timeout, корректно завершать дочерний процесс и очищать candidate при ошибке.
- [x] Не печатать environment, полный command или producer output: ошибка содержит компонент, executable, exit code и безопасный путь к диагностике.
- [x] Добавить отдельные unit-тесты artifact runner.

**Проверка:**

- [x] Покрыты static path, успешный producer, non-zero exit, timeout, отсутствующий output, путь с пробелами и cleanup.
- [x] Проверены ровно одна подстановка `{output}`, отсутствие shell-интерпретации и права `0600`.
- [ ] Старый sync pipeline остаётся зелёным до hard cut.

**Граница отката:** удалить additive library и её тесты.

### 3. Выполнить единый hard cut конфигурации и consumers

**Репозиторий:** `/Users/super/git/openwrtctl`

**Зависит от:** инкременты 1–2.

**Результат:** все три sync-команды работают только через новые артефакты; старый YAML отклоняется.

- [x] Заменить обязательную секцию `singboxctl` на новые `singbox.config`, `adguard.rewrites` и `nfqws2.resources` в `config.example.yaml` и `scripts/lib/config.js`.
- [x] Переключить `sync-singbox` на exact JSON snapshot без вызова `singboxctl` и без локального patch sing-box config.
- [x] Переключить `sync-adguard` на нативный rewrites artifact, сохранив patch текущего remote YAML и существующий lifecycle.
- [x] Переключить `sync-nfqws2` на собственный resources manifest без `loadRouterResources`.
- [x] Синхронизировать `~/.config/openwrtctl/config.yaml`: сохранить пользовательские значения и права `0600`, изменить только новый контракт.
- [x] Сделать `singbox`, `adguard` и `nfqws2` опциональными и синхронизировать только настроенные сервисы в фиксированном порядке.

**Проверка:**

- [x] Старый config с `singboxctl` не загружается; fallback и migration warning отсутствуют.
- [x] Отсутствующий обязательный `path` и неверный `prepare.command` отклоняются с точным config path.
- [x] Ошибка любого prepare/validation возникает до первой remote mutation.
- [x] `config.example.yaml` и локальный config загружаются через `scripts/lib/config.js` без печати их содержимого.
- [ ] Static path работает без запуска producer для каждого consumer.

**Граница отката:** единый revert consumer/schema commit и восстановление локального config из приватной резервной копии.

### 4. Удалить singbox parser/generator layer

**Репозиторий:** `/Users/super/git/openwrtctl`

**Зависит от:** инкремент 3.

**Результат:** в runtime нет кода, который знает о профилях, rule sets или структуре route rules sing-box.

- [x] Удалить `scripts/singbox-config.js` и `scripts/singbox-config.test.js`.
- [x] Удалить `scripts/lib/router-resources.js` и связанные fixtures/tests.
- [x] Удалить старые `buildAdguardRewrites`, `buildNfqws2Lists` и импорты `loadRouterResources`.
- [x] Удалить `scripts/lib/package-bin.js` и `scripts/package-bin.test.js`, если других package-bin consumers не осталось.
- [x] Проверить отсутствие runtime/config ссылок на `singboxctl` и старые поля.

**Проверка:**

- [x] `rg -n "singboxctl|loadRouterResources|ruleSetsDirectory" bin scripts config.example.yaml package.json --glob '!*.test.js'` не находит runtime-ссылок.
- [x] Все service-level и lifecycle tests проходят на новом artifact pipeline.

**Граница отката:** cleanup-коммит можно откатить независимо; новый pipeline продолжит работать при временном возврате неиспользуемого кода.

### 5. Удалить dependency и закрыть пользовательский контракт

**Репозиторий:** `/Users/super/git/openwrtctl`

**Зависит от:** инкремент 4.

**Результат:** пакет устанавливается и работает без npm-зависимости `singboxctl`; документация описывает только новый контракт.

- [x] Удалить `singboxctl` из `package.json` и `package-lock.json` штатной npm-командой.
- [x] Обновить README: `path`, `prepare.command`, `cwd`, форматы трёх артефактов и ответственность producer.
- [x] Добавить changeset с hard-cut изменением конфигурационного интерфейса.
- [x] Не добавлять migration guide, deprecated aliases или compatibility adapter.
- [x] Обновить этот task фактическими результатами и отметить выполненные пункты.

**Проверка:**

- [x] `npm test`.
- [x] `npm ls singboxctl` подтверждает отсутствие зависимости.
- [x] `git diff --check` в обоих репозиториях.
- [x] `git status --short` не содержит случайных или сгенерированных артефактов.

## Финальная приёмка

- [x] Producers проходят Linux/POSIX smoke test и доступны через `PATH`.
- [x] Общий `openwrtctl sync` сначала готовит и валидирует все нужные snapshots, затем начинает remote mutations.
- [ ] sing-box candidate проходит `sing-box check` на роутере до замены активного config.
- [x] AdGuard Home сохраняет unmanaged/runtime поля и заменяет только управляемые rewrites/settings.
- [ ] nfqws2 получает те же domain/IP resources, что и до refactor, на зафиксированных fixtures.
- [x] Локальный config имеет права `0600`; секреты и полный config не попадают в лог.
- [ ] Рабочие деревья обоих репозиториев чисты после финальной проверки.

## Вне scope

- Поддержка старой секции `singboxctl`.
- Автоматическая миграция существующего config.
- Встроенные в `openwrtctl` знания о конкретном producer или `singboxctl`.
- Собственный общий policy DSL для sing-box, AdGuard Home и nfqws2.
- Полный локальный source of truth для `AdGuardHome.yaml` вместе с users/password/runtime state.
