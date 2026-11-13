/**
 * relay: a personal SDLC workflow for pi.
 *
 *   /relay-init      set up .relay/ (self-ignoring) and config.json in this repo
 *   /relay-grill     one-question-at-a-time interview, no files by default
 *   /relay-design    idea → approved design.md (interview, approaches, mockups, Crit)
 *   /relay-plan      design or conversation → approved plan.md of vertical-slice tasks (Crit)
 *   /relay-ship      approved plan → implement, fresh review, fix, verify, draft MR
 *   /relay-status    every feature under .relay/ and its next step (no LLM)
 *
 * The workflow itself lives in skills/ as plain Agent Skills (portable to other
 * agents); this extension is the shell around them:
 * - registers skills/ through resources_discover, so nothing is symlinked;
 * - the five workflow commands forward to `/skill:relay-*` with their arguments,
 *   with completion of feature directories;
 * - /relay-status renders a card in the transcript that the LLM never sees;
 * - the footer shows the current feature by stage, with task progress while
 *   implementing:  🔨 relay csv-export ▰▰▰▱▱▱▱▱ 3/8 · T4 Export button · 6m
 *   and turns yellow, then red, when no step has been ticked for a while
 *   although the agent is working (⏳ stalled 18m);
 * - while implementing or reviewing, a two-line task strip sits below the editor:
 *     🔨 csv-export · T4 Export button · step 3/5 · 6m
 *     ✓T1 ✓T2 ✓T3 ●T4 ○T5 ○T6 ○T7 ○T8   verify 0/4 · 0 reviews
 *
 * State comes from the plan file (ticks, status) on every refresh: session start,
 * after file-changing tool calls, when the agent settles, and every 30s while it
 * works (for the timers). Timers live in memory and restart with the session.
 *
 * The relay-reviewer agent for pi-subagents is declared in the package manifest
 * (`pi.subagents.agents`), next to these skills in agents/.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { Box, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	currentTask,
	displayName,
	type Feature,
	listFeatures,
	nextStep,
	phase,
	pickCurrent,
	progressBar,
	RELAY_DIR,
	STAGE_ICON,
	type Stage,
	stage,
	stageLabel,
	tasksDone,
} from "./features.ts";
import { formatDuration, type SegmentKind, stallLevel, taskChips } from "./view.ts";

const baseDir = dirname(fileURLToPath(import.meta.url));
const STATUS_KEY = "relay";
const WIDGET_KEY = "relay-tasks";
const CARD_TYPE = "relay-status";
/** Tool calls after which plan.md may have changed (ticks, status). */
const REFRESH_TOOLS = new Set(["edit", "write", "bash"]);
const REFRESH_DEBOUNCE_MS = 250;
const TICK_MS = 30_000;
const FOOTER_TASK_NAME_MAX = 32;
const CARD_LABEL_MAX = 56;

type ThemeColor = Parameters<Theme["fg"]>[0];

const STAGE_COLOR: Record<Stage, ThemeColor> = {
	"design-draft": "muted",
	"design-approved": "muted",
	"plan-draft": "muted",
	approved: "success",
	implementing: "accent",
	reviewing: "warning",
	"in-review": "success",
	shipped: "dim",
};

const CHIP_COLOR: Record<SegmentKind, ThemeColor> = { done: "success", current: "accent", pending: "dim" };

type Workflow = { name: string; description: string; complete?: "features" | "plans" | "docs" };

const WORKFLOWS: Workflow[] = [
	{ name: "relay-init", description: "Set up .relay/ and config.json in this repo" },
	{ name: "relay-grill", description: "Interview to stress-test an idea or a relay doc", complete: "docs" },
	{ name: "relay-design", description: "Idea → approved design.md (interview, approaches, mockups, Crit)" },
	{ name: "relay-plan", description: "Design or conversation → approved plan.md (Crit)", complete: "features" },
	{ name: "relay-ship", description: "Approved plan → implement, review, fix, verify, draft MR", complete: "plans" },
];

