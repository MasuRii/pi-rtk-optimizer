import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";

export const EXTENSION_NAME = "pi-rtk-optimizer";
export const CONFIG_DIR = join(
	...(env["PI_CODING_AGENT_DIR"]
		? [env["PI_CODING_AGENT_DIR"]]
		: [homedir(), ".pi", "agent"]),
	"extensions",
	EXTENSION_NAME,
);
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
