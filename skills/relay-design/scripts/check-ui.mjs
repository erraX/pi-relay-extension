#!/usr/bin/env node
/**
 * Evaluate the checks of a UI contract (see ../references/ui-contract.md).
 *
 *   node check-ui.mjs <screen>.json
 *       The checks against the reference's own measurements, written earlier
 *       by distill-ui.mjs. Every check must pass here: one that fails on the
 *       reference does not say what its rule says.
 *
 *   node check-ui.mjs <screen>.json --impl <screen>.impl.json
 *       Measures the implementation afresh (the same states and element names,
 *       its own URL, steps and selectors), evaluates the same checks against
 *       it, and puts each pair of screenshots side by side for the reviewer.
 *
 * Writes `check-report.md` next to the measurements it judged and exits
 * non-zero when a check fails. Checks compare relations and sizes within a
 * tolerance (same row, a width, a gap, inside a container, a computed style),
 * never screenshots pixel by pixel.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { STYLE_PROPERTIES, distil, loadChromium } from "./distill-ui.mjs";

const USAGE = "Usage: check-ui.mjs <screen>.json [--impl <screen>.impl.json]";
const DEFAULT_TOLERANCE = 1;
const AXES = { gap: ["x", "y"], inside: ["x", "y", "both"] };

const fail = (message) => {
	throw new Error(message);
};
const isNames = (value) => typeof value === "string" || (Array.isArray(value) && value.every((name) => typeof name === "string"));
const isSize = (value) => typeof value === "number" || /^\d+(\.\d+)?%$/.test(value);
const hasBound = (check) => ["equals", "min", "max"].some((key) => key in check);
const round = (value) => Math.round(value * 10) / 10;

/** What each kind of check needs; returns a complaint or nothing. */
const KINDS = {
	sameRow: (check) => !isNames(check.of) && '"of" names the elements',
	stacked: (check) => !isNames(check.of) && '"of" names the elements',
	singleLine: (check) => !isNames(check.of) && '"of" names the elements',
	noHorizontalOverflow: () => false,
	width: sizeComplaint,
	height: sizeComplaint,
	gap: (check) => {
		const pair = Array.isArray(check.between) && check.between.length === 2 && isNames(check.between);
		if (!pair && !isNames(check.of)) return '"between": [a, b] or "of" names the elements';
		if (!hasBound(check)) return 'one of "equals", "min", "max" is required';
		return check.axis !== undefined && !AXES.gap.includes(check.axis) && '"axis" is "x" or "y"';
	},
	inside: (check) => {
		if (!isNames(check.of) || typeof check.container !== "string") return '"of" and "container" name the elements';
		return check.axis !== undefined && !AXES.inside.includes(check.axis) && '"axis" is "x", "y" or "both"';
	},
	style: (check) => {
		if (!isNames(check.of)) return '"of" names the elements';
		const expect = check.expect;
		const valid = expect && typeof expect === "object" && Object.values(expect).every((value) => typeof value === "string");
		return (!valid || Object.keys(expect).length === 0) && '"expect" maps properties to values';
	},
};

function sizeComplaint(check) {
	if (!isNames(check.of)) return '"of" names the elements';
	if (!hasBound(check)) return 'one of "equals", "min", "max" is required';
	const sizes = Array.isArray(check.equals) ? check.equals.filter((size) => size !== null) : "equals" in check ? [check.equals] : [];
	if (!sizes.every(isSize)) return '"equals" is px, "N%", or a list of those with null for a size that is not pinned';
	return sizes.some((size) => typeof size === "string") && typeof check.percentOf !== "string" && '"percentOf" names the element a "%" refers to';
}

/** Every check of the spec with its state, validated. Throws with the offending place. */
export function parseChecks(spec) {
	const checks = [];
	for (const [stateIndex, state] of (spec.states ?? []).entries()) {
		for (const [checkIndex, check] of (state.checks ?? []).entries()) {
			const where = `states[${stateIndex}].checks[${checkIndex}]`;
			if (typeof check?.rule !== "string" || check.rule === "") fail(`${where}: "rule" is the ID of the contract rule`);
			if (!(check.check in KINDS)) fail(`${where}: "check" is one of ${Object.keys(KINDS).join(", ")}`);
			const complaint = KINDS[check.check](check);
			if (complaint) fail(`${where} (${check.rule}, ${check.check}): ${complaint}`);
			checks.push({ ...check, state: state.name });
		}
	}
	return checks;
}

