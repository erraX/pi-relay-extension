#!/usr/bin/env node
/**
 * Distil one screen of a visual reference (a mockup, a prototype, an existing
 * page) into reference screenshots and measurements, for the UI contract that
 * relay-design writes (see ../references/ui-contract.md).
 *
 *   node distill-ui.mjs <spec.json> [--out <dir>]
 *   node distill-ui.mjs --show <measurements.json> [<state> [<element>]]
 *
 * The spec says which page to open, which states to put it in and which
 * elements to measure. For every state the script loads the page afresh, runs
 * the state's steps, saves `<out>/screenshots/<state>.png` and records the box
 * and the computed style of each named element in `<out>/measurements.json`.
 * `<out>` defaults to the spec's path without `.json`.
 *
 * Playwright is taken from the repository the command runs in, not from this
 * package: run it from the repository root. A repository without Playwright
 * cannot run this script; adding it is the user's decision.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE =
	"Usage: distill-ui.mjs <spec.json> [--out <dir>]\n" +
	"       distill-ui.mjs --show <measurements.json> [<state> [<element>]]";
const DEFAULT_VIEWPORT = { width: 1440, height: 1400 };
const STEP_KINDS = ["click", "hover", "fill", "select", "press", "wait", "waitFor"];

/**
 * Computed properties worth recording → the value left out because it says
 * nothing (the initial value). `null`: always recorded. Font size, line height
 * and weight are always recorded, as one `font` entry.
 */
const STYLE_PROPERTIES = {
	display: null,
	flex: "0 1 auto",
	gap: "normal",
	"align-items": "normal",
	"justify-content": "normal",
	"flex-wrap": "nowrap",
	"grid-template-columns": "none",
	"table-layout": "auto",
	padding: "0px",
	margin: "0px",
	color: null,
	"background-color": "rgba(0, 0, 0, 0)",
	"border-top": /^0px /,
	"border-bottom": /^0px /,
	"border-left": /^0px /,
	"border-radius": "0px",
	"box-shadow": "none",
	"text-align": "start",
	"vertical-align": "baseline",
	"text-decoration-line": "none",
	"white-space": "normal",
	overflow: "visible",
	"text-overflow": "clip",
	"overflow-wrap": "normal",
	cursor: "auto",
	opacity: "1",
};

const fail = (message) => {
	throw new Error(message);
};

/**
 * A URL as it stands, or a file path (relative to the spec) as a `file://`
 * URL. A `#fragment` or `?query` after the path is kept.
 */
export function resolveUrl(url, specDirectory) {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
	const [, path, suffix] = /^([^?#]*)(.*)$/.exec(url);
	return pathToFileURL(resolve(specDirectory, path)).href + suffix;
}

/** `"selector"` → first match; `{ "all": "selector" }` → every match. */
function parseElements(elements, where) {
	const parsed = {};
	for (const [name, value] of Object.entries(elements ?? {})) {
		if (typeof value === "string") parsed[name] = { selector: value, all: false };
		else if (value && typeof value.all === "string") parsed[name] = { selector: value.all, all: true };
		else fail(`${where}: element "${name}" must be a selector or { "all": "<selector>" }`);
	}
	return parsed;
}

function parseStep(step, where) {
	const keys = Object.keys(step ?? {});
	if (keys.length !== 1 || !STEP_KINDS.includes(keys[0])) {
		fail(`${where}: a step is an object with exactly one of ${STEP_KINDS.join(", ")}`);
	}
	const [kind] = keys;
	const value = step[kind];
	const isPair = Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "string");
	if ((kind === "fill" || kind === "select") && !isPair) fail(`${where}: "${kind}" takes ["<selector>", "<value>"]`);
	if (kind === "wait" && typeof value !== "number") fail(`${where}: "wait" takes milliseconds`);
	if (["click", "hover", "press", "waitFor"].includes(kind) && typeof value !== "string") {
		fail(`${where}: "${kind}" takes a string`);
	}
	return { kind, value };
}

/** Validates a spec and fills in the defaults. Throws with the offending place. */
export function parseSpec(spec, specPath) {
	if (typeof spec?.url !== "string") fail('spec: "url" is required (a URL, or a file path relative to the spec)');
	if (!Array.isArray(spec.states) || spec.states.length === 0) fail('spec: "states" needs at least one state');
	const names = new Set();
	const states = spec.states.map((state, index) => {
		const where = `states[${index}]`;
		if (!/^[a-z0-9][a-z0-9-]*$/.test(state?.name ?? "")) {
			fail(`${where}: "name" is lower-case letters, digits and hyphens (it becomes a file name)`);
		}
		if (names.has(state.name)) fail(`${where}: duplicate state name "${state.name}"`);
		names.add(state.name);
		const steps = (state.steps ?? []).map((step, stepIndex) => parseStep(step, `${where}.steps[${stepIndex}]`));
		return {
			name: state.name,
			description: state.description ?? "",
			steps,
			// A state that ends with the pointer on something shows its hover style.
			keepsPointer: steps.some((step) => step.kind === "hover"),
			elements: parseElements(state.elements, where),
			crops: Object.entries(state.crops ?? {}).map(([name, selector]) => {
				if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || typeof selector !== "string") {
					fail(`${where}: a crop is "<file-name-part>": "<selector>"`);
				}
				return { name, selector };
			}),
		};
	});
	return {
		url: resolveUrl(spec.url, dirname(resolve(specPath))),
		viewport: { ...DEFAULT_VIEWPORT, ...spec.viewport },
		root: spec.root ?? "body",
		hide: spec.hide ?? [],
		waitFor: spec.waitFor ?? spec.root ?? "body",
		tokenPrefix: spec.tokenPrefix ?? null,
		states,
	};
}

