# adguard-settings-sync Specification

## Purpose

Defines deterministic configuration and safe synchronization of managed AdGuard Home DNS settings, including settings-only configurations that do not provide filtering rules.

## Requirements

### Requirement: AdGuard management is opt-in
The system SHALL manage AdGuard Home only when the project config contains an `adguard` mapping. A config without `adguard` SHALL remain valid when another supported service is configured, and AdGuard-specific commands SHALL reject that config before remote mutation.

#### Scenario: Another service is configured without AdGuard
- **WHEN** a valid project config contains `singbox` or `nfqws2` and omits `adguard`
- **THEN** aggregate sync skips AdGuard preparation and application

#### Scenario: AdGuard-only command lacks configuration
- **WHEN** an AdGuard-specific command receives a project config without `adguard`
- **THEN** the command fails with an explicit configuration error before remote mutation

### Requirement: Core AdGuard settings and library defaults
When `adguard` is present, the system SHALL require a valid `webPort` and an `adguard.dns` mapping containing a valid `port` and a non-empty `upstreamDns` list. The system SHALL accept omitted optional settings and normalize them to `querylogInterval: 6h`, `dns.upstreamMode: load_balance`, `dns.bootstrapDns: []`, `dns.rateLimit: 0`, `dns.rateLimitSubnetLenIpv4: 24`, `dns.rateLimitSubnetLenIpv6: 56`, `dns.rateLimitWhitelist: []`, `dns.ednsClientSubnet.enabled: false`, `dns.ednsClientSubnet.useCustom: false`, `dns.ednsClientSubnet.customIp: ""`, `dns.cacheSize: 4194304`, `dns.cacheTtlMin: 0`, `dns.cacheTtlMax: 0`, and `dns.cacheOptimistic: false`.

#### Scenario: Minimal settings-only AdGuard config
- **WHEN** `adguard` contains a valid `webPort` and `dns` contains valid `port` and `upstreamDns` values while every optional field and rules source is omitted
- **THEN** config loading succeeds and returns all documented default values in the nested public shape

#### Scenario: Explicit values override defaults
- **WHEN** `adguard` and `adguard.dns` supply valid explicit values for optional settings
- **THEN** config loading returns those values unchanged in the nested public shape

#### Scenario: DNS mapping is absent
- **WHEN** `adguard` is present without an `adguard.dns` mapping
- **THEN** config loading fails with an error naming `adguard.dns`

### Requirement: AdGuard setting validation
The system SHALL require `webPort` and `dns.port` values from 1 through 65535, a positive hours-or-days query-log interval, a supported `dns.upstreamMode`, a non-negative integer `dns.rateLimit`, IPv4 and IPv6 rate-limit prefix lengths within 0 through 32 and 0 through 128, and a list of non-empty strings for `dns.rateLimitWhitelist`. The system SHALL require boolean `enabled` and `useCustom` values in `dns.ednsClientSubnet`, SHALL accept an empty `customIp` only when `useCustom` is false, and SHALL otherwise require `customIp` to be an IP address. The system SHALL require non-negative integers for `dns.cacheSize`, `dns.cacheTtlMin`, and `dns.cacheTtlMax`, require `dns.cacheTtlMin` to be less than or equal to `dns.cacheTtlMax`, and require a boolean `dns.cacheOptimistic`. Every local entry point that accepts these managed settings SHALL apply the same validation and defaults before generating AdGuard Home YAML. Removed flat DNS fields under `adguard` SHALL be rejected rather than migrated implicitly.

#### Scenario: Empty rate-limit whitelist
- **WHEN** `adguard.dns.rateLimitWhitelist` is an empty list
- **THEN** config loading succeeds

#### Scenario: Valid custom EDNS subnet source
- **WHEN** `adguard.dns.ednsClientSubnet.useCustom` is true and `customIp` contains a valid IPv4 or IPv6 address
- **THEN** config loading succeeds and preserves the structured EDNS values

#### Scenario: Invalid cache TTL range
- **WHEN** `adguard.dns.cacheTtlMin` is greater than `adguard.dns.cacheTtlMax`
- **THEN** config loading fails with an error naming the invalid cache TTL relationship