/** A check that cannot be judged: the reason becomes the check's result. */
class Unjudged extends Error {
	constructor(message, result = "fail") {
		super(message);
		this.result = result;
	}
}

function itemsOf(state, names) {
	return [names].flat().flatMap((name) => {
		if (!(name in state.elements)) throw new Unjudged(`element "${name}" is not measured in this state`);
		if (state.elements[name] === null) throw new Unjudged(`element "${name}" was not found on the page`);
		return [state.elements[name]].flat();
	});
}

function fontOf(item) {
	const [, size, lineHeight, weight] = /^([\d.]+)px\/(normal|[\d.]+px) (\d+)$/.exec(item.style.font) ?? [];
	const fontSize = Number(size);
	return { fontSize, lineHeight: lineHeight === "normal" ? fontSize * 1.2 : parseFloat(lineHeight), weight };
}

function verticalPadding(item) {
	const parts = (item.style.padding ?? "0px").split(" ").map(parseFloat);
	return parts[0] + (parts[2] ?? parts[0]);
}

const bounded = (actual, check, expected, tolerance) =>
	(expected === undefined || Math.abs(actual - expected) <= tolerance) &&
	(check.min === undefined || actual >= check.min - tolerance) &&
	(check.max === undefined || actual <= check.max + tolerance);

const describeBound = (check) =>
	[check.equals !== undefined && `${check.equals}`, check.min !== undefined && `≥ ${check.min}`, check.max !== undefined && `≤ ${check.max}`]
		.filter(Boolean)
		.join(", ");

