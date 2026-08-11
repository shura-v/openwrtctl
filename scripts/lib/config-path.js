import os from "node:os";
import path from "node:path";

export const USER_HOME = os.homedir();
export const CONFIG_DIRECTORY = path.join(USER_HOME, ".config/openwrtctl");
export const CONFIG_PATH = path.join(CONFIG_DIRECTORY, "config.yaml");
