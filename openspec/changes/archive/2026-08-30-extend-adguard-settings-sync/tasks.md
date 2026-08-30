## 1. Config contract and defaults

- [x] 1.1 Extend `validateAdguard` to accept the five new settings, default omitted `querylogInterval` to `6h`, default omitted `upstreamMode` to `load_balance`, and return concrete defaults for every optional managed setting.
- [x] 1.2 Change rules-source validation from exactly one to at most one of `rewrites` and `userRules`, preserving rejection of the conflicting two-source case.
- [x] 1.3 Add integer/range, boolean, and empty-allowed string-list validation for rate limit, IPv4/IPv6 prefix lengths, whitelist, and EDNS Client Subnet with field-specific errors.
- [x] 1.4 Update `config.example.yaml` with working explicit values while documenting which fields are optional.
- [x] 1.5 Expand config tests for a minimal settings-only section, explicit overrides, every default, empty whitelist, both rules-source modes, conflict rejection, and invalid type/range cases.

## 2. Settings-only preparation and YAML generation

- [x] 2.1 Add an explicit settings-only preparation result that does not call the local artifact runner and remains compatible with aggregate prepare-all-before-apply ordering.
- [x] 2.2 Pass all normalized AdGuard settings through `sync-adguard` and `generateAdguardConfig`, including a stable settings-only summary that does not dereference a missing rules list.
- [x] 2.3 Patch the native rate-limit and EDNS mappings, reset EDNS custom fields deterministically, clear both managed rules lists in settings-only mode, and preserve unrelated YAML fields.
- [x] 2.4 Extend generator and sync tests across settings-only, rewrites, and user-rules modes, proving settings-only performs no artifact preparation and each mode writes both managed rule locations correctly.
- [x] 2.5 Preserve and test candidate validation plus rollback when restart or DNS-port readiness fails before dnsmasq is committed to the new listener.

## 3. Documentation and release metadata

- [x] 3.1 Document the minimal AdGuard section, defaults, native mappings, settings-only clearing semantics, optional top-level `adguard` section, and custom EDNS limitation in README.
- [x] 3.2 Add a patch changeset covering the new config fields, defaults, and rules-free AdGuard synchronization.
- [x] 3.3 Verify README and examples describe only the reusable library contract and do not name or prescribe downstream profiles, wrapper commands, or traffic-routing policy.

## 4. Repository verification

- [x] 4.1 Load `config.example.yaml` through `scripts/lib/config.js` and verify the normalized object contains the documented values without logging sensitive configuration.
- [x] 4.2 Run the complete `npm test` suite and `git diff --check` in `/Users/super/git/openwrtctl`.
- [x] 4.3 Review the final diff for unintentional lifecycle, dnsmasq ownership, downstream consumer, unrelated config, or release changes.

## 5. Shared validation follow-up

- [x] 5.1 Add the current stable Zod 4 dependency and extract a shared AdGuard settings schema with the existing defaults, ranges, enums, and field-specific errors.
- [x] 5.2 Route project-config and standalone CLI settings through the shared schema, preserving the old nine-argument CLI form and settings-only `-` mode.
- [x] 5.3 Add standalone CLI regressions proving invalid numeric values, prefix lengths, whitelist JSON, and EDNS values fail before output is written.
- [x] 5.4 Synchronize only the five new fields into `~/.config/openwrtctl/config.yaml`, preserve its values, and enforce mode `0600`.
- [x] 5.5 Re-run example/local config loading, the complete test suite, strict OpenSpec validation, diff checks, and final review.
