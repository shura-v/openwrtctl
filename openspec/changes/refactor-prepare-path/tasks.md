## 1. Artifact contracts and external readiness

- [x] 1.1 Add canonical valid/invalid fixtures for the complete sing-box JSON, native AdGuard rewrite sequence, and nfqws2 `userList`/`ipsetList` manifest contracts.
- [x] 1.2 Document the external producer contract and expected commands `openwrtctl-singbox-config`, `openwrtctl-adguard-rewrites`, and `openwrtctl-nfqws2-resources` without adding knowledge of `singboxctl` to runtime code.
- [x] 1.3 Verify before live cutover that a separate `rc` change has installed POSIX producers in `PATH`, including an rc-owned source for each AdGuard rewrite `answer`.
- [x] 1.4 Keep creation of `/Users/super/git/rc/bin` producers and modification of `/Users/super/git/rc/.config/openwrtctl/config.yaml` outside this repo-local apply scope.

## 2. Generic local artifact runner

- [x] 2.1 Add `scripts/lib/local-artifact.js` to resolve mandatory `path`, optional `cwd`, relative paths, and `~` from the project config location.
- [x] 2.2 Implement shell-free argv producer execution where exactly one standalone argument equals `{output}`, using a unique sibling staging directory with mode `0700`, bounded timeout, process cleanup, and safe diagnostics.
- [x] 2.3 Validate output with `lstat` as a non-symlink regular file, implement read-and-validate-before-persist, mode `0600`, atomic rename to `path`, candidate cleanup on every failure, and immutable byte snapshots for downstream upload.
- [x] 2.4 Define parent handling: create a missing producer target parent with mode `0700`, never create paths for a static source, and test both behaviors.
- [x] 2.5 Add unit tests for static files, successful producers, non-zero exit, timeout, missing/non-regular/symlink output, malformed artifacts, paths with spaces, literal shell metacharacters, cleanup, and previous-file preservation.

## 3. Hard-cut config and service consumers

- [x] 3.1 Replace the required `singboxctl` mapping in `config.example.yaml` and `scripts/lib/config.js` with artifact sources `singbox.config`, `adguard.rewrites`, and `nfqws2.resources` plus optional `prepare.command`/`prepare.cwd`; reject legacy-only and mixed configs, including `adguard.rewriteIp`, without fallback.
- [x] 3.2 Switch `sync-singbox` to a complete JSON artifact snapshot, preserve remote `sing-box check` and apply lifecycle, and remove every local semantic modification of the sing-box payload.
- [x] 3.3 Switch `sync-adguard` to a validated top-level YAML rewrite sequence, replace only `filtering.rewrites`, detect conflicting domain answers, continue applying upstream/bootstrap/mode/port/querylog settings, and preserve the remaining remote YAML fields, backup, validation, and rollback.
- [x] 3.4 Switch `sync-nfqws2` to a validated `userList`/`ipsetList` manifest and keep the existing nfqws2 strategy/config/list installation lifecycle without reading sing-box config.
- [x] 3.5 Refactor aggregate `sync` into one process that calls shared prepare functions for all three in-memory snapshots before any service apply function; make individual sync commands use the same prepare/apply functions.
- [x] 3.6 Add orchestration tests proving a failure in the third producer causes zero remote mutation calls and no service reads an artifact path again after snapshot validation.
- [x] 3.7 Make `singbox`, `adguard`, and `nfqws2` service sections optional while requiring and fully validating each present section; add explicit service-command errors for omitted sections.
- [x] 3.8 Make aggregate `sync` prepare and apply only configured services, preserve prepare-all-before-apply ordering, reject a config with no configured services, and cover sing-box-only plus mixed-service orchestration.

## 4. Remove the legacy singbox pipeline

- [x] 4.1 Remove `scripts/singbox-config.js`, its tests, and every consumer import after the exact artifact path is covered by service-level tests.
- [x] 4.2 Remove `scripts/lib/router-resources.js`, related fixtures/tests, legacy `buildAdguardRewrites`/`buildNfqws2Lists`, and every `loadRouterResources` import.
- [x] 4.3 Remove `scripts/lib/package-bin.js` and its tests after confirming no remaining package binary consumer exists.
- [x] 4.4 Remove `singboxctl` from `package.json` and `package-lock.json` using the repository's npm workflow.
- [x] 4.5 Verify a repository search covering `package-lock.json` and README finds no runtime/config/dependency references to `singboxctl`, `loadRouterResources`, `ruleSetsDirectory`, `generateSingBoxConfig`, `buildAdguardRewrites`, or `buildNfqws2Lists` outside intentional historical planning text.

## 5. Contract, validation, and live acceptance

- [x] 5.1 Update README with the `path`/`prepare.command`/`cwd` contract, the three artifact formats, producer trust boundary, and static-file behavior; omit migration and compatibility guidance.
- [x] 5.2 Add a changeset describing the breaking configuration contract and removal of the embedded `singboxctl` dependency.
- [x] 5.3 Add canonical fixtures shared conceptually by producer and consumer tests, and verify valid/invalid values for every artifact format plus `config.example.yaml` and the local config loader.
- [x] 5.3a Document optional service sections and a minimal sing-box-only config without changing the artifact source contract.
- [x] 5.4 Run `npm test`, `npm ls singboxctl`, and `git diff --check` in `openwrtctl`; run POSIX producer checks and `git diff --check` in `rc` without staging unrelated files.
- [x] 5.5 As an external deployment step, create a `0600` backup of `/Users/super/git/rc/.config/openwrtctl/config.yaml`, update only the new fields without printing contents, and verify the new local config loads with mode `0600`.
- [ ] 5.6 Back up current remote service files, then smoke-test aggregate and individual sync flows: validate sing-box before replacement, preserve AdGuard managed/unmanaged fields, reproduce nfqws2 resources, and confirm prepare failures cause zero remote mutations.
- [x] 5.7 Update `tasks/refactor-prepare-path.md` with actual results and mark completed increments after all worktrees and generated artifacts have been audited.
