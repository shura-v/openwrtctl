import assert from "node:assert/strict";
import test from "node:test";
import { resolveNfqws2BinaryTarget } from "./lib/nfqws2-architecture.js";

test("maps OpenWrt package architectures to zapret2 binary targets", () => {
  assert.equal(resolveNfqws2BinaryTarget("aarch64_cortex-a53"), "arm64");
  assert.equal(resolveNfqws2BinaryTarget("arm_cortex-a7_neon-vfpv4"), "arm");
  assert.equal(resolveNfqws2BinaryTarget("mipsel_24kc"), "mipsel");
  assert.equal(resolveNfqws2BinaryTarget("x86_64"), "x86_64");
  assert.equal(resolveNfqws2BinaryTarget("riscv64_riscv64"), "riscv64");
  assert.throws(
    () => resolveNfqws2BinaryTarget("loongarch64"),
    /unsupported OpenWrt architecture/u
  );
});
