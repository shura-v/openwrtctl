## MODIFIED Requirements

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