#### Scenario: Removed flat DNS field
- **WHEN** a config supplies any removed flat field such as `adguard.dnsPort`, `adguard.upstreamDns`, or `adguard.cacheSize`
- **THEN** config loading fails with an error naming the unsupported field

#### Scenario: Invalid managed setting
- **WHEN** any managed setting has the wrong type, an unsupported enum value, or a value outside its allowed range
- **THEN** config loading fails with an error naming the invalid nested `adguard` field

#### Scenario: Standalone generator receives an invalid managed setting
- **WHEN** the standalone AdGuard config CLI receives an invalid port, numeric value, prefix length, whitelist, EDNS object, or cache setting
- **THEN** it fails before writing the output YAML and names the invalid setting

### Requirement: Optional rules source modes
The system SHALL accept at most one of `adguard.rewrites` and `adguard.userRules`. It SHALL support a settings-only mode when both are absent, and settings-only synchronization SHALL clear both `filtering.rewrites` and root `user_rules` in the resulting AdGuard Home config.

#### Scenario: Settings-only synchronization
- **WHEN** an AdGuard config omits both `rewrites` and `userRules`
- **THEN** synchronization performs no rules-artifact preparation and produces empty `filtering.rewrites` and `user_rules` lists

#### Scenario: Rewrites synchronization
- **WHEN** `adguard.rewrites` is configured with a valid artifact
- **THEN** synchronization installs those rewrites and clears root `user_rules`

#### Scenario: User-rules synchronization
- **WHEN** `adguard.userRules` is configured with a valid artifact
- **THEN** synchronization installs those user rules and clears `filtering.rewrites`

#### Scenario: Conflicting rules sources
- **WHEN** both `adguard.rewrites` and `adguard.userRules` are present
- **THEN** config loading fails before any artifact preparation or remote mutation

### Requirement: Native AdGuard Home DNS mapping
The system SHALL write normalized `adguard.dns` settings to `dns.port`, `dns.upstream_dns`, `dns.bootstrap_dns`, `dns.upstream_mode`, `dns.ratelimit`, `dns.ratelimit_subnet_len_ipv4`, `dns.ratelimit_subnet_len_ipv6`, `dns.ratelimit_whitelist`, `dns.edns_client_subnet.enabled`, `dns.edns_client_subnet.use_custom`, `dns.edns_client_subnet.custom_ip`, `dns.cache_size`, `dns.cache_ttl_min`, `dns.cache_ttl_max`, and `dns.cache_optimistic`. It SHALL continue to write `adguard.querylogInterval` to `querylog.interval` and the `adguard.webPort` value to the port portion of `http.address`.

#### Scenario: Defaults are patched into native YAML
- **WHEN** a minimal settings-only config is applied to a valid existing AdGuard Home YAML document
- **THEN** the resulting document contains every normalized DNS default at the documented native path and preserves unrelated fields

#### Scenario: Explicit DNS settings are converted
- **WHEN** a valid config supplies explicit upstream, rate-limit, EDNS, and cache values under `adguard.dns`
- **THEN** the resulting native YAML contains the corresponding values under `dns` using AdGuard Home field names

#### Scenario: Bootstrap DNS is omitted
- **WHEN** `adguard.dns.bootstrapDns` is absent from the project config
- **THEN** the resulting `dns.bootstrap_dns` is an empty list

### Requirement: Safe remote application
The system SHALL validate the complete candidate with `AdGuardHome --check-config`, retain the existing local backup and transactional rollback behavior, restart AdGuard Home, require readiness on the configured DNS port, then configure dnsmasq to forward to that listener. A validation, restart, or readiness failure SHALL NOT leave dnsmasq pointing at an unavailable new candidate.

#### Scenario: Candidate passes validation and readiness
- **WHEN** the generated candidate is valid and AdGuard Home becomes ready on the configured DNS port
- **THEN** synchronization installs the candidate and configures dnsmasq to forward to it

#### Scenario: Candidate fails after backup
- **WHEN** candidate validation, restart, or readiness fails
- **THEN** synchronization restores the previous managed state according to the existing transaction contract and returns an error
