# openwrtctl

[![CI](https://github.com/shura-v/openwrtctl/actions/workflows/ci.yml/badge.svg)](https://github.com/shura-v/openwrtctl/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/openwrtctl.svg)](https://www.npmjs.com/package/openwrtctl)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://raw.githubusercontent.com/shura-v/openwrtctl/main/LICENSE)

`openwrtctl` управляет домашним OpenWrt-роутером с локального компьютера:

- подготавливает OpenWrt и блокирует QUIC;
- устанавливает, обновляет, синхронизирует и удаляет AdGuard Home, sing-box и
  nfqws2;
- создаёт и восстанавливает стандартные OpenWrt backup-архивы;
- локально генерирует конфиги из профиля `singboxctl`, проверяет их на роутере
  и только затем применяет.

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
`0600` и сохраняет существующий файл без изменений. Заполните endpoint, AdGuard
rewrite IP и DNS-настройки, профиль и каталог rule sets. `adguard.upstreamDns`,
`adguard.bootstrapDns` и `adguard.upstreamMode` управляют соответствующими полями
`dns.*` в AdGuard Home. Относительные пути разрешаются от каталога выбранного
config-файла.

## Использование

```sh
openwrtctl prepare-router
openwrtctl install-adguard
openwrtctl install-singbox
openwrtctl install-nfqws2
openwrtctl sync
```

Для быстрой read-only проверки роутера используйте `doctor`. Команда показывает
модель, версию OpenWrt, uptime, источник и свободное место overlay, а также
состояние AdGuard Home, sing-box и zapret2:

```sh
openwrtctl doctor
```

Команды по умолчанию читают `~/.config/openwrtctl/config.yaml`. Опция
`--config /path/to/config.yaml` позволяет явно выбрать другой файл.

Для выбранных сервисов доступны команды `install-*`, `update-*`, `uninstall-*`
и `sync-*`. Общая команда `sync` последовательно синхронизирует AdGuard Home,
sing-box и nfqws2.

`disable-singbox` — шаг аварийного отката: он останавливает sing-box, убирает
автозапуск и сохраняет установленный пакет и конфиг для диагностики.

`disable-nfqws2` останавливает zapret2, убирает автозапуск и активную nftables
таблицу, выставляет `NFQWS2_ENABLE=0`, сохраняя установку и конфиг. Следующий
`sync-nfqws2` снова применяет рабочий конфиг и включает сервис.

Router-конфиг ограничивает TUN входящим интерфейсом `br-lan`, исключает private
сети, отключает `strict_route` и удаляет DNS hijack. Соединения самого роутера,
включая AdGuard upstream и разрешение proxy endpoint, не направляются в TUN.

Установка nfqws2 принимает конкретную версию zapret2:

```sh
openwrtctl install-nfqws2 --version=1.0.4
openwrtctl update-nfqws2 --version=1.0.4
```

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
