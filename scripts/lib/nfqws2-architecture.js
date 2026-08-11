export const NFQWS2_ARCHITECTURES = Object.freeze([
  Object.freeze({ patterns: ["aarch64*"], target: "arm64" }),
  Object.freeze({ patterns: ["arm*"], target: "arm" }),
  Object.freeze({ patterns: ["x86_64*"], target: "x86_64" }),
  Object.freeze({ patterns: ["i386*", "i486*", "i586*", "i686*", "x86*"], target: "x86" }),
  Object.freeze({ patterns: ["mipsel*"], target: "mipsel" }),
  Object.freeze({ patterns: ["mips64*"], target: "mips64" }),
  Object.freeze({ patterns: ["mips*"], target: "mips" }),
  Object.freeze({ patterns: ["powerpc*", "ppc*"], target: "ppc" }),
  Object.freeze({ patterns: ["riscv64*"], target: "riscv64" }),
  Object.freeze({ patterns: ["lexra*"], target: "lexra" })
]);

export const NFQWS2_BINARY_TARGETS = Object.freeze(
  NFQWS2_ARCHITECTURES.map(({ target }) => target)
);

export function resolveNfqws2BinaryTarget(openwrtArchitecture) {
  const descriptor = NFQWS2_ARCHITECTURES.find(({ patterns }) =>
    patterns.some((pattern) => openwrtArchitecture.startsWith(pattern.slice(0, -1)))
  );

  if (!descriptor) {
    throw new Error(`unsupported OpenWrt architecture: ${openwrtArchitecture}`);
  }

  return descriptor.target;
}

export function buildRemoteNfqws2ArchitectureSelection(release) {
  const cases = NFQWS2_ARCHITECTURES.flatMap(({ patterns, target }) => {
    const sha256 = release.binarySha256ByTarget?.[target];
    if (sha256 === undefined) {
      return [];
    }
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error(`invalid nfqws2 SHA-256 for linux-${target}`);
    }

    return [`  ${patterns.join("|")}) binary_target=${target}; expected_binary_sha256=${sha256} ;;`];
  }).join("\n");

  if (cases.length === 0) {
    throw new Error("release contains no supported nfqws2 binaries");
  }

  return `openwrt_arch="$(apk --print-arch)"
case "$openwrt_arch" in
${cases}
  *) echo "unsupported OpenWrt architecture: $openwrt_arch" >&2; exit 1 ;;
esac
binary_dir="$source_dir/binaries/linux-$binary_target"`;
}
