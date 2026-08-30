## 1. Nested configuration contract

- [x] 1.1 Replace the flat shared AdGuard settings schema with strict root, `dns`, and `ednsClientSubnet` schemas; add DNS and cache defaults, nested error paths, IP validation, and cache TTL range validation.
- [x] 1.2 Update project config validation to accept only `webPort`, `querylogInterval`, `dns`, and rules sources at the `adguard` level and reject every removed flat DNS field.
- [x] 1.3 Add shared-schema and project-config tests for the minimal nested shape, explicit values, defaults, missing `dns`, unknown fields, structured EDNS values, cache bounds, and invalid TTL relationships.

## 2. Native conversion and consumers

- [x] 2.1 Update the AdGuard YAML generator and standalone CLI input construction to consume the nested normalized settings and map EDNS and cache values to their native `dns.*` paths.
- [x] 2.2 Add generator tests for default and explicit nested values, invalid standalone inputs, replacement of managed native paths, and preservation of unrelated YAML fields.
- [x] 2.3 Update synchronization, lifecycle, uninstall, and dnsmasq/readiness consumers to use `adguard.dns.port`, with focused regressions for each affected command flow.

## 3. Public interface and release metadata

- [x] 3.1 Update `config.example.yaml` to show the complete nested DNS shape and working cache defaults.
- [x] 3.2 Update README configuration and migration documentation with the breaking before/after contract and managed cache behavior.
- [x] 3.3 Add a major changeset describing the required config migration and new DNS cache controls.

## 4. Verification

- [x] 4.1 Load `config.example.yaml` through `scripts/lib/config.js` and verify the normalized nested result without reading or editing files under `/Users/super/git/rc`.
- [x] 4.2 Run `npm test`, `git diff --check`, and strict OpenSpec validation; confirm no removed flat DNS-field references remain in production consumers.