type CardRow = { slug: string; stage: Stage; label: string; branch?: string; reviews: number; next: string };
/** Cards saved by the first version carried `phase` instead of `stage` / `label`. */
type LegacyCardRow = Partial<CardRow> & { slug: string; phase?: string; reviews?: number; next?: string };
type CardData = { root: string; rows: CardRow[] };

/** Timers derived from watching the plan between refreshes. */
type Clock = {
	/** Last observed progress fingerprint and when it changed. */
	progressKey?: string;
	progressAt: number;
	/** Last observed current task and since when it has been current. */
	taskKey?: string;
	taskSince: number;
};

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export default function relay(pi: ExtensionAPI) {
	/** Latest context and resolved repo root; completions have no ctx of their own. */
	let current: ExtensionContext | undefined;
	let cwd = process.cwd();
	let root: string | undefined;
	const rootCache = new Map<string, string | null>();
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let working = false;
	const clock: Clock = { progressAt: Date.now(), taskSince: Date.now() };

	pi.on("resources_discover", () => ({ skillPaths: [join(baseDir, "skills")] }));

	async function resolveRoot(dir: string): Promise<string | undefined> {
		if (!rootCache.has(dir)) {
			const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: dir, timeout: 3000 });
			rootCache.set(dir, r.code === 0 ? r.stdout.trim() : null);
		}
		return rootCache.get(dir) ?? undefined;
	}

	async function currentBranch(dir: string): Promise<string | undefined> {
		const r = await pi.exec("git", ["branch", "--show-current"], { cwd: dir, timeout: 3000 });
		return r.code === 0 ? r.stdout.trim() || undefined : undefined;
	}

	/**
	 * How to name a feature directory from the session cwd (repo root may differ).
	 * git reports the root as a real path, so compare against the real cwd: a
	 * symlinked cwd (/tmp → /private/tmp on macOS) would otherwise yield ../../../…
	 */
	const featurePath = (f: Feature) => {
		let from = cwd;
		try {
			from = realpathSync(cwd);
		} catch {}
		return relative(from, f.dir) || ".";
	};

	/** Restart the timers whenever a step is ticked or the current task changes. */
	function observe(f: Feature, now: number): void {
		const cur = currentTask(f);
		const taskKey = `${f.slug}|${cur?.n ?? "-"}`;
		const progressKey = `${taskKey}|${tasksDone(f)}|${cur?.done ?? 0}|${f.reviews}|${f.planStatus ?? ""}`;
		if (taskKey !== clock.taskKey) {
			clock.taskKey = taskKey;
			clock.taskSince = now;
		}
		if (progressKey !== clock.progressKey) {
			clock.progressKey = progressKey;
			clock.progressAt = now;
		}
	}

	const active = (f: Feature) => {
		const s = stage(f);
		return s === "implementing" || s === "reviewing";
	};

	/** `⏳ stalled 18m` in warning/error colour, only while the agent works on an active feature. */
	function stallText(f: Feature, theme: Theme, now: number): string | undefined {
		if (!working || !active(f)) return undefined;
		const level = stallLevel(now - clock.progressAt);
		if (!level) return undefined;
		return theme.fg(level === "error" ? "error" : "warning", `⏳ stalled ${formatDuration(now - clock.progressAt)}`);
	}

	function footerText(f: Feature, theme: Theme, now: number): string {
		const s = stage(f);
		const sep = theme.fg("dim", " · ");
		const head = `${STAGE_ICON[s]} ${theme.fg("dim", "relay")} ${theme.bold(displayName(f.slug))}`;
		const parts: string[] = [];
		if (s === "implementing") {
			const done = tasksDone(f);
			const bar = progressBar(done, f.tasks.length);
			const filled = bar.replace(/▱/g, "").length;
			parts.push(
				`${theme.fg("success", bar.slice(0, filled))}${theme.fg("dim", bar.slice(filled))} ${theme.fg("accent", `${done}/${f.tasks.length}`)}`,
			);
			const cur = currentTask(f);
			if (cur) parts.push(theme.fg("muted", `T${cur.n} ${shorten(cur.name, FOOTER_TASK_NAME_MAX)}`));
			const elapsed = formatDuration(now - clock.taskSince);
			if (elapsed) parts.push(theme.fg("dim", elapsed));
		} else {
			parts.push(theme.fg(STAGE_COLOR[s], stageLabel(f)));
		}
		const stall = stallText(f, theme, now);
		if (stall) parts.push(stall);
		return `${head} ${parts.join(sep)}`;
	}

	/** Two-line task strip below the editor while implementing or reviewing. */
	function widgetLines(f: Feature, theme: Theme, width: number, now: number): string[] {
		const s = stage(f);
		const sep = theme.fg("dim", " · ");
		const top: string[] = [`${STAGE_ICON[s]} ${theme.bold(displayName(f.slug))}`];
		if (s === "implementing") {
			const cur = currentTask(f);
			if (cur) {
				top.push(theme.fg("accent", `T${cur.n} ${cur.name}`));
				top.push(theme.fg("muted", `step ${cur.done}/${cur.total}`));
			}
			const elapsed = formatDuration(now - clock.taskSince);
			if (elapsed) top.push(theme.fg("dim", elapsed));
		} else {
			top.push(theme.fg("success", `all ${f.tasks.length} tasks done`));
			top.push(theme.fg("warning", stageLabel(f)));
		}
		const stall = stallText(f, theme, now);
		if (stall) top.push(stall);

		const v = f.verification;
		const tailPlain = `verify ${v.done}/${v.total} · ${f.reviews} review${f.reviews === 1 ? "" : "s"}`;
		const tail = theme.fg("dim", tailPlain);
		const budget = Math.max(10, width - 2 - visibleWidth(tailPlain) - 3);
		const chips = taskChips(f.tasks, budget)
			.map((c) => theme.fg(CHIP_COLOR[c.kind], c.text))
			.join(" ");
		return [truncateToWidth(` ${top.join(sep)}`, width), truncateToWidth(` ${chips}   ${tail}`, width)];
	}

	async function refresh(ctx: ExtensionContext | undefined = current): Promise<void> {
		if (!ctx) return;
		current = ctx;
		cwd = ctx.cwd;
		root = await resolveRoot(cwd);
		if (!ctx.hasUI) return;
		const features = root ? listFeatures(root) : [];
		const feature = pickCurrent(features, root ? await currentBranch(root) : undefined);
		const now = Date.now();
		if (!feature) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		observe(feature, now);
		const theme = ctx.ui.theme;
		ctx.ui.setStatus(STATUS_KEY, footerText(feature, theme, now));
		if (active(feature)) {
			ctx.ui.setWidget(
				WIDGET_KEY,
				(_tui, widgetTheme) => ({
					render: (width: number) => widgetLines(feature, widgetTheme, width, now),
					invalidate: () => {},
				}),
				{ placement: "belowEditor" },
			);
		} else {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
		}
	}

	function scheduleRefresh(): void {
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(() => {
			debounce = undefined;
			void refresh().catch(() => {});
		}, REFRESH_DEBOUNCE_MS);
	}

	function stopTicker(): void {
		if (ticker) clearInterval(ticker);
		ticker = undefined;
	}

	pi.on("session_start", async (_event, ctx) => {
		rootCache.clear();
		clock.progressKey = undefined;
		clock.taskKey = undefined;
		await refresh(ctx).catch(() => {});
	});
	pi.on("agent_start", async (_event, ctx) => {
		current = ctx;
		working = true;
		// The idle time before this run is not a stall.
		clock.progressAt = Date.now();
		if (!ticker) ticker = setInterval(() => void refresh().catch(() => {}), TICK_MS);
	});
	pi.on("agent_settled", async (_event, ctx) => {
		working = false;
		stopTicker();
		await refresh(ctx).catch(() => {});
	});
	pi.on("tool_execution_end", async (event, ctx) => {
		current = ctx;
		if (REFRESH_TOOLS.has(event.toolName)) scheduleRefresh();
	});
	pi.on("session_shutdown", async () => {
		if (debounce) clearTimeout(debounce);
		stopTicker();
	});

	function completions(kind: Workflow["complete"], prefix: string): AutocompleteItem[] | null {
		if (!kind || !root || !existsSync(join(root, RELAY_DIR))) return null;
		const open = listFeatures(root).filter((f) => f.planStatus !== "shipped");
		const items: AutocompleteItem[] = [];
		for (const f of open) {
			const dir = featurePath(f);
			if (kind === "features") items.push({ value: dir, label: f.slug, description: phase(f) });
			if (kind === "plans" && f.hasPlan) items.push({ value: dir, label: f.slug, description: phase(f) });
			if (kind === "docs") {
				if (f.hasDesign) items.push({ value: join(dir, "design.md"), label: `${f.slug}/design.md`, description: phase(f) });
				if (f.hasPlan) items.push({ value: join(dir, "plan.md"), label: `${f.slug}/plan.md`, description: phase(f) });
			}
		}
		const p = prefix.trim();
		const matched = p ? items.filter((i) => i.value.startsWith(p) || i.label.includes(p)) : items;
		return matched.length ? matched : null;
	}

	for (const wf of WORKFLOWS) {
		pi.registerCommand(wf.name, {
			description: wf.description,
			getArgumentCompletions: wf.complete ? (prefix) => completions(wf.complete, prefix) : undefined,
			handler: async (args, ctx) => {
				const text = `/skill:${wf.name}${args.trim() ? ` ${args.trim()}` : ""}`;
				if (ctx.isIdle()) pi.sendUserMessage(text, { expandPromptTemplates: true });
				else pi.sendUserMessage(text, { expandPromptTemplates: true, deliverAs: "followUp" });
			},
		});
	}

	pi.registerCommand("relay-status", {
		description: "Show relay features in this repo and the next step for each",
		handler: async (_args, ctx) => {
			await refresh(ctx);
			if (!root) {
				ctx.ui.notify("relay: not inside a git repository", "warning");
				return;
			}
			const features = listFeatures(root);
			if (!features.length) {
				ctx.ui.notify(
					existsSync(join(root, RELAY_DIR))
						? "relay: no features yet. Start with /relay-plan <topic> or /relay-design <topic>"
						: "relay: not set up here. Run /relay-init",
					"info",
				);
				return;
			}
			const data: CardData = {
				root,
				rows: features.map((f) => ({
					slug: f.slug,
					stage: stage(f),
					label: shorten(stageLabel(f), CARD_LABEL_MAX),
					branch: f.branch,
					reviews: f.reviews,
					next: nextStep(f, featurePath(f)),
				})),
			};
			pi.appendEntry(CARD_TYPE, data);
		},
	});

	pi.registerEntryRenderer<CardData>(CARD_TYPE, (entry, _options, theme) => {
		const repo = entry.data.root;
		const rows = (entry.data.rows as LegacyCardRow[]).map((r) => ({
			...r,
			stage: r.stage && r.stage in STAGE_ICON ? r.stage : ("plan-draft" as Stage),
			label: r.label ?? r.phase ?? "",
			reviews: r.reviews ?? 0,
			next: r.next ?? "",
		}));
		const box = new Box(1, 0, (text: string) => theme.bg("customMessageBg", text));
		box.addChild(new Text(`${theme.bold(theme.fg("accent", "relay"))} ${theme.fg("dim", repo)}`, 0, 0));
		const width = Math.max(...rows.map((r) => r.slug.length));
		for (const r of rows) {
			const meta = [r.branch, r.reviews ? `${r.reviews} review${r.reviews > 1 ? "s" : ""}` : undefined]
				.filter(Boolean)
				.join(" · ");
			box.addChild(
				new Text(
					`${STAGE_ICON[r.stage]} ${r.slug.padEnd(width)}  ${theme.fg(STAGE_COLOR[r.stage], r.label)}${meta ? theme.fg("dim", `  ${meta}`) : ""}`,
					0,
					0,
				),
			);
			if (r.next) box.addChild(new Text(theme.fg("muted", `   ${" ".repeat(width)}  → ${r.next}`), 0, 0));
		}
		return box;
	});
}
