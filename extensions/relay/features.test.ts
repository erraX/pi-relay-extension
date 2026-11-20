import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	countChecks,
	currentTask,
	displayName,
	listFeatures,
	mrLabel,
	nextStep,
	parseFrontmatter,
	parsePlan,
	parseTaskFile,
	pickCurrent,
	progressBar,
	stage,
	statusLine,
} from "./features.ts";

const lines = (...l: string[]) => l.join("\n");

/** A repo root with `.relay/<slug>/<file>` for each entry; `age` (seconds ago) orders mtimes. */
function repo(files: Record<string, { text: string; age?: number }>): string {
	const root = mkdtempSync(join(tmpdir(), "relay-test-"));
	for (const [rel, { text, age = 0 }] of Object.entries(files)) {
		const path = join(root, ".relay", rel);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, text);
		const t = Date.now() / 1000 - age;
		utimesSync(path, t, t);
	}
	return root;
}

const doc = (fm: string, body = "") => lines("---", fm, "---", "# Plan", body);

type TaskSpec = [name: string, done: number, total: number];
type Files = Record<string, { text: string; age?: number }>;

const boxes = (done: number, total: number, label: string) =>
	Array.from({ length: total }, (_, s) => `- [${s < done ? "x" : " "}] ${label} ${s + 1}`);

const verifyBody = ([done, total]: [number, number]) => lines("## Verification", ...boxes(done, total, "check"));

/** A feature as relay-plan writes it: `plan.md` plus `tasks/NN-<slug>.md` per [name, done, total]. */
function feature(slug: string, fm: string, tasks: TaskSpec[] = [], verify: [number, number] = [0, 0], age = 0): Files {
	const files: Files = { [`${slug}/plan.md`]: { text: doc(fm, verifyBody(verify)), age } };
	tasks.forEach(([name, done, total], i) => {
		const file = `${String(i + 1).padStart(2, "0")}-${name.toLowerCase().replace(/\W+/g, "-")}.md`;
		files[`${slug}/tasks/${file}`] = { text: lines(`# Task ${i + 1}: ${name}`, ...boxes(done, total, "**Step**")), age };
	});
	return files;
}

/** A plan body from before tasks had their own files: `### Task N:` sections inside plan.md. */
const inlineTasksBody = (tasks: TaskSpec[], verify: [number, number] = [0, 0]) =>
	lines(
		"## Tasks",
		...tasks.flatMap(([name, done, total], i) => [`### Task ${i + 1}: ${name}`, ...boxes(done, total, "**Step**")]),
		verifyBody(verify),
	);

describe("parseFrontmatter", () => {
	it("reads flat keys and drops empty values", () => {
		assert.deepEqual(parseFrontmatter(doc(lines("status: approved", "branch:", "base: origin/master", "mr:"))), {
			status: "approved",
			base: "origin/master",
		});
	});
	it("strips trailing comments and quotes", () => {
		assert.deepEqual(parseFrontmatter(lines("---", "status: draft   # draft → approved", 'mr: "https://x/1"', "---")), {
			status: "draft",
			mr: "https://x/1",
		});
	});
	it("returns nothing without frontmatter", () => {
		assert.deepEqual(parseFrontmatter("# Plan\nstatus: approved"), {});
	});
});

describe("countChecks", () => {
	it("counts ticked and open boxes, ignoring code fences", () => {
		const text = lines("- [x] real", "```markdown", "- [ ] example", "```", "* [X] real", "- [ ] real");
		assert.deepEqual(countChecks(text), { done: 2, total: 3 });
	});
});

describe("parseTaskFile", () => {
	it("takes the number from the file name, the name from the heading, the steps from the checkboxes", () => {
		const text = lines(
			"# Task 3: `Export` button",
			"**Demo:** clicking Export downloads todos.csv",
			"- [x] **Step 1**",
			"  - a test case, not a step",
			"```markdown",
			"# Task 9: not the heading",
			"- [ ] not a step",
			"```",
			"- [ ] **Step 2**",
		);
		assert.deepEqual(parseTaskFile("03-export-button.md", text), { n: 3, name: "Export button", done: 1, total: 2 });
	});
	it("trusts the file name when the heading numbers the task differently", () => {
		assert.equal(parseTaskFile("02-composer.md", "# Task 5: Composer")?.n, 2);
	});
	it("falls back to the slug when the file has no heading", () => {
		assert.deepEqual(parseTaskFile("12-export-button.md", "- [ ] a"), { n: 12, name: "export button", done: 0, total: 1 });
	});
	it("does not treat other files as tasks", () => {
		assert.equal(parseTaskFile("README.md", "# Task 1: a"), undefined);
		assert.equal(parseTaskFile("01-a.txt", "# Task 1: a"), undefined);
	});
});

