import assert from "node:assert/strict";
import test from "node:test";
import { applyRemoteNfqws2Bundle } from "./lib/nfqws2-remote-config.js";

test("validates and atomically applies the managed nfqws2 bundle", async () => {
  const commands = [];
  const remote = {
    exec: async (command) => commands.push(command)
  };

  await applyRemoteNfqws2Bundle(remote, {
    stagedConfigPath: "/root/tmp/nfqws2.conf",
    stagedUserListPath: "/root/tmp/nfqws2-user.list",
    stagedIpsetListPath: "/root/tmp/nfqws2-ipset.list",
    userListPath: "/etc/nfqws2/lists/user.list",
    ipsetListPath: "/etc/nfqws2/lists/ipset.list"
  });

  assert.equal(commands.length, 1);
  const command = commands[0];
  const validationIndex = command.indexOf("--dry-run");
  const luaValidationIndex = command.indexOf("--intercept=0");
  const replaceIndex = command.indexOf('mv -f "$user_list.new"');
  const restartIndex = command.indexOf("/etc/init.d/zapret2 restart");
  const enableIndex = command.indexOf("/etc/init.d/zapret2 enable");

  assert.ok(validationIndex >= 0 && validationIndex < replaceIndex);
  assert.ok(luaValidationIndex > validationIndex && luaValidationIndex < replaceIndex);
  assert.ok(replaceIndex < restartIndex);
  assert.ok(restartIndex < enableIndex);
  assert.match(command, /managed config and lists remain installed for diagnostics/u);
  assert.match(command, /zapret-lib\.lua/u);
  assert.match(command, /zapret-antidpi\.lua/u);
  assert.match(command, /zapret-auto\.lua/u);
  assert.match(command, /--blob=quic_initial:@\/opt\/zapret2\/files\/fake\/quic_initial_www_google_com\.bin/u);
  assert.match(command, /chmod 0644 "\$user_list.new" "\$ipset_list.new"/u);
  assert.match(command, /chmod 0600 "\$config.new"/u);
  assert.doesNotMatch(command, /github\.com|\bcurl\b/u);
});
