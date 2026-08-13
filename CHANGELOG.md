# openwrtctl

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
