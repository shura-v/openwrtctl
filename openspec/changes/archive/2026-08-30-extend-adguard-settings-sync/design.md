## Context

See `proposal.md` for motivation. The current config parser requires exactly one AdGuard rules source and directly requires `querylogInterval` and `upstreamMode`. The AdGuard patcher already pulls the live YAML, changes selected fields, preserves unrelated runtime state, validates a staged candidate remotely, and applies it through a rollback-aware transaction.

## Goals / Non-Goals

**Goals:**

- Make AdGuard settings-only synchronization a first-class mode with deterministic rule clearing.
- Normalize safe optional defaults in the config library before values reach consumers.
- Manage the rate-limit and EDNS fields represented by the current AdGuard Home DNS settings schema.
- Preserve current remote validation, backup, rollback, readiness, and dnsmasq ownership behavior.

**Non-Goals:**

- Define or rename downstream consumer profiles and wrapper commands.
- Generate, patch, or own traffic-routing policy in consumer-provided sing-box artifacts.
- Support custom EDNS Client Subnet addresses in this increment.
- Change the AdGuard Home web API, authentication, filtering engine, or upstream protocol validation policy.

## Decisions

### 1. Normalize defaults in the project config parser

`validateAdguard` returns concrete values for every managed setting. `querylogInterval` defaults to `6h`; `upstreamMode` defaults to `load_balance`; `bootstrapDns`, the whitelist, and the five new settings receive the values listed in the spec. `webPort`, `dnsPort`, and `upstreamDns` remain required.

This keeps `sync-adguard` and `adguard-config` free of fallback logic and makes direct parser consumers observe the same contract. The alternative of defaulting in the YAML patcher would permit different behavior between validation, tests, and application.

### 2. Treat rules sources as a three-state mode

The parser accepts `rewrites`, `userRules`, or neither, and rejects both. Preparation returns an explicit mode plus a validated list; settings-only mode uses an empty validated list without invoking `prepareLocalArtifact`.

The patcher always writes both managed rule locations. In settings-only mode both become empty lists. Preserving remote rules when no source is configured was rejected because the resulting router state would depend on sync history.

### 3. Patch native DNS fields deterministically

The new config fields map as follows:

| Project config | AdGuard Home YAML |
| --- | --- |
| `rateLimit` | `dns.ratelimit` |
| `rateLimitSubnetLenIpv4` | `dns.ratelimit_subnet_len_ipv4` |
| `rateLimitSubnetLenIpv6` | `dns.ratelimit_subnet_len_ipv6` |
| `rateLimitWhitelist` | `dns.ratelimit_whitelist` |
| `ednsClientSubnet` | `dns.edns_client_subnet.enabled` |

The boolean EDNS field also writes `use_custom: false` and `custom_ip: ""`. A nested public object was rejected because the requested contract only enables or disables ECS and exposing custom addresses would add validation and privacy semantics not needed by this change.

The library validates shape and numeric ranges; IP/CIDR semantics in whitelist entries remain delegated to the existing remote `AdGuardHome --check-config` validation.

### 4. Preserve the remote transaction boundary

The existing pull → local backup → patch → push candidate → remote check → transactional apply sequence remains. New settings are included in the same candidate instead of being changed through the AdGuard web API, so rollback continues to cover the whole managed document.

### 5. Share one Zod schema across local entry points

A dedicated AdGuard settings schema owns defaults, types, ranges, string-list validation, and field-specific error formatting. `scripts/lib/config.js` uses it for the project YAML mapping, while the standalone `scripts/adguard-config.js` converts positional JSON/text arguments into an input object and parses that object through the same schema before writing YAML.

The YAML patcher continues to receive only normalized settings and contains no fallback logic. This keeps the parser, standalone CLI, tests, and future consumers on one runtime contract while preserving the current public error prefix for project config fields.

## Risks / Trade-offs

- [Settings-only mode clears manually maintained rules] → Document the rule ownership explicitly and retain the existing local backup before replacement.
- [Defaulted EDNS behavior overwrites an existing custom ECS address] → Treat `ednsClientSubnet` as full ownership of the ECS mapping and document that custom ECS is unsupported.
- [Whitelist strings pass local shape validation but fail AdGuard semantics] → Keep the remote full-candidate `AdGuardHome --check-config` gate before replacement.
- [Downstream configs may rely on currently required explicit values] → Defaults preserve those values while allowing consumers to remove redundant fields independently.
- [A schema dependency could duplicate hand-written checks] → Move the managed AdGuard settings contract into one shared Zod module and keep artifact/source-path validation in the project config parser.

## Migration Plan

1. Implement and test the additive config fields, defaults, settings-only mode, and AdGuard YAML mapping.
2. Prove existing configs with explicit values remain valid and minimal configs receive the documented defaults.
3. Publish the patch release after repository validation.
4. Let downstream consumers adopt settings-only mode and the optional fields in their own separately scoped changes.
5. Roll back by reinstalling the previous package version; existing explicit-value configs remain compatible with both versions.
