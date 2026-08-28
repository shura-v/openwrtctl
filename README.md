# openwrtctl

[![CI](https://github.com/shura-v/openwrtctl/actions/workflows/ci.yml/badge.svg)](https://github.com/shura-v/openwrtctl/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/openwrtctl.svg)](https://www.npmjs.com/package/openwrtctl)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/shura-v/openwrtctl/main/LICENSE)

`openwrtctl` управляет домашним OpenWrt-роутером с локального компьютера:

- подготавливает OpenWrt и блокирует QUIC;
- устанавливает, обновляет, синхронизирует и удаляет AdGuard Home, sing-box и
  nfqws2;
- создаёт и восстанавливает стандартные OpenWrt backup-архивы;
- принимает готовые локальные артефакты, проверяет их формат и только затем
  валидирует и применяет конфигурацию на роутере.

## Граница поддержки

- OpenWrt 25.12+ с пакетным менеджером `apk`;
- firewall4/nftables и стандартный LAN-интерфейс `br-lan`;
- полный штатный пакет `sing-box`;
- nfqws2 из embedded-релиза zapret2 для поддерживаемой архитектуры OpenWrt;
- локальные Node.js 22+, `npm`, `ssh` и `rsync`.

## Установка

```sh
npm install -g openwrtctl
openwrtctl init
```

`init` создаёт `~/.config/openwrtctl/config.yaml` из шаблона, выставляет права
`0600` и сохраняет существующий файл без изменений. Заполните endpoint и секции
только тех сервисов, которыми должен управлять `openwrtctl`. В шаблоне уже задан
`adguard.dnsPort: 5353`; `adguard.dnsPort`, `adguard.upstreamDns` и
`adguard.upstreamMode` управляют соответствующими полями `dns.*` в AdGuard Home.
Опциональный `adguard.bootstrapDns` заменяет `dns.bootstrap_dns`; при отсутствии
поля синхронизация записывает пустой список. `nfqws2.test.httpsDomains` задаёт
непустой список доменов для HTTPS-проверки стратегий.

Секции `singbox`, `adguard` и `nfqws2` опциональны. Каждая присутствующая секция
полностью валидируется и требует свой artifact `path`; service-команда для
sync или другая команда, которой нужны её настройки, завершается явной ошибкой
при отсутствии секции. Опциональный `prepare.command`
задаётся argv-массивом и должен содержать ровно один отдельный аргумент
`{output}`. Опциональный `prepare.cwd` задаёт рабочий каталог; по умолчанию
используется каталог выбранного config-файла. Относительные пути разрешаются от
этого каталога, `~` поддерживается явно.

```yaml
openwrt:
  endpoint: root@192.168.1.1
  sshPort: 22
  remoteTmpDir: /tmp/openwrtctl

backup:
  directory: ~/backups/openwrt

singbox:
  config:
    path: artifacts/sing-box.json
    prepare:
      command: [openwrtctl-singbox-config, router, "{output}"]
```

Это полный минимальный config для управления только sing-box. При необходимости
добавляются независимые секции:

```yaml
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

В секции `adguard` укажите ровно один источник правил. Для пользовательских
фильтров AdGuard Home замените `rewrites` на `userRules`:

```yaml
adguard:
  userRules:
    path: artifacts/adguard-user-rules.yaml
    prepare:
      command: [openwrtctl-adguard-custom-rewrites, "{output}"]
```

Без `prepare` существующий файл по `path` используется как статический input.
Producer запускается напрямую, без shell-интерпретации. Его candidate проходит
проверку до атомарной замены `path`; текущая синхронизация использует уже
прочитанный snapshot. Доверяйте только собственным producer executable: команда
работает с правами пользователя `openwrtctl` и может читать доступные ему файлы.

Форматы артефактов:

- `singbox.config.path` — полный финальный JSON sing-box, применяемый без
  локального semantic patch;
- `adguard.rewrites.path` — top-level YAML sequence нативных элементов
  `filtering.rewrites` с полями `domain`, `answer` и опциональным `enabled`;
  отсутствие `enabled` означает `true`;
- `adguard.userRules.path` — top-level YAML sequence непустых однострочных
  значений корневого списка `user_rules` AdGuard Home;
- `nfqws2.resources.path` — YAML mapping со строковыми массивами `userList` и
  `ipsetList`.

Полный producer contract и примеры форматов находятся в
[`docs/artifact-producers.md`](docs/artifact-producers.md).

## Использование

```sh
openwrtctl prepare-router
openwrtctl install-adguard
openwrtctl install-singbox
openwrtctl install-nfqws2
openwrtctl sync
```

После `install-adguard` завершите первичную настройку AdGuard Home вручную через
его web-интерфейс и выберите DNS-порт `5353`, уже заданный в шаблоне.
Последующий `sync-adguard` применяет `adguard.dnsPort` к `dns.port` AdGuard Home
и направляет стандартный upstream `dnsmasq` на `127.0.0.1:<adguard.dnsPort>`.
В режиме `adguard.rewrites` синхронизация заменяет `filtering.rewrites` и очищает
`user_rules`. В режиме `adguard.userRules` она заменяет `user_rules` и очищает
`filtering.rewrites`, поэтому ручные и обычные rewrite-правила не смешиваются.
Если в `dnsmasq` уже задан пользовательский upstream, синхронизация завершится
ошибкой и сохранит его без изменений. `uninstall-adguard` восстанавливает
стандартный upstream OpenWrt до остановки AdGuard Home.

Для быстрой read-only проверки роутера используйте `doctor`. Команда показывает
модель, процессор, версию OpenWrt, uptime, источник и свободное место overlay,
а также состояние AdGuard Home, sing-box и zapret2:

```sh
openwrtctl doctor
```

Команды по умолчанию читают `~/.config/openwrtctl/config.yaml`. Опция
`--config /path/to/config.yaml` позволяет явно выбрать другой файл.

Для настроенных сервисов доступны команды `install-*`, `update-*`, `uninstall-*`
и `sync-*`. Общая команда `sync` сначала подготавливает и проверяет snapshots
всех присутствующих service-секций, затем применяет только их в порядке
AdGuard Home, sing-box, nfqws2. Ошибка любого producer останавливает запуск до
первого изменения роутера.

`disable-singbox` — шаг аварийного отката: он останавливает sing-box, убирает
автозапуск и сохраняет установленный пакет и конфиг для диагностики.

`disable-nfqws2` останавливает zapret2, убирает автозапуск и активную nftables
таблицу, выставляет `NFQWS2_ENABLE=0`, сохраняя установку и конфиг. Следующий
`sync-nfqws2` снова применяет рабочий конфиг и включает сервис.

Полный sing-box JSON принадлежит producer. `openwrtctl` сохраняет его TUN, DNS,
outbounds и route rules без изменения и устанавливает только snapshot, успешно
прошедший удалённую `sing-box check`.

Установка nfqws2 принимает конкретную версию zapret2:

```sh
openwrtctl install-nfqws2 --version=1.0.4
openwrtctl update-nfqws2 --version=1.0.4
```

`test-nfqws2` запускает встроенный `blockcheck2.sh` только для HTTPS по TCP:
TLS 1.2 и TLS 1.3 включены, HTTP и HTTP/3 (QUIC) отключены. Команда временно
останавливает managed zapret2 и запускает его снова после завершения или ошибки,
если сервис работал до проверки. Полный лог сохраняется на роутере в
`<openwrt.remoteTmpDir>/nfqws2-test.log`.

```sh
openwrtctl test-nfqws2
openwrtctl test-nfqws2-results
```

`test-nfqws2-results` читает сохранённый лог и выводит только стратегии nfqws2,
успешные в HTTPS-проверках TLS 1.2 или TLS 1.3.

`backup` сохраняет архив в `backup.directory`. `restore` принимает явный путь:

```sh
openwrtctl restore ~/backups/openwrt/openwrt-backup-….tar.gz
```

## Релизы

Первый merge release-инфраструктуры в `main` публикует ещё отсутствующий в npm
`openwrtctl@0.1.0`. Для следующих пользовательских изменений добавляйте
Changeset в feature PR:

```sh
npm run changeset
```

После merge GitHub Actions создаёт release PR с новой версией и changelog.
Merge release PR публикует пакет в npm, создаёт Git tag и GitHub Release.