/** One line per measured element: name, text, box, style. */
export function formatElement(name, measured) {
	if (measured === null) return `${name}  (not found)`;
	const one = (item) => {
		const { x, y, width, height } = item.box;
		const style = Object.entries(item.style)
			.map(([property, value]) => `${property}: ${value}`)
			.join("; ");
		return `${name}  "${item.text}"  x=${x} y=${y} w=${width} h=${height}  ${style}`;
	};
	return Array.isArray(measured) ? measured.map(one).join("\n") : one(measured);
}

/**
 * Runs in the page. Per element: the box relative to the root element and the
 * computed style without initial values. With a token prefix, every colour and
 * length that equals a custom property with that prefix lists the property
 * names as candidates: a hint for the contract, not a decision.
 */
function measureInPage({ elements, styleProperties, rootSelector, tokenPrefix }) {
	const round = (value) => Math.round(value * 10) / 10;
	const origin = document.querySelector(rootSelector).getBoundingClientRect();

	/** @type {Record<string, string[]>} */
	const tokensByValue = {};
	if (tokenPrefix) {
		const probe = document.createElement("span");
		document.body.appendChild(probe);
		const rootStyle = getComputedStyle(document.documentElement);
		for (const name of rootStyle) {
			if (!name.startsWith(tokenPrefix)) continue;
			const value = rootStyle.getPropertyValue(name).trim();
			const property = CSS.supports("color", value) ? "color" : CSS.supports("width", value) ? "width" : null;
			// Type sizes are lengths too, but no padding or radius is ever one of them.
			if (!property || (property === "width" && /font|line-height|letter-spacing/.test(name))) continue;
			probe.style.setProperty(property, value);
			(tokensByValue[getComputedStyle(probe).getPropertyValue(property)] ||= []).push(name);
			probe.style.removeProperty(property);
		}
		probe.remove();
		// Many tokens share one value; the shortest names are the plainest ones.
		for (const names of Object.values(tokensByValue)) {
			names.sort((a, b) => a.length - b.length || a.localeCompare(b));
			names.length = Math.min(names.length, 3);
		}
	}

	const measure = (element) => {
		const box = element.getBoundingClientRect();
		const computed = getComputedStyle(element);
		const style = { font: `${computed.fontSize}/${computed.lineHeight} ${computed.fontWeight}` };
		const tokens = {};
		for (const [property, initialValue] of styleProperties) {
			const value = computed.getPropertyValue(property);
			if (initialValue !== null && new RegExp(initialValue).test(value)) continue;
			style[property] = value;
			for (const part of value.match(/rgba?\([^)]+\)|\b\d+(\.\d+)?px/g) || []) {
				if (tokensByValue[part]) tokens[part] = tokensByValue[part];
			}
		}
		const measured = {
			text: (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
			box: {
				x: round(box.left - origin.left),
				y: round(box.top - origin.top),
				width: round(box.width),
				height: round(box.height),
			},
			style,
		};
		if (tokenPrefix) measured.tokens = tokens;
		return measured;
	};

	const result = {};
	for (const [name, { selector, all }] of Object.entries(elements)) {
		const matches = [...document.querySelectorAll(selector)];
		result[name] = matches.length === 0 ? null : all ? matches.map(measure) : measure(matches[0]);
	}
	return {
		elements: result,
		overflowsHorizontally: document.documentElement.scrollWidth > document.documentElement.clientWidth,
	};
}

/** Playwright from the repository the command runs in. */
function loadChromium() {
	const requireFromRepository = createRequire(join(process.cwd(), "package.json"));
	for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
		try {
			return requireFromRepository(name).chromium;
		} catch (error) {
			if (error.code !== "MODULE_NOT_FOUND") throw error;
		}
	}
	return fail(
		`No Playwright in ${process.cwd()}. Run this from the root of a repository that has it. ` +
			"Adding Playwright to a repository is a dependency decision for the user.",
	);
}

