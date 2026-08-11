# openwrtctl

## 0.3.0

### Minor Changes

- 9816be3: Configure AdGuard Home upstream DNS servers, bootstrap DNS servers, and upstream mode through `config.yaml`.

  Existing configurations must add `adguard.upstreamDns`, `adguard.bootstrapDns`, and `adguard.upstreamMode` before upgrading.

## 0.2.0

### Minor Changes

- 5d2e298: Add a read-only `doctor` command for router, overlay storage, and managed service status.

### Patch Changes

- 5d2e298: Use the RAM-backed `/tmp/openwrtctl` directory for remote staging by default.
