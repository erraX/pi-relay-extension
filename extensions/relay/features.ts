/**
 * Read relay feature state from `.relay/<feature>/`: `design.md`, `plan.md`
 * and one file per task in `tasks/`.
 *
 * Pure apart from synchronous reads of the `.relay` directory, so the extension
 * (footer, task strip, /relay-status, argument completion) and the tests share
 * one parser. The skills own the file format; this reads the frontmatter and
 * the `## Verification` checklist of the plan and the checkboxes of each
 * `tasks/NN-<slug>.md`, and tolerates anything it does not recognise. Plans
 * written before tasks had their own files keep them as `### Task N:` sections
 * inside `plan.md`; those are read when there is no task file.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const RELAY_DIR = ".relay";
export const TASKS_DIR = "tasks";

export type Task = {
	/** Number from the file name (`03-export-button.md` → 3). */
	n: number;
	/** Heading text after `Task N:`, backticks removed. */
	name: string;
	/** Ticked and total checkboxes (steps) in this task. */
	done: number;
	total: number;
};

export type Checklist = { done: number; total: number };

export type Feature = {
	/** Directory name, e.g. `2026-01-01-csv-export`. */
	slug: string;
	dir: string;
	hasDesign: boolean;
	hasPlan: boolean;
	designStatus?: string;
	planStatus?: string;
	branch?: string;
	mr?: string;
	tasks: Task[];
	verification: Checklist;
	/** Number of `reviews/round-*.md` reports. */
	reviews: number;
	/** Latest mtime of design.md / plan.md / task files / reviews, for "most recent". */
	mtimeMs: number;
};

/** Where a feature is in the workflow; drives icon, colour and wording. */
export type Stage =
	| "design-draft"
	| "design-approved"
	| "plan-draft"
	| "approved"
	| "implementing"
	| "reviewing"
	| "in-review"
	| "shipped";

