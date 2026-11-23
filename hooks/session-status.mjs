#!/usr/bin/env node
/**
 * sessionStart: inject the current relay feature, when one is open.
 * Failure stays quiet so a session still starts.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const project = process.env.CURSOR_PROJECT_DIR || process.cwd();

try {
	const result = spawnSync(
		process.execPath,
		[join(pluginRoot, "scripts", "relay.ts"), "status", "--root", project, "--brief"],
		{ encoding: "utf8", timeout: 5000 },
	);
	const text = (result.stdout || "").trim();
	process.stdout.write(text ? `${JSON.stringify({ additional_context: text })}\n` : "{}\n");
} catch {
	process.stdout.write("{}\n");
}
