import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeMapping, formatReport, parseChecks, runChecks } from "./check-ui.mjs";

type Box = { x: number; y: number; width: number; height: number };
const item = (box: Partial<Box>, style: Record<string, string> = {}, text = "") => ({
	text,
	box: { x: 0, y: 0, width: 100, height: 20, ...box },
	style: { font: "14px/20px 400", ...style },
});

/** Measurements with one state, `default`, holding the given elements. */
const measured = (elements: Record<string, unknown>, extra: object = {}) => ({
	tokenPrefix: "--ds_",
	tokenValues: { "--ds_color_action": "rgb(0, 113, 194)" },
	states: { default: { elements, overflowsHorizontally: false, ...extra } },
});

/** The result of one check against the elements, as the implementation. */
const judge = (check: object, elements: Record<string, unknown>, mode = "implementation", extra: object = {}) =>
	runChecks([{ rule: "R1", state: "default", ...check }], measured(elements, extra), mode)[0];

describe("parseChecks", () => {
	const spec = (checks: object[]) => ({ states: [{ name: "default", checks }] });

	it("returns every check with the name of its state", () => {
		const checks = parseChecks({
			states: [
				{ name: "default", checks: [{ rule: "F2", check: "sameRow", of: "fields" }] },
				{ name: "empty" },
				{ name: "hover", checks: [{ rule: "G1", check: "style", of: "cell", expect: { cursor: "pointer" } }] },
			],
		});
		assert.deepEqual(
			checks.map((check: { rule: string; state: string }) => [check.rule, check.state]),
			[
				["F2", "default"],
				["G1", "hover"],
			],
		);
	});
	it("rejects a check without a rule or with an unknown kind", () => {
		assert.throws(() => parseChecks(spec([{ check: "sameRow", of: "a" }])), /states\[0\]\.checks\[0\]: "rule"/);
		assert.throws(() => parseChecks(spec([{ rule: "F2", check: "aligned", of: "a" }])), /"check" is one of sameRow/);
	});
	it("rejects a check that lacks what its kind needs", () => {
		assert.throws(() => parseChecks(spec([{ rule: "F3", check: "width", of: "a" }])), /\(F3, width\): one of "equals", "min", "max"/);
		assert.throws(() => parseChecks(spec([{ rule: "T2", check: "width", of: "a", equals: [44, "13%"] }])), /"percentOf" names the element/);
		assert.throws(() => parseChecks(spec([{ rule: "S3", check: "gap", equals: 8 }])), /"between": \[a, b\] or "of"/);
		assert.throws(() => parseChecks(spec([{ rule: "T8", check: "inside", of: "a" }])), /"of" and "container"/);
		assert.throws(() => parseChecks(spec([{ rule: "L1", check: "style", of: "a", expect: {} }])), /"expect" maps properties/);
	});
});