describe("parsePlan", () => {
	it("reads the verification checklist and no tasks from a plan whose tasks are files", () => {
		const plan = lines("## Task Overview", "| 1 | Export button | … |", "## Verification", "- [x] `npm test`", "- [ ] Manual: look");
		assert.deepEqual(parsePlan(plan), { tasks: [], verification: { done: 1, total: 2 } });
	});
	it("groups the steps of inline tasks under their task and keeps verification separate", () => {
		const { tasks, verification } = parsePlan(
			lines(
				"## Task Overview",
				"| # | Task | Demo |",
				"## Verification",
				"- [x] `npm test`",
				"- [ ] Manual: open the page",
				"## Tasks",
				"### Task 1: `Export` button",
				"- [x] Step 1",
				"- [x] Step 2",
				"### Task 2 — Composer",
				"- [x] Step 1",
				"- [ ] Step 2",
				"```markdown",
				"### Task 9: not a task",
				"- [ ] not a step",
				"```",
				"## Notes",
				"- [ ] not part of task 2",
			),
		);
		assert.deepEqual(tasks, [
			{ n: 1, name: "Export button", done: 2, total: 2 },
			{ n: 2, name: "Composer", done: 1, total: 2 },
		]);
		assert.deepEqual(verification, { done: 1, total: 2 });
	});
	it("finds no tasks in a plan without task headings", () => {
		assert.deepEqual(parsePlan(lines("# Plan", "- [ ] a")), { tasks: [], verification: { done: 0, total: 0 } });
	});
});

describe("listFeatures", () => {
	it("returns nothing without .relay", () => {
		assert.deepEqual(listFeatures(mkdtempSync(join(tmpdir(), "relay-empty-"))), []);
	});
	it("reads design, plan and task state, most recent first, skipping empty dirs", () => {
		const root = repo({
			"2026-01-01-old/plan.md": { text: doc("status: shipped\nbranch: feat/old"), age: 100 },
			"2026-01-02-new/design.md": { text: doc("status: approved"), age: 10 },
			...feature("2026-01-02-new", "status: implementing\nbranch: feat/new", [["a", 2, 2], ["b", 1, 3]], [0, 2], 5),
			"2026-01-02-new/reviews/round-1.md": { text: "# r1", age: 1 },
			"2026-01-03-idea/notes.txt": { text: "not a feature" },
			".hidden/plan.md": { text: doc("status: draft") },
		});
		const [fresh, old] = listFeatures(root);
		assert.equal(fresh.slug, "2026-01-02-new");
		assert.equal(fresh.designStatus, "approved");
		assert.equal(fresh.branch, "feat/new");
		assert.equal(fresh.tasks.length, 2);
		assert.deepEqual(fresh.verification, { done: 0, total: 2 });
		assert.equal(fresh.reviews, 1);
		assert.equal(currentTask(fresh)?.name, "b");
		assert.equal(old.slug, "2026-01-01-old");
		assert.equal(listFeatures(root).length, 2);
	});
	it("orders task files by number and ignores other files in tasks/", () => {
		const [f] = listFeatures(
			repo({
				"2026-01-01-x/plan.md": { text: doc("status: implementing") },
				"2026-01-01-x/tasks/10-last.md": { text: "# Task 10: Last\n- [ ] s" },
				"2026-01-01-x/tasks/2-second.md": { text: "# Task 2: Second\n- [ ] s" },
				"2026-01-01-x/tasks/01-first.md": { text: "# Task 1: First\n- [x] s" },
				"2026-01-01-x/tasks/README.md": { text: "# Task 99: not a task\n- [ ] s" },
			}),
		);
		assert.deepEqual(
			f.tasks.map((t) => `${t.n} ${t.name}`),
			["1 First", "2 Second", "10 Last"],
		);
		assert.equal(currentTask(f)?.n, 2);
	});
	it("counts a tick in a task file as activity on the feature", () => {
		const features = listFeatures(
			repo({
				"2026-01-01-a/plan.md": { text: doc("status: implementing"), age: 50 },
				"2026-01-01-a/tasks/01-a.md": { text: "# Task 1: a\n- [x] s", age: 1 },
				"2026-01-02-b/plan.md": { text: doc("status: draft"), age: 10 },
			}),
		);
		assert.equal(features[0].slug, "2026-01-01-a");
	});
	it("reads tasks kept inside plan.md when the feature has no task files", () => {
		const [f] = listFeatures(
			repo({
				"2026-01-01-x/plan.md": { text: doc("status: implementing", inlineTasksBody([["a", 2, 2], ["b", 1, 3]], [1, 2])) },
			}),
		);
		assert.deepEqual(f.tasks, [
			{ n: 1, name: "a", done: 2, total: 2 },
			{ n: 2, name: "b", done: 1, total: 3 },
		]);
		assert.deepEqual(f.verification, { done: 1, total: 2 });
	});
	it("prefers task files to tasks left inside plan.md", () => {
		const [f] = listFeatures(
			repo({
				"2026-01-01-x/plan.md": { text: doc("status: implementing", inlineTasksBody([["stale", 0, 2]])) },
				"2026-01-01-x/tasks/01-fresh.md": { text: "# Task 1: Fresh\n- [x] s" },
			}),
		);
		assert.deepEqual(f.tasks, [{ n: 1, name: "Fresh", done: 1, total: 1 }]);
	});
});

