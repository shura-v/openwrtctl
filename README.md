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
`adguard.dns.port: 5353`. В присутствующей секции `adguard` обязательны
`webPort` и mapping `dns` с полями `port` и непустым `upstreamDns`.
`querylogInterval` по умолчанию равен `6h`. Опциональные DNS-поля получают
следующие defaults: `bootstrapDns: []`, `upstreamMode: load_balance`,
`rateLimit: 0`, длины rate-limit подсетей `24` и `56`, пустой whitelist,
выключенный EDNS Client Subnet, cache размером `4194304` байт, TTL `0`/`0` и
выключенное optimistic caching.

| Поле config | Поле AdGuard Home YAML |
| --- | --- |
| `adguard.dns.port` | `dns.port` |
| `adguard.dns.upstreamDns` | `dns.upstream_dns` |
| `adguard.dns.bootstrapDns` | `dns.bootstrap_dns` |
| `adguard.dns.upstreamMode` | `dns.upstream_mode` |
| `adguard.dns.rateLimit` | `dns.ratelimit` |
| `adguard.dns.rateLimitSubnetLenIpv4` | `dns.ratelimit_subnet_len_ipv4` |
| `adguard.dns.rateLimitSubnetLenIpv6` | `dns.ratelimit_subnet_len_ipv6` |
| `adguard.dns.rateLimitWhitelist` | `dns.ratelimit_whitelist` |
| `adguard.dns.ednsClientSubnet.*` | `dns.edns_client_subnet.{enabled,use_custom,custom_ip}` |
| `adguard.dns.cacheSize` | `dns.cache_size` |
| `adguard.dns.cacheTtlMin` | `dns.cache_ttl_min` |
| `adguard.dns.cacheTtlMax` | `dns.cache_ttl_max` |
| `adguard.dns.cacheOptimistic` | `dns.cache_optimistic` |

`cacheTtlMin` не может быть больше `cacheTtlMax`. При `useCustom: true` поле
`customIp` должно содержать IPv4- или IPv6-адрес. `nfqws2.test.httpsDomains`
задаёт непустой список доменов для HTTPS-проверки стратегий.

### Переход на `adguard.dns`

Плоские DNS-поля `adguard.dnsPort`, `adguard.upstreamDns`,
`adguard.bootstrapDns`, `adguard.upstreamMode`, rate-limit и EDNS поля больше не
принимаются. Перенесите их в `adguard.dns`, переименуйте `dnsPort` в `port` и
замените булево значение EDNS на mapping:

```yaml
adguard:
  webPort: 8080
  querylogInterval: 6h
  dns:
    port: 5353
    upstreamDns: [https://cloudflare-dns.com/dns-query]
    bootstrapDns: []
    upstreamMode: load_balance
    rateLimit: 0
    rateLimitSubnetLenIpv4: 24
    rateLimitSubnetLenIpv6: 56
    rateLimitWhitelist: []
    ednsClientSubnet:
      enabled: false
      useCustom: false
      customIp: ""
    cacheSize: 4194304
    cacheTtlMin: 0
    cacheTtlMax: 0
    cacheOptimistic: false
```

Старая форма завершается ошибкой локальной валидации до подготовки артефактов
и изменений на роутере. `openwrtctl init` не перезаписывает существующий config,
поэтому миграция выполняется вручную перед обновлением.

Секции `singbox`, `adguard` и `nfqws2` опциональны. Каждая присутствующая секция
полностью валидируется; `singbox` и `nfqws2` требуют свой artifact `path`, а
`adguard` может работать только с настройками без artifact. Service-команда для
sync или другая команда, которой нужны настройки отсутствующей секции,
завершается явной ошибкой. Опциональный `prepare.command` задаётся argv-массивом
и должен содержать ровно один отдельный аргумент `{output}`. Опциональный
`prepare.cwd` задаёт рабочий каталог; по умолчанию используется каталог
выбранного config-файла. Относительные пути разрешаются от этого каталога, `~`
поддерживается явно.

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
  webPort: 8080
  dns:
    port: 5353
    upstreamDns:
      - https://cloudflare-dns.com/dns-query

nfqws2:
  resources:
    path: artifacts/nfqws2-resources.yaml
    prepare:
      command: [openwrtctl-nfqws2-resources, router, "{output}"]
```

Это settings-only режим AdGuard Home: источник правил не обязателен. Для
управления rewrite-правилами добавьте не более одного из `rewrites` или
`userRules`:

```yaml
adguard:
  webPort: 8080
  dns:
    port: 5353
    upstreamDns: [https://cloudflare-dns.com/dns-query]
  rewrites:
    path: artifacts/adguard-rewrites.yaml
    prepare:
      command: [openwrtctl-adguard-rewrites, router, "{output}"]
```

Для пользовательских фильтров AdGuard Home замените `rewrites` на `userRules`:

```yaml
adguard:
  webPort: 8080
  dns:
    port: 5353
    upstreamDns: [https://cloudflare-dns.com/dns-query]
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
Последующий `sync-adguard` применяет `adguard.dns.port` к `dns.port` AdGuard Home
и направляет стандартный upstream `dnsmasq` на
`127.0.0.1:<adguard.dns.port>`.
В режиме `adguard.rewrites` синхронизация заменяет `filtering.rewrites` и очищает
`user_rules`. В режиме `adguard.userRules` она заменяет `user_rules` и очищает
`filtering.rewrites`. Settings-only режим без обоих источников очищает оба
списка, поэтому результат не зависит от правил, оставленных предыдущей
синхронизацией. Ручные правила в управляемых списках при этом не сохраняются.
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