describe("runChecks", () => {
	it("sameRow passes for boxes that share a line and fails when one wraps", () => {
		const row = [item({ x: 0, y: 153, height: 60 }), item({ x: 200, y: 153, height: 60 })];
		assert.equal(judge({ check: "sameRow", of: "fields" }, { fields: row }).result, "pass");
		const wrapped = judge({ check: "sameRow", of: "fields" }, { fields: [...row, item({ x: 0, y: 229, height: 60 })] });
		assert.equal(wrapped.result, "fail");
		assert.equal(wrapped.actual, "y = 153, 153, 229");
	});
	it("sameRow takes controls of different heights that overlap as one row", () => {
		const result = judge({ check: "sameRow", of: ["subtitle", "action"] }, { subtitle: item({ y: 148, height: 24 }), action: item({ y: 136, height: 36 }) });
		assert.equal(result.result, "pass");
	});
	it("stacked fails when a later element starts before the previous one ends", () => {
		const groups = (ys: number[]) => ({ groups: ys.map((y) => item({ y, height: 28 })) });
		assert.equal(judge({ check: "stacked", of: "groups" }, groups([310, 346, 382])).result, "pass");
		assert.equal(judge({ check: "stacked", of: "groups" }, groups([301, 301, 301])).result, "fail");
	});
	it("width compares each element with its pinned size, a percentage of another element, or nothing", () => {
		const elements = { table: item({ width: 1108 }), cells: [44, 183.4, 143.8].map((width) => item({ width })) };
		const check = { check: "width", of: "cells", equals: [44, null, "13%"], percentOf: "table" };
		const pass = judge(check, elements);
		assert.equal(pass.result, "pass");
		assert.equal(pass.expected, "width 44, any, 13% (144)");
		assert.equal(judge(check, { ...elements, cells: [60, 458.8, 152.8].map((width) => item({ width })) }).result, "fail");
	});
	it("width honours the tolerance and min / max", () => {
		const one = (width: number) => ({ field: item({ width }) });
		assert.equal(judge({ check: "width", of: "field", equals: 168 }, one(168.8)).result, "pass");
		assert.equal(judge({ check: "width", of: "field", equals: 168 }, one(192)).result, "fail");
		assert.equal(judge({ check: "width", of: "field", equals: 168, tolerance: 30 }, one(192)).result, "pass");
		assert.equal(judge({ check: "width", of: "field", min: 240 }, one(192)).result, "fail");
		assert.equal(judge({ check: "height", of: "field", max: 32 }, { field: item({ height: 32 }) }).result, "pass");
	});
	it("width fails when the list pins a different number of elements than were measured", () => {
		const result = judge({ check: "width", of: "cells", equals: [44, 108] }, { cells: [item({}), item({}), item({})] });
		assert.equal(result.result, "fail");
		assert.equal(result.note, "pins 2 sizes, measured 3 elements");
	});
	it("gap measures between two elements or between neighbours, on either axis", () => {
		const elements = { header: item({ y: 110, height: 62 }), card: item({ y: 196, height: 231 }), fields: [0, 180, 360].map((x) => item({ x, width: 168 })) };
		assert.equal(judge({ check: "gap", between: ["header", "card"], axis: "y", equals: 24 }, elements).result, "pass");
		assert.equal(judge({ check: "gap", between: ["header", "card"], axis: "y", equals: 16 }, elements).result, "fail");
		const neighbours = judge({ check: "gap", of: "fields", equals: 12 }, elements);
		assert.equal(neighbours.result, "pass");
		assert.equal(neighbours.actual, "12, 12");
	});
	it("inside names the edge that leaves the container", () => {
		const elements = { table: item({ x: 16, width: 1108 }), actions: [item({ x: 967, width: 153.7 }), item({ x: 1152.3, width: 85.1 })] };
		const result = judge({ check: "inside", of: "actions", container: "table", axis: "x" }, elements);
		assert.equal(result.result, "fail");
		assert.equal(result.actual, "right 1237.4 > 1124");
		assert.equal(judge({ check: "inside", of: "actions", container: "table" }, { ...elements, actions: [item({ x: 967, width: 153.7 })] }).result, "pass");
	});
	it("singleLine looks at the height without the padding", () => {
		const padded = { padding: "12px 8px" };
		assert.equal(judge({ check: "singleLine", of: "team" }, { team: item({ height: 17 }) }).result, "pass");
		assert.equal(judge({ check: "singleLine", of: "team" }, { team: item({ height: 60 }) }).result, "fail");
		assert.equal(judge({ check: "singleLine", of: "cell" }, { cell: item({ height: 44 }, padded) }).result, "pass");
	});
	it("style compares computed values, with the initial value for what was not recorded", () => {
		const link = (style: Record<string, string>) => ({ link: item({}, style) });
		const check = { check: "style", of: "link", expect: { color: "token:color_action", "text-decoration-line": "none", "font-weight": "600" } };
		const pass = judge(check, link({ font: "14px/20px 600", color: "rgb(0, 113, 194)" }));
		assert.equal(pass.result, "pass");
		assert.equal(pass.expected, "color: color_action (rgb(0, 113, 194)); text-decoration-line: none; font-weight: 600");
		const browserDefault = judge(check, link({ color: "rgb(0, 0, 238)", "text-decoration-line": "underline" }));
		assert.equal(browserDefault.result, "fail");
		assert.equal(browserDefault.actual, "color: rgb(0, 0, 238); text-decoration-line: underline; font-weight: 400");
	});
	it("an undefined token fails on the implementation and is skipped on a reference without tokens", () => {
		const check = { check: "style", of: "link", expect: { color: "token:color_missing" } };
		const elements = { link: item({}, { color: "rgb(0, 113, 194)" }) };
		assert.equal(judge(check, elements).result, "fail");
		assert.equal(judge(check, elements).note, 'token "color_missing" is not defined on the page');
		assert.equal(judge(check, elements, "reference").result, "skipped");
	});
	it("noHorizontalOverflow reads the state", () => {
		assert.equal(judge({ check: "noHorizontalOverflow" }, {}).result, "pass");
		assert.equal(judge({ check: "noHorizontalOverflow" }, {}, "implementation", { overflowsHorizontally: true }).result, "fail");
	});
	it("a converted check is skipped on the reference and judged on the implementation", () => {
		const check = { check: "style", of: "card", expect: { "border-radius": "2px" }, converted: true };
		const elements = { card: item({}, { "border-radius": "8px" }) };
		assert.equal(judge(check, elements, "reference").result, "skipped");
		assert.equal(judge(check, elements).result, "fail");
	});
	it("fails with the reason when the state or an element is missing", () => {
		assert.equal(judge({ check: "sameRow", of: "fields" }, {}).note, 'element "fields" is not measured in this state');
		assert.equal(judge({ check: "sameRow", of: "fields" }, { fields: null }).note, 'element "fields" was not found on the page');
		const [result] = runChecks([{ rule: "G1", state: "hover", check: "noHorizontalOverflow" }], measured({}), "implementation");
		assert.deepEqual([result.result, result.note], ["fail", 'state "hover" is not measured']);
	});
});

