import assert from "node:assert/strict";
import test from "node:test";
import { buildDoctorCommand } from "./lib/doctor.js";

test("reports router storage and managed service health", () => {
  const command = buildDoctorCommand();

  assert.match(command, /\/tmp\/sysinfo\/model/u);
  assert.match(command, /\/proc\/cpuinfo/u);
  assert.match(command, /uname -m/u);
  assert.match(command, /CPU: %s/u);
  assert.match(command, /\/etc\/openwrt_release/u);
  assert.match(command, /df -h \/overlay/u);
  assert.match(command, /adguardhome sing-box zapret2/u);
  assert.match(command, /not installed/u);
  assert.match(command, /stopped/u);
  assert.match(command, /running/u);
  assert.doesNotMatch(command, /wget|curl|nslookup/u);
  assert.equal(command.includes(String.raw`\\n`), false);
});
