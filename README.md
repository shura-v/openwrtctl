# openwrtctl

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
- nfqws2 из embedded-релиза zapret2 для `aarch64`;
- локальные Node.js 22+, `npm`, `ssh` и `rsync`.

## Установка

```sh
npm install
npm link
openwrtctl init
```

`init` создаёт `~/.config/openwrtctl/config.yaml` из шаблона, выставляет права
`0600` и сохраняет существующий файл без изменений. Заполните endpoint, AdGuard
rewrite IP, профиль и каталог rule sets. Относительные пути разрешаются от
каталога выбранного config-файла.

## Использование

```sh
openwrtctl --config /path/to/config.yaml prepare-router
openwrtctl --config /path/to/config.yaml install-adguard
openwrtctl --config /path/to/config.yaml install-singbox
openwrtctl --config /path/to/config.yaml install-nfqws2
openwrtctl --config /path/to/config.yaml sync
```

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
