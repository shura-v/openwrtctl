# openwrtctl

## 2.0.0

### Major Changes

- 258b32b: DNS-настройки AdGuard перенесены в обязательный mapping `adguard.dns`: `dnsPort` переименован в `dns.port`, остальные DNS-поля вложены без compatibility aliases.
  Добавлено управление cache и полной EDNS Client Subnet mapping с общей валидацией project config, генератора и standalone CLI.

### Patch Changes

- 6d8aeb2: Добавлена settings-only синхронизация AdGuard Home без обязательного источника правил, defaults для `querylogInterval` и `upstreamMode`, а также управление rate-limit и EDNS Client Subnet настройками.
  Единая Zod-схема теперь валидирует эти настройки в project config, генераторе и standalone CLI до записи AdGuard Home YAML.
- bbc9a56: Поле `adguard.dns.bootstrapDns` сделано опциональным: при его отсутствии bootstrap DNS AdGuard Home очищаются.

## 1.1.0

### Minor Changes

- bbc9a56: Добавлен взаимоисключающий источник `adguard.userRules` для управления пользовательскими правилами AdGuard Home.

### Patch Changes

- bbc9a56: Добавлен вывод процессора роутера в `openwrtctl doctor`.
- bbc9a56: Поле `adguard.bootstrapDns` сделано опциональным: при его отсутствии bootstrap DNS AdGuard Home очищаются.

## 1.0.0

### Major Changes

- dfd16e1: Replace the embedded singboxctl pipeline with local artifact paths, optional shell-free producer commands, and independently optional sing-box, AdGuard, and nfqws2 service sections.

## 0.5.1

### Patch Changes

- 3e8508a: Настроена автоматическая передача DNS-запросов из dnsmasq в AdGuard Home при синхронизации и восстановление стандартного upstream OpenWrt при удалении AdGuard Home.

## 0.5.0

### Minor Changes

- 98f0a03: Add HTTPS-only nfqws2 strategy testing, install its `ncat` prerequisite during router preparation, and provide a separate command that prints successful TLS 1.2 and TLS 1.3 strategies from the saved router log.

  Existing configurations must add `nfqws2.test.httpsDomains` before upgrading.

## 0.4.0

### Minor Changes

- 03851da: Keep the router DNS service unchanged and manage the AdGuard Home DNS listener through `adguard.dnsPort`, which defaults to `5353` in the config template.

  Existing configurations must add `adguard.dnsPort` before upgrading.

### Patch Changes

- 03851da: Stage nfqws2 release archives in RAM and keep only the current router architecture when installing, reducing persistent flash usage on small OpenWrt devices.

## 0.3.1

### Patch Changes

- 393d164: Disable sing-box autostart before stopping the service so a shutdown failure cannot leave it enabled for the next boot.

## 0.3.0

### Minor Changes

- 9816be3: Configure AdGuard Home upstream DNS servers, bootstrap DNS servers, and upstream mode through `config.yaml`.

  Existing configurations must add `adguard.upstreamDns`, `adguard.bootstrapDns`, and `adguard.upstreamMode` before upgrading.

## 0.2.0

### Minor Changes

- 5d2e298: Add a read-only `doctor` command for router, overlay storage, and managed service status.

### Patch Changes

- 5d2e298: Use the RAM-backed `/tmp/openwrtctl` directory for remote staging by default.