const EVALUATORS = {
	sameRow(check, state) {
		const boxes = itemsOf(state, check.of).map((item) => item.box);
		if (boxes.length < 2) throw new Unjudged("needs at least two elements");
		const ok = boxes.slice(1).every((box, index) => {
			const previous = boxes[index];
			const overlap = Math.min(box.y + box.height, previous.y + previous.height) - Math.max(box.y, previous.y);
			return overlap > Math.min(box.height, previous.height) / 2;
		});
		return { ok, expected: "one row", actual: `y = ${boxes.map((box) => box.y).join(", ")}` };
	},
	stacked(check, state, { tolerance }) {
		const boxes = itemsOf(state, check.of).map((item) => item.box);
		if (boxes.length < 2) throw new Unjudged("needs at least two elements");
		const ok = boxes.slice(1).every((box, index) => box.y >= boxes[index].y + boxes[index].height - tolerance);
		return { ok, expected: "top to bottom, no overlap", actual: `y = ${boxes.map((box) => box.y).join(", ")}` };
	},
	singleLine(check, state) {
		const items = itemsOf(state, check.of);
		const heights = items.map((item) => round(item.box.height - verticalPadding(item)));
		const ok = items.every((item, index) => heights[index] < fontOf(item).lineHeight * 1.5);
		return { ok, expected: `one line (${fontOf(items[0]).lineHeight}px)`, actual: `text height ${heights.join(", ")}` };
	},
	noHorizontalOverflow(check, state) {
		return { ok: state.overflowsHorizontally === false, expected: "no horizontal scroll", actual: state.overflowsHorizontally ? "the page scrolls horizontally" : "none" };
	},
	width: (check, state, context) => evaluateSize("width", check, state, context),
	height: (check, state, context) => evaluateSize("height", check, state, context),
	gap(check, state, { tolerance }) {
		const axis = check.axis ?? "x";
		const [start, extent] = axis === "x" ? ["x", "width"] : ["y", "height"];
		const boxes = (check.between ? check.between.map((name) => itemsOf(state, name)[0]) : itemsOf(state, check.of)).map((item) => item.box);
		if (boxes.length < 2) throw new Unjudged("needs at least two elements");
		const gaps = boxes.slice(1).map((box, index) => round(box[start] - (boxes[index][start] + boxes[index][extent])));
		const ok = gaps.every((gap) => bounded(gap, check, check.equals, tolerance));
		return { ok, expected: `${axis} gap ${describeBound(check)}`, actual: gaps.join(", ") };
	},
	inside(check, state, { tolerance }) {
		const container = itemsOf(state, check.container)[0].box;
		const axis = check.axis ?? "both";
		const outside = [];
		for (const { box } of itemsOf(state, check.of)) {
			const edges = [
				axis !== "y" && box.x < container.x - tolerance && `left ${box.x} < ${container.x}`,
				axis !== "y" && box.x + box.width > container.x + container.width + tolerance && `right ${round(box.x + box.width)} > ${round(container.x + container.width)}`,
				axis !== "x" && box.y < container.y - tolerance && `top ${box.y} < ${container.y}`,
				axis !== "x" && box.y + box.height > container.y + container.height + tolerance && `bottom ${round(box.y + box.height)} > ${round(container.y + container.height)}`,
			].filter(Boolean);
			outside.push(...edges);
		}
		return { ok: outside.length === 0, expected: `inside ${check.container}`, actual: outside.length === 0 ? "inside" : [...new Set(outside)].join("; ") };
	},
	style(check, state, { measurements, mode }) {
		const items = itemsOf(state, check.of);
		const expected = Object.entries(check.expect).map(([property, value]) => {
			if (!value.startsWith("token:")) return [property, value, value];
			const name = value.slice("token:".length);
			const resolved = measurements.tokenValues?.[name] ?? measurements.tokenValues?.[`${measurements.tokenPrefix ?? ""}${name}`];
			if (resolved === undefined) {
				// A plain mockup defines no tokens; an implementation without the token is a defect.
				throw new Unjudged(`token "${name}" is not defined on the page`, mode === "reference" ? "skipped" : "fail");
			}
			return [property, resolved, `${name} (${resolved})`];
		});
		const actualOf = (item, property) => {
			const font = fontOf(item);
			if (property === "font-size") return `${font.fontSize}px`;
			if (property === "line-height") return `${font.lineHeight}px`;
			if (property === "font-weight") return font.weight;
			const initialValue = STYLE_PROPERTIES[property];
			return item.style[property] ?? (typeof initialValue === "string" ? initialValue : "(not recorded)");
		};
		const worst = items.find((item) => expected.some(([property, value]) => actualOf(item, property) !== value)) ?? items[0];
		return {
			ok: items.every((item) => expected.every(([property, value]) => actualOf(item, property) === value)),
			expected: expected.map(([property, , shown]) => `${property}: ${shown}`).join("; "),
			actual: expected.map(([property]) => `${property}: ${actualOf(worst, property)}`).join("; "),
		};
	},
};

function evaluateSize(dimension, check, state, { tolerance }) {
	const actual = itemsOf(state, check.of).map((item) => item.box[dimension]);
	const wholeOf = check.percentOf ? itemsOf(state, check.percentOf)[0].box[dimension] : undefined;
	const pinned = Array.isArray(check.equals) ? check.equals : actual.map(() => check.equals);
	if (pinned.length !== actual.length) throw new Unjudged(`pins ${pinned.length} sizes, measured ${actual.length} elements`);
	const px = pinned.map((size) => (typeof size === "string" ? round((parseFloat(size) / 100) * wholeOf) : (size ?? undefined)));
	const expected = Array.isArray(check.equals)
		? pinned.map((size, index) => (size === null ? "any" : typeof size === "string" ? `${size} (${px[index]})` : size)).join(", ")
		: describeBound(typeof check.equals === "string" ? { ...check, equals: `${check.equals} (${px[0]})` } : check);
	return { ok: actual.every((size, index) => bounded(size, check, px[index], tolerance)), expected: `${dimension} ${expected}`, actual: actual.join(", ") };
}

/**
 * Judges every check against the measurements. `mode` is "reference" (the
 * contract checking itself) or "implementation". A check marked `converted`
 * pins a value the contract changed on purpose, so the reference is not
 * expected to pass it.
 */