async function runStep(page, { kind, value }) {
	if (kind === "click") await page.locator(value).first().click();
	else if (kind === "hover") await page.locator(value).first().hover();
	else if (kind === "fill") await page.locator(value[0]).first().fill(value[1]);
	else if (kind === "select") await page.locator(value[0]).first().selectOption(value[1]);
	else if (kind === "press") await page.keyboard.press(value);
	else if (kind === "wait") await page.waitForTimeout(value);
	else await page.locator(value).first().waitFor();
}

async function distil(specPath, outputDirectory) {
	const spec = parseSpec(JSON.parse(readFileSync(specPath, "utf8")), specPath);
	const screenshotDirectory = join(outputDirectory, "screenshots");
	mkdirSync(screenshotDirectory, { recursive: true });
	// Initial values travel as RegExp sources: page.evaluate takes JSON only.
	const styleProperties = Object.entries(STYLE_PROPERTIES).map(([property, initialValue]) => [
		property,
		initialValue instanceof RegExp
			? initialValue.source
			: initialValue === null
				? null
				: `^${initialValue.replace(/[()]/g, "\\$&")}$`,
	]);

	const browser = await loadChromium().launch();
	const context = await browser.newContext({ viewport: spec.viewport, deviceScaleFactor: 2 });
	const measurements = {
		url: spec.url,
		viewport: spec.viewport,
		root: spec.root,
		note: "box is in CSS px relative to the top-left corner of the root element",
		states: {},
	};
	const notFound = [];

	try {
		for (const state of spec.states) {
			const page = await context.newPage();
			await page.goto(spec.url);
			if (spec.hide.length > 0) {
				await page.addStyleTag({ content: `${spec.hide.join(", ")} { display: none !important; }` });
			}
			await page.locator(spec.waitFor).first().waitFor();
			for (const step of state.steps) await runStep(page, step);
			// A click leaves the pointer on the element, which would show its hover style.
			if (!state.keepsPointer) await page.mouse.move(0, 0);

			await page.locator(spec.root).first().screenshot({ path: join(screenshotDirectory, `${state.name}.png`) });
			for (const crop of state.crops) {
				await page
					.locator(crop.selector)
					.first()
					.screenshot({ path: join(screenshotDirectory, `${state.name}-${crop.name}.png`) });
			}
			const measured = await page.evaluate(measureInPage, {
				elements: state.elements,
				styleProperties,
				rootSelector: spec.root,
				tokenPrefix: spec.tokenPrefix,
			});
			measurements.states[state.name] = { description: state.description, ...measured };
			for (const [name, value] of Object.entries(measured.elements)) {
				if (value === null) notFound.push(`${state.name}: ${name} (${state.elements[name].selector})`);
			}
			await page.close();
		}
	} finally {
		await browser.close();
	}

	writeFileSync(join(outputDirectory, "measurements.json"), `${JSON.stringify(measurements, null, 2)}\n`);
	const shown = relative(process.cwd(), outputDirectory);
	console.log(`${spec.states.length} states → ${shown.startsWith("..") ? outputDirectory : shown || "."}`);
	if (notFound.length > 0) {
		// A named element that the page lacks is a wrong selector or a wrong state.
		fail(`Selectors that matched nothing:\n  ${notFound.join("\n  ")}`);
	}
}

function show(measurementsPath, stateName, elementName) {
	const { states } = JSON.parse(readFileSync(measurementsPath, "utf8"));
	if (!stateName) {
		for (const [name, state] of Object.entries(states)) {
			console.log(`${name}  ${Object.keys(state.elements).length} elements  ${state.description}`);
		}
		return;
	}
	const state = states[stateName] ?? fail(`No state "${stateName}". States: ${Object.keys(states).join(", ")}`);
	const names = elementName ? [elementName] : Object.keys(state.elements);
	for (const name of names) {
		if (!(name in state.elements)) fail(`No element "${name}" in state "${stateName}"`);
		console.log(formatElement(name, state.elements[name]));
	}
	if (!elementName) console.log(`overflowsHorizontally  ${state.overflowsHorizontally}`);
}

async function main(argv) {
	if (argv[0] === "--show" && argv[1]) return show(argv[1], argv[2], argv[3]);
	const outFlag = argv.indexOf("--out");
	const out = outFlag >= 0 ? argv[outFlag + 1] : undefined;
	const [specPath] = argv.filter((argument, index) => !argument.startsWith("--") && (outFlag < 0 || index !== outFlag + 1));
	if (!specPath?.endsWith(".json") || !existsSync(specPath) || (outFlag >= 0 && !out)) {
		fail(USAGE);
	}
	return distil(specPath, resolve(out ?? specPath.replace(/\.json$/, "")));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}
