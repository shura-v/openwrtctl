# Контракт локальных артефактов

`openwrtctl` получает готовые локальные артефакты через обязательный `path`.
Артефакт можно поддерживать вручную или обновлять внешней командой из
`prepare.command` перед каждой синхронизацией.

## Producer command

`prepare.command` задаётся как argv-массив и запускается напрямую, без shell.
Ровно один отдельный аргумент должен быть равен `{output}`. `openwrtctl`
подставляет вместо него уникальный временный путь рядом с `path`. Producer
должен записать по этому пути новый regular file и завершиться с кодом `0`.

Producer запускается из `prepare.cwd`; значение по умолчанию — каталог
выбранного `config.yaml`. Относительные пути и `~` разрешаются относительно
этого же контекста. Аргументы, stdout, stderr и окружение producer не считаются
безопасным местом для диагностического вывода секретов.

Рекомендуемые команды из пользовательского `PATH`:

```yaml
singbox:
  config:
    path: artifacts/sing-box.json
    prepare:
      command: [openwrtctl-singbox-config, router, "{output}"]

adguard:
  rewrites:
    path: artifacts/adguard-rewrites.yaml
    prepare:
      command: [openwrtctl-adguard-rewrites, router, "{output}"]

nfqws2:
  resources:
    path: artifacts/nfqws2-resources.yaml
    prepare:
      command: [openwrtctl-nfqws2-resources, router, "{output}"]
```

Команды могут использовать собственные профили, каталоги правил и локальные
секреты. Эти детали остаются за границей runtime-контракта `openwrtctl`.

## Форматы

`openwrtctl-singbox-config` создаёт полный финальный JSON sing-box. После
локальной JSON-проверки байты передаются на удалённую `sing-box check` и затем
устанавливаются без изменения TUN, DNS, outbounds и route rules.

`openwrtctl-adguard-rewrites` создаёт top-level YAML sequence нативных записей
AdGuard Home `filtering.rewrites`:

```yaml
- domain: example.ru
  answer: 192.0.2.10
```

Каждая запись содержит непустые строки `domain` и `answer`. Опциональное
boolean-поле `enabled` сохраняется; при отсутствии consumer устанавливает
`enabled: true`. Повтор одного domain с разными answers является ошибкой.
Пустой список задаётся как `[]`.

`openwrtctl-nfqws2-resources` создаёт YAML mapping из двух строковых списков:

```yaml
userList:
  - example.com
ipsetList:
  - 192.0.2.0/24
```

Элементы не содержат переводы строк. Оба ключа обязательны; пустые списки
задаются как `[]`.

## Безопасная публикация

Producer должен использовать POSIX `sh`, `set -eu`, `umask 077`, проверять
внешние CLI через `command -v` и сначала писать в собственный temporary file.
`openwrtctl` дополнительно проверяет candidate через `lstat`, отклоняет symlink
и non-regular output, валидирует содержимое, сохраняет `path` атомарным rename
с mode `0600` и использует уже прочитанный immutable snapshot.

Если `prepare` отсутствует, `path` считается статическим input. Его parent и
сам файл должны существовать; `openwrtctl` ничего не создаёт и не изменяет.