describe("stage", () => {
	const of = (fm: string, tasks: TaskSpec[] = [], design?: string) =>
		listFeatures(
			repo({
				...(design ? { "2026-01-01-x/design.md": { text: doc(design) } } : {}),
				...(fm ? feature("2026-01-01-x", fm, tasks) : {}),
			}),
		)[0];
	it("follows the plan status, else the design status", () => {
		assert.equal(stage(of("", [], "status: draft")), "design-draft");
		assert.equal(stage(of("", [], "status: approved")), "design-approved");
		assert.equal(stage(of("status: draft")), "plan-draft");
		assert.equal(stage(of("status: approved")), "approved");
		assert.equal(stage(of("status: in-review")), "in-review");
	});
	it("is reviewing once every task is complete during implementation", () => {
		assert.equal(stage(of("status: implementing", [["a", 1, 2]])), "implementing");
		assert.equal(stage(of("status: implementing", [["a", 2, 2]])), "reviewing");
	});
});

describe("pickCurrent", () => {
	const features = listFeatures(
		repo({
			"2026-01-01-a/plan.md": { text: doc("status: implementing\nbranch: feat/a"), age: 50 },
			"2026-01-02-b/plan.md": { text: doc("status: draft"), age: 10 },
			"2026-01-03-c/plan.md": { text: doc("status: shipped\nbranch: feat/c"), age: 1 },
		}),
	);
	it("prefers the feature whose plan names the branch", () => {
		assert.equal(pickCurrent(features, "feat/a")?.slug, "2026-01-01-a");
	});
	it("falls back to the most recent unshipped feature", () => {
		assert.equal(pickCurrent(features, "main")?.slug, "2026-01-02-b");
	});
	it("still shows a shipped feature when its branch is checked out", () => {
		assert.equal(pickCurrent(features, "feat/c")?.slug, "2026-01-03-c");
	});
	it("returns nothing when everything is shipped", () => {
		assert.equal(pickCurrent(features.filter((f) => f.planStatus === "shipped"), "main"), undefined);
	});
});

describe("formatting", () => {
	const [implementing, approved, review, mr] = listFeatures(
		repo({
			...feature("2026-01-01-csv", "status: implementing", [["CSV encoder", 2, 2], ["Export button", 1, 3], ["c", 0, 2], ["d", 0, 2]], [0, 0], 1),
			...feature("2026-01-02-pi", "status: approved", [["a", 0, 2], ["b", 0, 2]], [0, 0], 2),
			...feature("2026-01-03-rv", "status: implementing", [["a", 2, 2]], [0, 0], 3),
			"2026-01-04-mr/plan.md": { text: doc("status: in-review\nmr: https://gitlab.example.com/x/-/merge_requests/123"), age: 4 },
		}),
	);
	it("strips the date from the slug", () => {
		assert.equal(displayName("2026-01-02-csv-export"), "csv-export");
		assert.equal(displayName("no-date"), "no-date");
	});
	it("draws a task progress bar", () => {
		assert.equal(progressBar(0, 8), "▱▱▱▱▱▱▱▱");
		assert.equal(progressBar(3, 8), "▰▰▰▱▱▱▱▱");
		assert.equal(progressBar(5, 5), "▰▰▰▰▰▰▰▰");
		assert.equal(progressBar(0, 0), "");
	});
	it("shows task progress and the current task while implementing", () => {
		assert.equal(statusLine(implementing), "🔨 csv · ▰▰▱▱▱▱▱▱ 1/4 · T2 Export button");
	});
	it("labels the other stages", () => {
		assert.equal(statusLine(approved), "✅ pi · approved · 2 tasks · ready to ship");
		assert.equal(statusLine(review), "🔍 rv · verify & review");
		assert.equal(statusLine(mr), "🚀 mr · MR !123");
	});
	it("shortens merge request URLs", () => {
		assert.equal(mrLabel("https://gitlab.example.com/g/p/-/merge_requests/42"), "!42");
		assert.equal(mrLabel(undefined), undefined);
	});
	it("suggests the next command", () => {
		assert.equal(nextStep(approved, ".relay/2026-01-02-pi"), "/relay-ship .relay/2026-01-02-pi");
		assert.match(nextStep(implementing, ".relay/x"), /^\/relay-ship \.relay\/x/);
	});
});
