/**
 * Width-aware layout for the task chips `/relay-status` prints, kept free of
 * any UI toolkit so it can be tested.
 *
 *   ✓T1 ✓T2 ✓T3 ●T4 ○T5 ○T6        everything fits
 *   ✓T1–T12 ●T13 ○T14 ○T15 ○+25     too many tasks for the width
 */

import { isComplete, type Task } from "./features.ts";

export type SegmentKind = "done" | "current" | "pending";
export type Segment = { kind: SegmentKind; text: string };

/** Every glyph used here is one terminal column wide, so length is width. */
export const segmentsWidth = (segments: Segment[]) =>
	segments.reduce((w, s, i) => w + s.text.length + (i ? 1 : 0), 0);

function chip(t: Task, current: Task | undefined): Segment {
	if (isComplete(t)) return { kind: "done", text: `✓T${t.n}` };
	if (t === current) return { kind: "current", text: `●T${t.n}` };
	return { kind: "pending", text: `○T${t.n}` };
}

/** One chip per task when they fit in `width`, else completed tasks collapse into a range and the tail into a count. */
export function taskChips(tasks: Task[], width: number): Segment[] {
	const current = tasks.find((t) => !isComplete(t));
	const full = tasks.map((t) => chip(t, current));
	if (segmentsWidth(full) <= width) return full;

	const out: Segment[] = [];
	let i = 0;
	while (i < tasks.length && isComplete(tasks[i])) i++;
	if (i === 1) out.push(chip(tasks[0], current));
	if (i > 1) out.push({ kind: "done", text: `✓T${tasks[0].n}–T${tasks[i - 1].n}` });

	const rest = tasks.slice(i);
	for (let j = 0; j < rest.length; j++) {
		const left = rest.length - j;
		const next = chip(rest[j], current);
		const more: Segment = { kind: "pending", text: `○+${left - 1}` };
		// Keep room for the "+N" counter unless this is the last task.
		const needed = segmentsWidth([...out, next, ...(left > 1 ? [more] : [])]);
		if (needed > width && out.length > 0) {
			out.push({ kind: "pending", text: `○+${left}` });
			return out;
		}
		out.push(next);
	}
	return out;
}

/** `4m`, `1h12m`; nothing under a minute. */
export function formatDuration(ms: number): string | undefined {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 1) return undefined;
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** No progress for this long while the agent works reads as stalled (warning), then as stuck (error). */
export const STALL_WARN_MS = 15 * 60_000;
export const STALL_ERROR_MS = 30 * 60_000;

export function stallLevel(sinceProgressMs: number): "warn" | "error" | undefined {
	if (sinceProgressMs >= STALL_ERROR_MS) return "error";
	if (sinceProgressMs >= STALL_WARN_MS) return "warn";
	return undefined;
}
