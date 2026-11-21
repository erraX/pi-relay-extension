import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatElement, parseSpec, resolveUrl } from "./distill-ui.mjs";

const SPEC_PATH = "/repo/.relay/2026-01-02-csv-export/ui/todo-list.json";
const state = (overrides = {}) => ({ name: "01-default", ...overrides });
const spec = (overrides = {}) => ({ url: "https://example.test/todos", states: [state()], ...overrides });

describe("resolveUrl", () => {
	it("keeps a URL as it stands", () => {
		assert.equal(resolveUrl("http://localhost:3000/todos?x=1#top", "/repo/ui"), "http://localhost:3000/todos?x=1#top");
	});
	it("turns a path relative to the spec into a file URL and keeps the fragment", () => {
		assert.equal(resolveUrl("reference/index.html#/todos", "/repo/ui"), "file:///repo/ui/reference/index.html#/todos");
	});
	it("accepts an absolute path", () => {
		assert.equal(resolveUrl("/tmp/mock/index.html", "/repo/ui"), "file:///tmp/mock/index.html");
	});
});

describe("parseSpec", () => {
	it("fills in the defaults", () => {
		const parsed = parseSpec(spec(), SPEC_PATH);
		assert.deepEqual(parsed.viewport, { width: 1440, height: 1400 });
		assert.equal(parsed.root, "body");
		assert.equal(parsed.waitFor, "body");
		assert.equal(parsed.tokenPrefix, null);
		assert.deepEqual(parsed.states[0], {
			name: "01-default",
			description: "",
			steps: [],
			keepsPointer: false,
			elements: {},
			checks: [],
			crops: [],
		});
	});
	it("waits for the root element unless the spec names something else", () => {
		assert.equal(parseSpec(spec({ root: "#app" }), SPEC_PATH).waitFor, "#app");
		assert.equal(parseSpec(spec({ root: "#app", waitFor: "table" }), SPEC_PATH).waitFor, "table");
	});
	it("resolves a file path against the spec's directory", () => {
		const parsed = parseSpec(spec({ url: "reference/index.html#/todos" }), SPEC_PATH);
		assert.equal(parsed.url, "file:///repo/.relay/2026-01-02-csv-export/ui/reference/index.html#/todos");
	});
	it("reads an element as the first match or as every match", () => {
		const parsed = parseSpec(spec({ states: [state({ elements: { table: "table", cells: { all: "td" } } })] }), SPEC_PATH);
		assert.deepEqual(parsed.states[0].elements, {
			table: { selector: "table", all: false },
			cells: { selector: "td", all: true },
		});
	});
	it("keeps the pointer in place for a state with a hover step", () => {
		const parsed = parseSpec(spec({ states: [state({ steps: [{ click: "a" }, { hover: "tr" }] })] }), SPEC_PATH);
		assert.equal(parsed.states[0].keepsPointer, true);
		assert.deepEqual(parsed.states[0].steps, [
			{ kind: "click", value: "a" },
			{ kind: "hover", value: "tr" },
		]);
	});

	const rejects = (overrides: object, message: RegExp) => assert.throws(() => parseSpec(spec(overrides), SPEC_PATH), message);

	it("rejects a spec without a url or without states", () => {
		rejects({ url: undefined }, /"url" is required/);
		rejects({ states: [] }, /at least one state/);
	});
	it("rejects a state name that cannot be a file name, and a duplicate", () => {
		rejects({ states: [state({ name: "All rows" })] }, /states\[0\]: "name"/);
		rejects({ states: [state(), state()] }, /states\[1\]: duplicate state name "01-default"/);
	});
	it("rejects a step with an unknown kind, two kinds or the wrong value", () => {
		rejects({ states: [state({ steps: [{ tap: "a" }] })] }, /states\[0\]\.steps\[0\]: a step is/);
		rejects({ states: [state({ steps: [{ click: "a", hover: "b" }] })] }, /a step is/);
		rejects({ states: [state({ steps: [{ fill: "input" }] })] }, /"fill" takes \["<selector>", "<value>"\]/);
		rejects({ states: [state({ steps: [{ wait: "500" }] })] }, /"wait" takes milliseconds/);
	});
	it("rejects an element that is neither a selector nor { all }", () => {
		rejects({ states: [state({ elements: { table: { selector: "table" } } })] }, /element "table" must be/);
	});
});

describe("formatElement", () => {
	const measured = { text: "Search", box: { x: 41, y: 217, width: 338, height: 60 }, style: { font: "14px/20px 400", display: "flex" } };

	it("prints one line with the box and the style", () => {
		assert.equal(formatElement("search", measured), 'search  "Search"  x=41 y=217 w=338 h=60  font: 14px/20px 400; display: flex');
	});
	it("prints one line per match", () => {
		assert.equal(formatElement("fields", [measured, measured]).split("\n").length, 2);
	});
	it("says when the element was not found", () => {
		assert.equal(formatElement("menu", null), "menu  (not found)");
	});
});