describe("describeMapping", () => {
	it("lists each checked element once with what both sides matched", () => {
		const checks = [
			{ rule: "F2", state: "default", check: "sameRow", of: "fields" },
			{ rule: "F3", state: "default", check: "width", of: "fields", equals: 168 },
			{ rule: "T8", state: "default", check: "inside", of: "actions", container: "table" },
		];
		const reference = measured({ fields: [item({}, {}, "Search"), item({})], actions: item({}, {}, "Edit"), table: item({}) });
		const implementation = measured({ fields: [item({}, {}, "Search")], actions: item({}, {}, "Edit"), table: item({}) });
		const rows = describeMapping(checks, reference, implementation);
		assert.deepEqual(
			rows.map((row: { element: string; differs: boolean }) => [row.element, row.differs]),
			[
				["fields", true],
				["actions", false],
				["table", false],
			],
		);
		assert.deepEqual(rows[0].reference, { count: 2, text: "Search" });
	});
});

describe("formatReport", () => {
	const results = [
		{ rule: "F2", state: "default", check: "sameRow", result: "fail", expected: "one row", actual: "y = 153, 229" },
		{ rule: "S5", state: "default", check: "noHorizontalOverflow", result: "pass", expected: "no horizontal scroll", actual: "none" },
		{ rule: "F1", state: "default", check: "style", result: "skipped", expected: "", actual: "", note: "converted" },
	];

	it("counts the results and lists the failures first", () => {
		const report = formatReport({ title: "UI check: todo-list", results });
		assert.match(report, /^# UI check: todo-list\n\n\*\*1 of 3 checks pass, 1 fail, 1 skipped\.\*\*/);
		assert.ok(report.indexOf("## Failed") < report.indexOf("## Passed"));
		assert.match(report, /\| F2 \| default \| sameRow \| one row \| y = 153, 229 \|/);
		assert.match(report, /\| F1 \| default \| style \| converted \|/);
	});
	it("leaves out the sections that have nothing to say", () => {
		const report = formatReport({ title: "t", results: results.slice(1, 2) });
		assert.doesNotMatch(report, /## Failed|## Skipped|## Element mapping|## Side by side/);
	});
});