export function runChecks(checks, measurements, mode) {
	return checks.map((check) => {
		const base = { rule: check.rule, state: check.state, check: check.check };
		if (check.converted && mode === "reference") {
			return { ...base, result: "skipped", expected: "", actual: "", note: "converted: the contract's value differs from the reference on purpose" };
		}
		const state = measurements.states[check.state];
		if (!state) return { ...base, result: "fail", expected: "", actual: "", note: `state "${check.state}" is not measured` };
		try {
			const { ok, expected, actual } = EVALUATORS[check.check](check, state, { tolerance: check.tolerance ?? DEFAULT_TOLERANCE, measurements, mode });
			return { ...base, result: ok ? "pass" : "fail", expected, actual: `${actual}` };
		} catch (error) {
			if (!(error instanceof Unjudged)) throw error;
			return { ...base, result: error.result, expected: "", actual: "", note: error.message };
		}
	});
}

/**
 * Per checked element, what each side matched: a wrong selector in the
 * implementation spec shows up here as a different count or a different text.
 */
export function describeMapping(checks, reference, implementation) {
	const rows = [];
	const seen = new Set();
	for (const check of checks) {
		const names = [check.of, check.between, check.container, check.percentOf].flat().filter((name) => typeof name === "string");
		for (const name of names) {
			const key = `${check.state}\u0000${name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const sides = [reference, implementation].map((measurements) => {
				const measured = measurements.states[check.state]?.elements[name];
				const items = measured ? [measured].flat() : [];
				return { count: items.length, text: items[0]?.text ?? "" };
			});
			rows.push({ state: check.state, element: name, reference: sides[0], implementation: sides[1], differs: sides[0].count !== sides[1].count });
		}
	}
	return rows;
}

const cell = (text) => `${text}`.replace(/\|/g, "\\|").replace(/\n/g, " ");
const table = (header, rows) => [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");

/** The report as Markdown: failures first, then what passed, what was skipped, the element mapping. */
export function formatReport({ title, results, mapping = [], comparisons = [], notFound = [] }) {
	const by = (result) => results.filter((item) => item.result === result);
	const [failed, passed, skipped] = [by("fail"), by("pass"), by("skipped")];
	const lines = [`# ${title}`, "", `**${passed.length} of ${results.length} checks pass, ${failed.length} fail, ${skipped.length} skipped.**`];
	if (failed.length > 0) {
		lines.push("", "## Failed", "", table(["Rule", "State", "Check", "Expected", "Actual"], failed.map((item) => [item.rule, item.state, item.check, item.expected, item.note ?? item.actual])));
	}
	if (notFound.length > 0) lines.push("", "## Selectors that matched nothing", "", ...notFound.map((item) => `- ${item}`));
	if (passed.length > 0) {
		lines.push("", "## Passed", "", table(["Rule", "State", "Check", "Expected", "Actual"], passed.map((item) => [item.rule, item.state, item.check, item.expected, item.actual])));
	}
	if (skipped.length > 0) lines.push("", "## Skipped", "", table(["Rule", "State", "Check", "Why"], skipped.map((item) => [item.rule, item.state, item.check, item.note])));
	if (mapping.length > 0) {
		lines.push(
			"",
			"## Element mapping",
			"",
			"What each side matched for the elements the checks use. A different count or an unrelated text means the implementation spec points at the wrong element.",
			"",
			table(
				["State", "Element", "Reference", "Implementation", ""],
				mapping.map((row) => [row.state, row.element, `${row.reference.count} × "${row.reference.text}"`, `${row.implementation.count} × "${row.implementation.text}"`, row.differs ? "count differs" : ""]),
			),
		);
	}
	if (comparisons.length > 0) lines.push("", "## Side by side", "", "Reference on the left, implementation on the right.", "", ...comparisons.map((path) => `- \`${path}\``));
	return `${lines.join("\n")}\n`;
}

/** One image per screenshot both sides have: reference left, implementation right. */
async function writeComparisons(referenceDirectory, implementationDirectory) {
	const [referenceShots, implementationShots] = [referenceDirectory, implementationDirectory].map((directory) => join(directory, "screenshots"));
	const names = readdirSync(referenceShots).filter((name) => name.endsWith(".png") && existsSync(join(implementationShots, name)));
	if (names.length === 0) return [];
	const compareDirectory = join(implementationDirectory, "compare");
	mkdirSync(compareDirectory, { recursive: true });
	const pagePath = join(compareDirectory, "pair.html");
	const browser = await loadChromium().launch();
	try {
		const page = await browser.newPage({ viewport: { width: 2400, height: 1200 } });
		for (const name of names) {
			// Screenshots are taken at 2 device pixels per px: zoom brings them back to layout size.
			writeFileSync(
				pagePath,
				`<!doctype html><style>body{margin:0;font:14px sans-serif}#pair{display:inline-flex;gap:24px;padding:12px;background:#fff;align-items:flex-start}h2{margin:0 0 8px;font-size:14px}img{zoom:.5;outline:2px solid #ddd}</style>` +
					`<div id="pair"><div><h2>Reference</h2><img src="${pathToFileURL(join(referenceShots, name)).href}"></div>` +
					`<div><h2>Implementation</h2><img src="${pathToFileURL(join(implementationShots, name)).href}"></div></div>`,
			);
			await page.goto(pathToFileURL(pagePath).href);
			await page.locator("#pair").screenshot({ path: join(compareDirectory, name) });
		}
	} finally {
		await browser.close();
		rmSync(pagePath, { force: true });
	}
	return names.map((name) => join(compareDirectory, name));
}

async function main(argv) {
	const implFlag = argv.indexOf("--impl");
	const implPath = implFlag >= 0 ? argv[implFlag + 1] : undefined;
	const [specPath] = argv.filter((argument, index) => !argument.startsWith("--") && (implFlag < 0 || index !== implFlag + 1));
	if (!specPath?.endsWith(".json") || !existsSync(specPath) || (implFlag >= 0 && !(implPath?.endsWith(".json") && existsSync(implPath)))) fail(USAGE);

	const screen = basename(specPath, ".json");
	const checks = parseChecks(JSON.parse(readFileSync(specPath, "utf8")));
	if (checks.length === 0) fail(`${specPath} has no checks`);
	const referenceDirectory = resolve(specPath.replace(/\.json$/, ""));
	const referencePath = join(referenceDirectory, "measurements.json");
	if (!existsSync(referencePath)) fail(`No ${referencePath}. Run distill-ui.mjs on ${specPath} first.`);
	const reference = JSON.parse(readFileSync(referencePath, "utf8"));
	const shown = (path) => relative(process.cwd(), path);

	let report;
	let reportDirectory = referenceDirectory;
	let results;
	if (implPath) {
		reportDirectory = resolve(implPath.replace(/\.json$/, ""));
		// Always measured afresh: a report on stale measurements proves nothing.
		const { measurements, notFound } = await distil(implPath, reportDirectory);
		results = runChecks(checks, measurements, "implementation");
		const comparisons = await writeComparisons(referenceDirectory, reportDirectory);
		report = formatReport({
			title: `UI check: ${screen}, implementation`,
			results,
			mapping: describeMapping(checks, reference, measurements),
			comparisons: comparisons.map(shown),
			notFound,
		});
	} else {
		results = runChecks(checks, reference, "reference");
		report = formatReport({ title: `UI check: ${screen}, the contract against its reference`, results });
	}

	const reportPath = join(reportDirectory, "check-report.md");
	writeFileSync(reportPath, report);
	const failed = results.filter((item) => item.result === "fail");
	const count = (result) => results.filter((item) => item.result === result).length;
	console.log(`${count("pass")} pass, ${failed.length} fail, ${count("skipped")} skipped → ${shown(reportPath)}`);
	for (const item of failed) console.log(`  FAIL ${item.rule} ${item.state} ${item.check}: ${item.note ?? `expected ${item.expected}; actual ${item.actual}`}`);
	if (failed.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}