/** Flat `key: value` frontmatter. Empty values are omitted; trailing `# comments` and quotes are stripped. */
export function parseFrontmatter(text: string): Record<string, string> {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match) return {};
	const out: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
		if (!kv) continue;
		const value = kv[2]
			.replace(/\s+#.*$/, "")
			.trim()
			.replace(/^(["'])(.*)\1$/, "$2");
		if (value) out[kv[1]] = value;
	}
	return out;
}

/**
 * `text` with `key: value` in its frontmatter: the key's line is replaced
 * (a trailing comment goes with it), a missing key is added as the last line,
 * and a file without frontmatter gets one. Everything else stays byte for byte.
 */
export function setFrontmatterValue(text: string, key: string, value: string): string {
	const eol = /\r\n/.test(text) ? "\r\n" : "\n";
	const entry = `${key}: ${value}`;
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match) return `---${eol}${entry}${eol}---${eol}${text}`;
	const fmLines = match[1].split(/\r?\n/);
	const at = fmLines.findIndex((line) => line.startsWith(`${key}:`));
	if (at >= 0) fmLines[at] = entry;
	else fmLines.push(entry);
	const start = match[0].indexOf("\n") + 1;
	return text.slice(0, start) + fmLines.join(eol) + text.slice(start + match[1].length);
}

/** Lines outside fenced code blocks (plans contain example code with checkboxes and headings). */
function* proseLines(text: string): Generator<string> {
	let fence: string | undefined;
	for (const line of text.split(/\r?\n/)) {
		const f = /^\s*(`{3,}|~{3,})/.exec(line);
		if (f) {
			if (!fence) fence = f[1][0];
			else if (f[1][0] === fence) fence = undefined;
			continue;
		}
		if (!fence) yield line;
	}
}

const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]/;

/** Count `- [ ]` / `- [x]` list items outside code fences. */
export function countChecks(text: string): Checklist {
	let done = 0;
	let total = 0;
	for (const line of proseLines(text)) {
		const box = CHECKBOX.exec(line);
		if (!box) continue;
		total++;
		if (box[1] !== " ") done++;
	}
	return { done, total };
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const TASK_TITLE = /^Task\s+(\d+)\s*[:.\-–—]?\s*(.*)$/i;
const TASK_FILE = /^(\d+)(?:[-_. ]+(.*?))?\.md$/i;
const cleanName = (s: string) => s.replace(/`/g, "").trim();

/**
 * One task from `tasks/NN-<slug>.md`: the number comes from the file name (it
 * fixes the order), the name from the first heading (`# Task 3: Export button`
 * → `Export button`) or else from the slug, the steps from every checkbox in
 * the file. Files not named that way are not tasks.
 */
export function parseTaskFile(fileName: string, text: string): Task | undefined {
	const file = TASK_FILE.exec(fileName);
	if (!file) return undefined;
	let name = (file[2] ?? "").replace(/[-_]+/g, " ");
	for (const line of proseLines(text)) {
		const heading = HEADING.exec(line);
		if (!heading) continue;
		name = TASK_TITLE.exec(heading[2])?.[2] || heading[2];
		break;
	}
	return { n: Number(file[1]), name: cleanName(name), ...countChecks(text) };
}

/**
 * The plan's `## Verification` checklist, wherever that section sits, plus the
 * tasks of a plan that still holds them inline: `### Task N: name` headings,
 * each with the checkboxes up to the next task heading or any `##` heading.
 */
export function parsePlan(text: string): { tasks: Task[]; verification: Checklist } {
	const tasks: Task[] = [];
	const verification: Checklist = { done: 0, total: 0 };
	let task: Task | undefined;
	let inVerification = false;
	for (const line of proseLines(text)) {
		const heading = HEADING.exec(line);
		if (heading) {
			const level = heading[1].length;
			const t = level >= 3 ? TASK_TITLE.exec(heading[2]) : null;
			if (t) {
				task = { n: Number(t[1]), name: cleanName(t[2]), done: 0, total: 0 };
				tasks.push(task);
				inVerification = false;
			} else if (level <= 2) {
				task = undefined;
				inVerification = /^Verification\b/i.test(heading[2]);
			}
			continue;
		}
		const box = CHECKBOX.exec(line);
		if (!box) continue;
		const target = task ?? (inVerification ? verification : undefined);
		if (!target) continue;
		target.total++;
		if (box[1] !== " ") target.done++;
	}
	return { tasks, verification };
}

export const isComplete = (t: Task) => t.total > 0 && t.done === t.total;

function readIfExists(path: string): { text: string; mtimeMs: number } | undefined {
	try {
		return { text: readFileSync(path, "utf8"), mtimeMs: statSync(path).mtimeMs };
	} catch {
		return undefined;
	}
}

/** Tasks from `<dir>/tasks/*.md` in number order. */
function readTasks(dir: string): { tasks: Task[]; mtimeMs: number } {
	const base = join(dir, TASKS_DIR);
	let names: string[];
	try {
		names = readdirSync(base).sort();
	} catch {
		return { tasks: [], mtimeMs: 0 };
	}
	const tasks: Task[] = [];
	let mtimeMs = 0;
	for (const name of names) {
		if (!TASK_FILE.test(name)) continue;
		const file = readIfExists(join(base, name));
		const task = file && parseTaskFile(name, file.text);
		if (!file || !task) continue;
		tasks.push(task);
		mtimeMs = Math.max(mtimeMs, file.mtimeMs);
	}
	return { tasks: tasks.sort((a, b) => a.n - b.n), mtimeMs };
}

function countReviews(dir: string): { count: number; mtimeMs: number } {
	const reviews = join(dir, "reviews");
	try {
		const files = readdirSync(reviews).filter((f) => /^round-\d+\.md$/.test(f));
		const mtimeMs = Math.max(0, ...files.map((f) => statSync(join(reviews, f)).mtimeMs));
		return { count: files.length, mtimeMs };
	} catch {
		return { count: 0, mtimeMs: 0 };
	}
}

export function readFeature(dir: string, slug: string): Feature | undefined {
	const design = readIfExists(join(dir, "design.md"));
	const plan = readIfExists(join(dir, "plan.md"));
	if (!design && !plan) return undefined;
	const designFm = design ? parseFrontmatter(design.text) : {};
	const planFm = plan ? parseFrontmatter(plan.text) : {};
	const parsed = plan ? parsePlan(plan.text) : { tasks: [], verification: { done: 0, total: 0 } };
	const files = readTasks(dir);
	const reviews = countReviews(dir);
	return {
		slug,
		dir,
		hasDesign: !!design,
		hasPlan: !!plan,
		designStatus: designFm.status,
		planStatus: planFm.status,
		branch: planFm.branch,
		mr: planFm.mr,
		tasks: files.tasks.length ? files.tasks : parsed.tasks,
		verification: parsed.verification,
		reviews: reviews.count,
		mtimeMs: Math.max(design?.mtimeMs ?? 0, plan?.mtimeMs ?? 0, files.mtimeMs, reviews.mtimeMs),
	};
}

/** All features under `<root>/.relay`, most recently touched first. */
export function listFeatures(root: string): Feature[] {
	const base = join(root, RELAY_DIR);
	if (!existsSync(base)) return [];
	let entries: string[];
	try {
		entries = readdirSync(base, { withFileTypes: true })
			.filter((e) => e.isDirectory() && !e.name.startsWith("."))
			.map((e) => e.name);
	} catch {
		return [];
	}
	return entries
		.map((slug) => readFeature(join(base, slug), slug))
		.filter((f): f is Feature => !!f)
		.sort((a, b) => b.mtimeMs - a.mtimeMs || b.slug.localeCompare(a.slug));
}

/** `2026-01-01-csv-export` → `csv-export`. */
export function displayName(slug: string): string {
	return slug.replace(/^\d{4}-\d{2}-\d{2}-/, "") || slug;
}

export const tasksDone = (f: Feature) => f.tasks.filter(isComplete).length;

/** The first task that is not complete: what implementation is working on. */
export function currentTask(f: Feature): Task | undefined {
	return f.tasks.find((t) => !isComplete(t));
}

export function stage(f: Feature): Stage {
	switch (f.planStatus) {
		case "shipped":
			return "shipped";
		case "in-review":
			return "in-review";
		case "implementing":
			return f.tasks.length > 0 && !currentTask(f) ? "reviewing" : "implementing";
		case "approved":
			return "approved";
	}
	if (f.hasPlan) return "plan-draft";
	return f.designStatus === "approved" ? "design-approved" : "design-draft";
}

/** One-word phase, as the plan or design frontmatter says it. */
export function phase(f: Feature): string {
	if (f.planStatus) return f.planStatus;
	if (f.hasPlan) return "draft";
	return `design ${f.designStatus ?? "draft"}`;
}

const finished = (f: Feature) => f.planStatus === "shipped";

/**
 * The feature the session is working on, among those not shipped: the one
 * whose plan names the current branch, else the most recently touched one
 * (planning happens before a branch exists). A shipped feature is never
 * current, not even on its own branch.
 */
export function pickCurrent(features: Feature[], branch: string | undefined): Feature | undefined {
	const open = features.filter((f) => !finished(f));
	return (branch && open.find((f) => f.branch === branch)) || open[0];
}

/**
 * The feature a command argument names: its directory (`.relay/<slug>`, from
 * anywhere), a file in that directory, the slug, or the slug without its date.
 */
export function findFeature(features: Feature[], name: string): Feature | undefined {
	const parts = name.trim().split(/[\\/]+/).filter(Boolean);
	if (parts.length > 1 && /\.md$/i.test(parts[parts.length - 1])) parts.pop();
	const last = parts.pop();
	if (!last) return undefined;
	return features.find((f) => f.slug === last) ?? features.find((f) => displayName(f.slug) === last);
}

export const STAGE_ICON: Record<Stage, string> = {
	"design-draft": "🎨",
	"design-approved": "🎨",
	"plan-draft": "📝",
	approved: "✅",
	implementing: "🔨",
	reviewing: "🔍",
	"in-review": "🚀",
	shipped: "🏁",
};

/** `▰▰▰▱▱▱▱▱` for done/total. */
export function progressBar(done: number, total: number, width = 8): string {
	if (total <= 0) return "";
	const filled = Math.round((Math.min(done, total) / total) * width);
	return "▰".repeat(filled) + "▱".repeat(width - filled);
}

/** `https://…/merge_requests/123` → `!123`; anything else stays as is. */
export function mrLabel(mr: string | undefined): string | undefined {
	if (!mr) return undefined;
	const m = /merge_requests\/(\d+)/.exec(mr) ?? /\/pull\/(\d+)/.exec(mr);
	return m ? `!${m[1]}` : mr;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What follows the name in the footer, without colours. */
export function stageLabel(f: Feature): string {
	const s = stage(f);
	const n = f.tasks.length;
	switch (s) {
		case "design-draft":
			return "design draft";
		case "design-approved":
			return "design approved";
		case "plan-draft":
			return n ? `plan draft · ${plural(n, "task")}` : "plan draft";
		case "approved":
			return n ? `approved · ${plural(n, "task")} · ready to ship` : "approved · ready to ship";
		case "implementing": {
			const cur = currentTask(f);
			return `${progressBar(tasksDone(f), n)} ${tasksDone(f)}/${n}${cur ? ` · T${cur.n} ${cur.name}` : ""}`;
		}
		case "reviewing":
			return f.reviews ? `review round ${f.reviews}` : "verify & review";
		case "in-review":
			return mrLabel(f.mr) ? `MR ${mrLabel(f.mr)}` : "MR open";
		case "shipped":
			return "shipped";
	}
}

/** Footer text without colours: `🔨 csv-export · ▰▰▰▱▱▱▱▱ 3/8 · T4 Export button`. */
export function statusLine(f: Feature): string {
	return `${STAGE_ICON[stage(f)]} ${displayName(f.slug)} · ${stageLabel(f)}`;
}

/** What the user would run next, given where the feature is. `path` is how to name the feature directory. */
export function nextStep(f: Feature, path: string): string {
	switch (stage(f)) {
		case "design-draft":
			return "review design.md, then approve";
		case "design-approved":
			return `/relay-plan ${path}`;
		case "plan-draft":
			return "approve plan.md, or review it first";
		case "approved":
			return `/relay-ship ${path}  ·  by hand: /relay-task ${path}`;
		case "implementing":
			return `/relay-ship ${path}  (resumes at the first unticked step)  ·  by hand: /relay-task ${path}`;
		case "reviewing":
			return `/relay-ship ${path}  (resumes at the first unticked step)`;
		case "in-review":
			return `${f.mr ? `MR: ${f.mr}` : "MR open"}  ·  once merged: /relay-done ${path}`;
		case "shipped":
			return "done";
	}
}
