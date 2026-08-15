## Context

См. мотивацию в `proposal.md`. Сейчас `sync-singbox`, `sync-adguard` и `sync-nfqws2` каждый запускают CLI из npm-пакета `singboxctl`. Сгенерированный sing-box JSON затем используется одновременно как кандидат конфигурации и как промежуточный индекс ресурсов, который `router-resources.js` связывает с локальными metadata `route: dns|proxy`.

Service lifecycle уже отделён от этой генерации: sing-box имеет remote check/apply, AdGuard Home загружает текущий YAML и сохраняет runtime-поля, nfqws2 устанавливает подготовленные config/list files. Рефакторинг должен заменить только локальную source boundary и сохранить эти проверки.

Проект приватный и используется одним владельцем. Старый config не нужно поддерживать или автоматически мигрировать. Reusable consumers находятся в `openwrtctl`, а персональные producers и rule-set knowledge — в `/Users/super/git/rc/bin`. Текущий repo-local OpenSpec change разрешает implementation edits только в `openwrtctl`, поэтому producers и переключение локального config оформляются как внешняя deployment-предпосылка, а не как apply-задачи этого change.

## Goals / Non-Goals

**Goals:**

- Сделать локальный артефакт единственной границей между произвольным producer и `openwrtctl`.
- Гарантировать, что producer failure или invalid artifact не приводит к upload либо потере предыдущего корректного файла.
- Сохранить service-specific remote validation, backup и apply lifecycle.
- Обеспечить producer-neutral consumer contract, совместимый с POSIX `/bin/sh` producers из `PATH`.
- Удалить все runtime/config/dependency ссылки `openwrtctl` на `singboxctl` одним hard cut.
- Позволить управлять любым подмножеством sing-box, AdGuard Home и nfqws2 без config-заглушек для остальных сервисов.

**Non-Goals:**

- Общий policy DSL для traffic routing, DNS rewrites и nfqws2 resources.
- Поддержка старой секции `singboxctl`, aliases, warnings или migration adapter.
- Управление полным локальным `AdGuardHome.yaml`, включая users/password/runtime state.
- Межсервисная распределённая транзакция после начала remote apply.
- Встроенная shell-интерпретация multiline hooks.

## Decisions

### 1. Artifact-owned `path` с опциональным `prepare`

Каждый consumer получает обязательный стабильный `path`. Опциональный `prepare.command` производит новый candidate; без `prepare` файл считается статическим пользовательским input.

Это выбрано вместо `useSingboxctl` или `source.type: singboxctl|file`, потому что `openwrtctl` не должен перечислять известных producers. Наличие `prepare` описывает способ обновления артефакта, а `path` всегда даёт наблюдаемый результат для ручной проверки.

### 2. Producer запускается как argv без shell

`prepare.command` — массив строк. Ровно один argv-элемент должен быть равен `{output}` и заменяется уникальным candidate path рядом с настроенным `path`; подстроки не принимаются. `prepare.cwd` разрешается относительно config directory и по умолчанию равен ему. `prepare.cwd` без команды является config error.

argv устраняет неявный quoting и shell injection. Если producer действительно требует pipeline, пользователь создаёт отдельный POSIX `sh` executable в `rc/bin`; поэтому multiline `preSync` не нужен.

### 3. Validate-before-persist и immutable snapshot

Порядок одного artifact source:

```text
resolve -> prepare candidate -> read -> service validate -> chmod 0600
        -> atomic rename to path -> retain byte snapshot
```

Candidate создаётся внутри уникального sibling staging directory с mode `0700`, чтобы временно слабые producer permissions не раскрывали содержимое и rename оставался атомарным. Результат принимается только после `lstat`, подтверждающего regular file, а symlink отклоняется. Для producer source отсутствующий parent создаётся с mode `0700`; static source ничего не создаёт. Ошибка, timeout, missing/non-regular output или validation failure удаляют staging directory и сохраняют предыдущий `path`. Remote sync получает уже прочитанный snapshot и не открывает `path` повторно, закрывая TOCTOU между проверкой и upload.

### 4. Общий runner, разные payload contracts

Общими остаются только path resolution, producer execution, timeout, candidate cleanup, atomic persistence и snapshotting.

- sing-box artifact — полный финальный JSON; `openwrtctl` рассматривает его как opaque bytes после локальной JSON-проверки и не применяет semantic patch.
- AdGuard artifact — top-level YAML sequence нативных `filtering.rewrites`; consumer заменяет только этот subtree, продолжает применять существующие upstream/bootstrap/mode/port/querylog settings из config и сохраняет остальные runtime-поля. Поле `adguard.rewriteIp` удаляется: `answer` принадлежит producer artifact.
- nfqws2 artifact — YAML mapping `userList`/`ipsetList`; consumer валидирует строки и сохраняет текущую сборку управляемых list files.

Один универсальный payload или policy manifest отклонён: у трёх сервисов разные semantics, validation и rollback boundaries.

