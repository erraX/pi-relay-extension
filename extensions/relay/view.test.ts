import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "./features.ts";
import { formatDuration, segmentsWidth, stallLevel, taskChips } from "./view.ts";

/** `n` tasks, the first `done` complete, the next one half done. */
const tasks = (n: number, done: number): Task[] =>
	Array.from({ length: n }, (_, i) => ({ n: i + 1, name: `t${i + 1}`, done: i < done ? 2 : i === done ? 1 : 0, total: 2 }));

const text = (segs: { text: string }[]) => segs.map((s) => s.text).join(" ");

describe("taskChips", () => {
	it("shows one chip per task when they fit", () => {
		assert.equal(text(taskChips(tasks(5, 2), 80)), "✓T1 ✓T2 ●T3 ○T4 ○T5");
	});
	it("marks kinds for colouring", () => {
		assert.deepEqual(
			taskChips(tasks(3, 1), 80).map((s) => s.kind),
			["done", "current", "pending"],
		);
	});
	it("collapses finished tasks and counts the tail when too wide", () => {
		const segs = taskChips(tasks(40, 12), 30);
		assert.equal(text(segs), "✓T1–T12 ●T13 ○T14 ○T15 ○+25");
		assert.ok(segmentsWidth(segs) <= 30);
	});
	it("keeps the current task visible even in a tiny width", () => {
		assert.equal(text(taskChips(tasks(40, 0), 8)), "●T1 ○+39");
	});
	it("ends without a counter when the last task fits", () => {
		assert.equal(text(taskChips(tasks(12, 10), 20)), "✓T1–T10 ●T11 ○T12");
	});
});

describe("timers", () => {
	it("formats durations from one minute", () => {
		assert.equal(formatDuration(30_000), undefined);
		assert.equal(formatDuration(4 * 60_000), "4m");
		assert.equal(formatDuration(72 * 60_000), "1h12m");
	});
	it("warns after 15 minutes without progress and errors after 30", () => {
		assert.equal(stallLevel(10 * 60_000), undefined);
		assert.equal(stallLevel(16 * 60_000), "warn");
		assert.equal(stallLevel(31 * 60_000), "error");
	});
});
