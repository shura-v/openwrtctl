## Why

The public `adguard` configuration currently keeps DNS settings at the same level as web, query-log, and rules settings even though they are written into the native AdGuard Home `dns` section. Introducing an explicit `adguard.dns` object makes that boundary visible and provides one coherent place for DNS rate-limit, EDNS Client Subnet, and cache settings.

## What Changes

- **BREAKING**: Move every managed DNS setting from flat `adguard.*` fields into a required `adguard.dns` object whenever `adguard` is configured.
- Rename `adguard.dnsPort` to `adguard.dns.port`; keep the remaining managed DNS names in camelCase under `adguard.dns`.
- Replace the boolean EDNS setting with an `adguard.dns.ednsClientSubnet` object that exposes `enabled`, `useCustom`, and `customIp`.
- Add optional cache settings `cacheSize`, `cacheTtlMin`, `cacheTtlMax`, and `cacheOptimistic`, with deterministic defaults and validation.
- Update conversion to write the nested public settings to the corresponding native `AdGuardHome.yaml` fields under `dns`, while preserving unrelated native configuration.
- Reject the removed flat DNS fields instead of silently accepting or migrating them.
- Update the example configuration, README, tests, and release changeset for the breaking contract.
- Exclude all files under `~/git/rc` from this change; personal configurations will be migrated separately after the library change is implemented.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `adguard-settings-sync`: Change the public AdGuard DNS configuration shape, add cache and structured EDNS settings, and define their conversion into native AdGuard Home YAML.

## Impact

- Public YAML configuration consumed by `scripts/lib/config.js` and AdGuard-specific commands.
- Shared AdGuard settings schema, standalone generator arguments, and native YAML conversion.
- Configuration examples, README documentation, automated tests, and semver release metadata.
- Existing configurations using flat `adguard.dnsPort`, `upstreamDns`, `bootstrapDns`, `upstreamMode`, rate-limit fields, or boolean `ednsClientSubnet` must be migrated before using the new release.
- Personal configuration files in `/Users/super/git/rc` are explicitly outside this change.