### 5. Все snapshots готовятся до первой remote mutation

Команда общего `sync` становится единым процессом: загружает config, вызывает экспортированные prepare/validate functions для всех трёх артефактов, хранит snapshots в памяти и только затем вызывает экспортированные service apply functions в существующем порядке. Отдельные `sync-<service>` используют те же prepare/apply functions, но готовят только свой артефакт. Snapshots не передаются через повторное чтение файлов или дочерние sync-процессы.

Это требует вынести orchestration из модели, где каждый child script сам генерирует input непосредственно перед apply. Межсервисной транзакции после начала apply не появляется, но локальная ошибка позднего producer больше не оставит роутер в частично обновлённом состоянии.

### 6. Персональные producers являются внешней deployment-предпосылкой

Три ожидаемые команды — `openwrtctl-singbox-config`, `openwrtctl-adguard-rewrites`, `openwrtctl-nfqws2-resources` — должны быть отдельно реализованы в `/Users/super/git/rc/bin` на POSIX `sh`, использовать `set -eu`, `umask 077`, проверять внешние CLI через `command -v` и создавать deterministic output через temporary file + atomic rename.

Именно там остаются `singboxctl`, профиль `router`, rule-set metadata, источник AdGuard `answer` и персональные преобразования. Источник `answer` задаётся rc-local config либо явным producer argument, но не полем `openwrtctl` config. `jq` и при необходимости Mike Farah `yq` v4 являются зависимостями этих локальных producers, а не npm runtime dependency `openwrtctl`. Создание этих скриптов требует отдельного change в `rc` либо ручного выполнения master-плана `tasks/refactor-prepare-path.md`.

### 7. Hard cut выполняется одним consumer/schema изменением

Новый config parser требует `openwrt` и `backup`, принимает любое подмножество service-секций и требует artifact `path` только внутри присутствующих `singbox`, `adguard` и `nfqws2`. Sync и другие команды, которым нужны настройки отсутствующего сервиса, отклоняются с явной ошибкой. Общий `sync` сначала готовит artifacts всех настроенных сервисов, затем применяет только их в фиксированном порядке AdGuard Home → sing-box → nfqws2; config без service-секций отклоняется командой `sync` до remote mutation. Старая секция `singboxctl` по-прежнему отклоняется. `config.example.yaml` переключается одновременно с consumers; внешний deployment-шаг переводит локальный `~/.config/openwrtctl/config.yaml` до первого запуска нового runtime. Cleanup старого parser/generator layer выполняется следующим отдельным инкрементом, когда новый runtime уже зелёный.

Такой порядок даёт ясную рабочую границу и отдельно обратимый cleanup, не создавая временного публичного dual-source контракта. Наличие service-секции является единственным признаком управления сервисом; отдельный boolean `enabled` не нужен.

## Risks / Trade-offs

- [Произвольный producer является исполняемой trust boundary] → запускать только argv без shell, не поддерживать config-level environment injection и не логировать секретные аргументы/вывод.
- [POSIX `sh` не решает JSON/YAML parsing] → явно проверять `jq`/`yq` и фиксировать совместимые версии в сообщениях `--help` и README `rc` scripts.
- [Producer может вернуть код 0, но не создать свежий output] → выдавать уникальный отсутствующий candidate path и принимать только созданный regular file.
- [Форматы артефактов могут расходиться между двумя репозиториями] → держать canonical fixtures и consumer validation в `openwrtctl`, а producer fixtures проверять против тех же примеров/контракта.
- [Remote restart может завершиться после установки candidate] → сохранить текущие service-level backup/rollback; отдельно проверить и усилить sing-box/nfqws2 rollback до live smoke.
- [Hard cut временно ломает локальный запуск при неверном порядке репозиториев] → сначала поставить и проверить additive producers в `rc`, затем одним изменением переключить config и consumers.

## Deployment Order

Это deployment sequence, а не пользовательская миграция старого формата:

1. В отдельном `rc` change добавить и проверить три POSIX producer в `/Users/super/git/rc/bin`; `openwrtctl` продолжает работать по старому пути.
2. Добавить в `openwrtctl` изолированный artifact runner и unit tests без подключения к config/consumers.
3. Одним hard-cut изменением переключить schema и все три consumers в `openwrtctl`.
4. Внешним deployment-шагом создать приватную резервную копию локального config с mode `0600`, переключить его на новый контракт без вывода содержимого и выполнить local/remote validation; при ошибке откатить consumer/schema change и восстановить backup.
5. Удалить старые parser/generator modules и npm dependency отдельным cleanup change, затем обновить README/changeset.

Локальный config после переключения должен сохранить пользовательские значения и mode `0600`. Постороннее изменение `/Users/super/git/rc/.config/sitectl/caddy/sites/cz.shura.dev/Caddyfile` не входит в change и не должно попадать в staging.
