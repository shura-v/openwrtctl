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
When `adguard` is present, the system SHALL require valid `webPort`, `dnsPort`, and a non-empty `upstreamDns` list. The system SHALL accept omitted optional settings and normalize them to `querylogInterval: 6h`, `upstreamMode: load_balance`, `bootstrapDns: []`, `rateLimit: 0`, `rateLimitSubnetLenIpv4: 24`, `rateLimitSubnetLenIpv6: 56`, `rateLimitWhitelist: []`, and `ednsClientSubnet: false`.

#### Scenario: Minimal settings-only AdGuard config
- **WHEN** `adguard` contains valid `webPort`, `dnsPort`, and `upstreamDns` and omits every optional field and rules source
- **THEN** config loading succeeds and returns all documented default values

#### Scenario: Explicit values override defaults
- **WHEN** `adguard` supplies valid explicit values for optional settings
- **THEN** config loading returns those values unchanged

### Requirement: AdGuard setting validation
The system SHALL require ports from 1 through 65535, a positive hours-or-days query-log interval, a supported upstream mode, a non-negative integer rate limit, IPv4 and IPv6 rate-limit prefix lengths within 0 through 32 and 0 through 128, a list of non-empty strings for the rate-limit whitelist, and a boolean EDNS Client Subnet switch. Every local entry point that accepts these managed settings SHALL apply the same validation and defaults before generating AdGuard Home YAML.

#### Scenario: Empty rate-limit whitelist
- **WHEN** `rateLimitWhitelist` is an empty list
- **THEN** config loading succeeds

#### Scenario: Invalid managed setting
- **WHEN** any managed setting has the wrong type, an unsupported enum value, or a value outside its allowed range
- **THEN** config loading fails with an error naming the invalid `adguard` field

#### Scenario: Standalone generator receives an invalid managed setting
- **WHEN** the standalone AdGuard config CLI receives an invalid numeric value, prefix length, whitelist, or EDNS switch
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
The system SHALL write the normalized settings to `dns.port`, `dns.upstream_dns`, `dns.bootstrap_dns`, `dns.upstream_mode`, `dns.ratelimit`, `dns.ratelimit_subnet_len_ipv4`, `dns.ratelimit_subnet_len_ipv6`, `dns.ratelimit_whitelist`, `dns.edns_client_subnet`, `querylog.interval`, and the port portion of `http.address`. A boolean `ednsClientSubnet` value SHALL set `enabled` to that value and reset `use_custom` to `false` and `custom_ip` to an empty string.

#### Scenario: Defaults are patched into native YAML
- **WHEN** a minimal settings-only config is applied to a valid existing AdGuard Home YAML document
- **THEN** the resulting document contains the normalized defaults at the documented native paths and preserves unrelated fields

#### Scenario: Bootstrap DNS is omitted
- **WHEN** `bootstrapDns` is absent from the project config
- **THEN** the resulting `dns.bootstrap_dns` is an empty list

### Requirement: Safe remote application
The system SHALL validate the complete candidate with `AdGuardHome --check-config`, retain the existing local backup and transactional rollback behavior, restart AdGuard Home, require readiness on the configured DNS port, then configure dnsmasq to forward to that listener. A validation, restart, or readiness failure SHALL NOT leave dnsmasq pointing at an unavailable new candidate.

#### Scenario: Candidate passes validation and readiness
- **WHEN** the generated candidate is valid and AdGuard Home becomes ready on the configured DNS port
- **THEN** synchronization installs the candidate and configures dnsmasq to forward to it

#### Scenario: Candidate fails after backup
- **WHEN** candidate validation, restart, or readiness fails
- **THEN** synchronization restores the previous managed state according to the existing transaction contract and returns an error
