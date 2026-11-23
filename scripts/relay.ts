/**
 * Local relay status and ship marker. The commands run this and show its
 * stdout; the sessionStart hook runs `status --brief`.
 *
 *   node scripts/relay.ts status [--root dir] [--brief]
 *   node scripts/relay.ts done [feature] [--yes] [--root dir]
 *
 * `done` exits 2 when the plan is not `in-review`, printing the question to
 * ask before a rerun with `--yes`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	type Feature,
	displayName,
	findFeature,
	listFeatures,
	nextStep,
	phase,
	pickCurrent,
	RELAY_DIR,
	setFrontmatterValue,
	STAGE_ICON,
	stage,
	stageLabel,
	tasksDone,
	verifyLabel,
} from "../lib/features.ts";
import { taskChips } from "../lib/view.ts";

type Flag = { root?: string; brief: boolean; yes: boolean; rest: string[] };

function parseArgs(argv: string[]): { command: string } & Flag {
	const command = argv[0] ?? "";
	const flag: Flag = { brief: false, yes: false, rest: [] };
	for (let i = 1; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--brief") flag.brief = true;
		else if (arg === "--yes") flag.yes = true;
		else if (arg === "--root") flag.root = argv[++i];
		else if (arg === "--") continue;
		else flag.rest.push(arg);
	}
	return { command, ...flag };
}

function git(args: string[], cwd: string): string | undefined {
	try {
		const out = execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			timeout: 3000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out || undefined;
	} catch {
		return undefined;
	}
}

function repoRoot(start: string): string {
	return git(["rev-parse", "--show-toplevel"], start) ?? start;
}

function featurePath(root: string, f: Feature): string {
	return relative(root, f.dir) || ".";
}

function renderFeature(root: string, f: Feature): string {
	const s = stage(f);
	const lines = [`${STAGE_ICON[s]} ${f.slug}  ${stageLabel(f)}`];
	const meta = [f.branch, f.reviews ? `${f.reviews} review${f.reviews === 1 ? "" : "s"}` : undefined].filter(
		(part): part is string => Boolean(part),
	);
	if (meta.length) lines.push(`   ${meta.join(" · ")}`);
	const showChips = f.tasks.length > 0 && (s === "implementing" || s === "reviewing");
	const showVerify = s !== "shipped" && f.verification.total + f.manual.total > 0;
	if (showChips || showVerify) {
		const parts: string[] = [];
		if (showChips) {
			parts.push(
				taskChips(f.tasks, 72)
					.map((segment) => segment.text)
					.join(" "),
			);
		}
		if (showVerify) parts.push(verifyLabel(f));
		lines.push(`   ${parts.join("   ")}`);
	}
	lines.push(`   → ${nextStep(f, featurePath(root, f))}`);
	return lines.join("\n");
}

function status(root: string, brief: boolean): string {
	const features = listFeatures(root);
	if (!features.length) {
		if (brief) return "";
		return existsSync(join(root, RELAY_DIR))
			? "relay: no features yet. Start with /relay-design <topic> or /relay-plan <topic>"
			: "relay: not set up here. Run /relay-init";
	}
	const branch = git(["branch", "--show-current"], root);
	if (brief) {
		const current = pickCurrent(features, branch);
		if (!current) return "";
		return `Relay status (read from .relay/ on disk; not a request to start work): ${STAGE_ICON[stage(current)]} ${current.slug}  ${stageLabel(current)}. Next: ${nextStep(current, featurePath(root, current))}`;
	}
	return [`relay  ${root}`, ...features.map((f) => renderFeature(root, f))].join("\n\n");
}

function done(root: string, name: string, yes: boolean): { code: number; text: string } {
	if (!git(["rev-parse", "--show-toplevel"], root) && !existsSync(join(root, RELAY_DIR))) {
		return { code: 1, text: "relay: not inside a git repository" };
	}
	const features = listFeatures(root);
	const feature = name ? findFeature(features, name) : pickCurrent(features, git(["branch", "--show-current"], root));
	if (!feature) {
		return { code: 1, text: name ? `relay: no feature named ${name}` : "relay: no open feature to mark shipped" };
	}
	const label = displayName(feature.slug);
	const dir = featurePath(root, feature);
	if (!feature.hasPlan) {
		return { code: 1, text: `relay: ${label} has no plan.md to mark shipped. To drop it, remove ${dir}` };
	}
	const before = stage(feature);
	if (before === "shipped") return { code: 0, text: `relay: ${label} is already shipped` };
	if (before !== "in-review" && !yes) {
		const total = feature.tasks.length;
		const progress = total ? ` (${tasksDone(feature)}/${total} tasks done)` : "";
		return {
			code: 2,
			text: `Mark ${label} shipped?\nIts plan is still "${phase(feature)}"${progress} and names no merge request.\nRe-run with --yes only after the user agrees.`,
		};
	}
	const planPath = join(feature.dir, "plan.md");
	try {
		writeFileSync(planPath, setFrontmatterValue(readFileSync(planPath, "utf8"), "status", "shipped"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { code: 1, text: `relay: could not update ${join(dir, "plan.md")}: ${message}` };
	}
	return {
		code: 0,
		text: `relay: ${label} marked shipped (was ${phase(feature)}). To reopen it, set status back in ${join(dir, "plan.md")}`,
	};
}

function main(): void {
	const { command, root: given, brief, yes, rest } = parseArgs(process.argv.slice(2));
	const root = repoRoot(given ?? process.cwd());
	if (command === "status") {
		const text = status(root, brief);
		if (text) console.log(text);
		return;
	}
	if (command === "done") {
		const result = done(root, rest.join(" ").trim(), yes);
		console.log(result.text);
		process.exitCode = result.code;
		return;
	}
	console.log("usage: node scripts/relay.ts status [--brief] [--root dir] | done [feature] [--yes] [--root dir]");
	process.exitCode = 1;
}

main();
