## Context

See `proposal.md` for motivation and `specs/adguard-settings-sync/spec.md` for the behavioral contract. Today one shared Zod schema validates flat AdGuard settings for project config loading and native YAML generation. `sync-adguard` then copies each flat value into the generator and separately reads `adguard.dnsPort` for readiness and dnsmasq configuration. The generator patches an existing `AdGuardHome.yaml` document and preserves paths it does not manage.

The new shape crosses the project-config validator, shared settings schema, synchronization consumer, lifecycle consumers, standalone generator, tests, examples, documentation, and release metadata. Personal files outside this repository are not part of the implementation.

## Goals / Non-Goals

**Goals:**

- Make `adguard.dns` the single public boundary for every managed native DNS setting.
- Keep validation and defaulting centralized so project config and standalone generation accept the same values.
- Convert the normalized nested object into native AdGuard Home field names without replacing unrelated YAML sections.
- Fail old flat configurations before preparing artifacts or mutating the router.

**Non-Goals:**

- Automatic migration or compatibility aliases for the removed flat fields.
- Editing or validating any configuration under `/Users/super/git/rc`.
- Exposing unrelated AdGuard Home DNS fields such as `cache_enabled`, fallback resolvers, access lists, or DNSSEC settings.
- Changing rules-source behavior, transaction rollback, dnsmasq ownership, or readiness semantics.

## Decisions

### 1. Match the native DNS boundary while retaining project naming conventions

The public contract will use this shape:

```yaml
adguard:
  webPort: 8080
  querylogInterval: 6h
  dns:
    port: 5353
    upstreamDns:
      - 1.1.1.1
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

The `dns` boundary follows AdGuard Home, while camelCase remains consistent with the rest of the project config. Rate-limit and cache fields stay flat inside `dns`, matching the native grouping and avoiding project-only substructures.

Alternative considered: retain all existing names and only wrap them in `dns`. This leaves `dns.dnsPort`, which repeats the section name and preserves the mapping problem the change is intended to solve.

Alternative considered: introduce nested `rateLimit` and `cache` objects. This creates structure that AdGuard Home does not have and adds conversion complexity without a separate behavioral boundary.

### 2. Compose strict root and DNS schemas

The shared settings contract will contain a strict root schema for `querylogInterval`, `webPort`, and `dns`, plus a strict nested DNS schema. `dns.port` and `dns.upstreamDns` remain required. Optional DNS fields receive defaults in the shared schema, including a complete default EDNS object and cache defaults of 4 MiB, zero minimum TTL, zero maximum TTL, and optimistic caching disabled.

Cross-field refinement will enforce `cacheTtlMin <= cacheTtlMax`. EDNS refinement will require a valid IP address when `useCustom` is true, while allowing the default empty `customIp` when it is false. Error formatting must preserve the complete nested path so users see fields such as `adguard.dns.cacheTtlMin`.

Strict schemas deliberately reject every removed flat field. No preprocessing or compatibility transform will be added, because silent migration would weaken the breaking contract and could hide a partially migrated configuration.

### 3. Pass the normalized object through consumers

Config loading will return `adguard` with nested `dns` intact. Synchronization, lifecycle, and uninstall consumers will read the listener port from `adguard.dns.port`. The generator will receive the normalized root settings object and validate it through the same shared parser before patching YAML.

The standalone generator will construct that same nested input from its arguments and run it through the shared parser. Its argument parsing may remain positional, but it must expose and validate the structured EDNS and cache values rather than maintaining an independent contract.

Alternative considered: flatten the normalized result after validation to reduce consumer changes. This would keep two internal representations and make it easy for future DNS fields to bypass the intended boundary.

### 4. Patch explicit native paths

Conversion will use this mapping:

| Public field | Native AdGuard Home field |
| --- | --- |
| `dns.port` | `dns.port` |
| `dns.upstreamDns` | `dns.upstream_dns` |
| `dns.bootstrapDns` | `dns.bootstrap_dns` |
| `dns.upstreamMode` | `dns.upstream_mode` |
| `dns.rateLimit` | `dns.ratelimit` |
| `dns.rateLimitSubnetLenIpv4` | `dns.ratelimit_subnet_len_ipv4` |
| `dns.rateLimitSubnetLenIpv6` | `dns.ratelimit_subnet_len_ipv6` |
| `dns.rateLimitWhitelist` | `dns.ratelimit_whitelist` |
| `dns.ednsClientSubnet.*` | `dns.edns_client_subnet.{enabled,use_custom,custom_ip}` |
| `dns.cacheSize` | `dns.cache_size` |
| `dns.cacheTtlMin` | `dns.cache_ttl_min` |
| `dns.cacheTtlMax` | `dns.cache_ttl_max` |
| `dns.cacheOptimistic` | `dns.cache_optimistic` |

Normalized defaults are written explicitly, so these cache and EDNS paths become managed configuration. Existing values at those paths are replaced; unrelated native paths remain untouched.

## Risks / Trade-offs

- [Existing configs stop loading after upgrade] → Publish a major changeset, document the exact before/after shape, and fail during local validation before remote mutation.
- [Omitted cache fields overwrite router-specific cache values] → Document that cache settings are now managed and provide deterministic defaults matching AdGuard Home defaults.
- [Nested validation errors become generic] → Extend shared error-path formatting and test errors for root, DNS, EDNS, and cache fields.
- [A remaining consumer reads `adguard.dnsPort`] → Search all code consumers and add focused synchronization, lifecycle, uninstall, and aggregate command regressions.

## Migration Plan

1. Release the change as a semver major update with the new example and README migration snippet.
2. Require users to move all managed DNS fields into `adguard.dns`, rename `dnsPort` to `port`, and replace the EDNS boolean with the structured object before running sync.
3. Validate the migrated config locally; invalid or old-shaped configs stop before router mutation.
4. Roll back by restoring the previous package version together with the previous flat project config. Router state does not require rollback when validation rejects the new config locally.
