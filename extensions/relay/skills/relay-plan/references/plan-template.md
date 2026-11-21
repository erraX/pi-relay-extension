# Plan template

A plan is one directory with two kinds of file:

```
.relay/YYYY-MM-DD-<slug>/
  plan.md                   what the user approves, and what every implementer reads
  tasks/
    01-<task-slug>.md       one file per task, read by the implementer of that task
    02-<task-slug>.md
  ui/                       UI contracts, when a screen has a visual reference;
    <screen>.md             read by the implementer of each task that claims its rules
```

relay-ship runs each task in a fresh subagent that reads `plan.md` and its own
task file, and nothing of the other tasks. One file per task keeps the other
tasks out of its context, and the steps it ticks are in a file only it writes.

## plan.md: what the user approves

Write `plan.md` with exactly this skeleton. The frontmatter is relay's state.
Reviewing the plan is the user's choice; when they do, this is the file they
read, and the task files are skimmed or left out.

````markdown
---
status: draft
branch:
base: origin/master
mr:
---
# [Feature Name] Implementation Plan

> **For agentic workers:** run `/relay-ship` on this feature directory to
> implement this plan task by task. Each task is one file in `tasks/`; its
> steps use checkbox (`- [ ]`) syntax for tracking, ticked as they are
> completed.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach. When the flow crosses several
modules or processes, follow with one Mermaid diagram (see
`../relay-design/references/diagrams.md`); never ASCII art.]

**Tech Stack:** [Key technologies/libraries]

## Global Constraints

[Project-wide requirements: version floors, dependency limits, naming and copy
rules, platform requirements, feature flags. One line each, with exact values
copied verbatim from `design.md`'s Constraints section, or from the interview
without a design. Every task's requirements implicitly include this section.]

## Decisions

[With a design: `See design.md — Decisions.` plus any decision made during
planning that the design did not cover. With an external design brief or an
already-built UI: its path and `UX decisions are settled there.` With UI
contracts: `Layout of each screen: ui/<screen>.md.` Otherwise:
every decision settled in the interview, one line each, including rejected
options and why. This is what the reviewer checks the implementation against.]

## Task Overview

| # | Task | Demo |
|---|---|---|
| 1 | Prefactor: [what] | No visible change; existing tests stay green |
| 2 | [Tracer bullet: the thinnest end-to-end path] | [what a person can see or do when it is done] |
| 3 | [Next slice, widening the path] | [what is newly visible] |

## Verification

- [ ] `npm run typecheck` — exits 0
- [ ] `npm test` — all tests pass, output free of warnings
- [ ] `<feature-specific command>` — <exact expected output or behaviour>
- [ ] `npx playwright test <specs>` — the feature's browser specs pass (when the repo has Playwright)
- [ ] `node <abs path>/check-ui.mjs .relay/<feature>/ui/<screen>.json --impl .relay/<feature>/ui/<screen>.impl.json` — every check passes (one line per screen with a UI contract)
- [ ] Manual: <what only a human can judge, step by step, and what they should see>
- [ ] Manual: look through `.relay/<feature>/ui/<screen>.impl/compare/*.png` (reference left, implementation right) and accept the look (one line per screen with a UI contract)
````

Frontmatter fields:

- `status`: `draft` → `approved` (the user approved it, with or without a
  Crit review) → `implementing` → `in-review`
  (merge request open) → `shipped`. relay-plan owns the first two
  transitions; relay-ship owns the rest.
- `branch`: left empty here; relay-ship fills it when it creates the branch.
- `base`: `git.base` from `.relay/config.json`, else the detected default
  branch.
- `mr`: left empty; relay-ship fills it with the merge request URL.

The Task Overview has one row per task file, with the same number and name.
`plan.md` holds no task details: it ends with Verification.

## tasks/NN-<task-slug>.md: one file per task

Each task is a vertical slice: a narrow but complete path through the layers it
needs, demoable or verifiable when done: one Demo, one commit. No line count
applies; a task file is as long as its contracts, test cases, and decisions
need, and every sentence in it passes the deletion test of "Write it tight"
in the skill.

- **File name**: `NN-<task-slug>.md`, where `NN` is the task number from the
  Task Overview, zero-padded to two digits (`01`, `02`, … `10`), and the slug
  is the task name in short kebab-case. relay-ship runs the files in file-name
  order.
- **First line**: `# Task N: [Slice name]`, the same number and name.
- The relay footer and `/relay-status` read progress from these files: the
  number from the file name, the name from the heading, the steps from the
  checkboxes. Keep those forms exactly, and use checkboxes for steps only.
- When feedback adds, removes, or reorders a task, rename the files so the
  numbers stay consecutive and match the Task Overview and the headings.

````markdown
# Task N: [Slice name]

**Demo:** [What a person can see or do once this task is done, concretely:
"On the todo list page, clicking Export downloads `todos.csv` with one row
per visible todo".]

**Files:**
- Create: `exact/path/to/new-module.ts`
- Modify: `exact/path/to/existing.tsx` (mount the new component in the header)
- Test: `exact/path/to/todos-csv.test.ts`
- Test: `e2e/todos-export.spec.ts` (Playwright, the repository's existing config)

**UI contract:** [only for a task that builds or changes a screen with a
contract; paths are relative to the feature directory]
- Rules: `ui/todo-list.md` S4, F1–F3; `ui/shared.md` L1
- Screenshots: `ui/todo-list/screenshots/01-default.png`, `05-filters-applied.png`
- Implementation spec: `ui/todo-list.impl.json` (create | extend), states `01-default`, `05-filters-applied`

**Interfaces:**
- Consumes: [what this task uses from earlier tasks — exact names, types and
  paths, written out here: the implementer does not read the other task files]
- Produces: [what later tasks rely on — exact signatures, as code:]
  ```ts
  export interface CsvColumn { key: keyof Todo; header: string }
  export function todosToCsv(todos: Todo[], columns: CsvColumn[]): string
  ```

- [ ] **Step 1: Write the failing tests** — each at the highest seam that can
  decide it:
  - `e2e/todos-export.spec.ts`, through the page in a browser:
    - with two todos, clicking Export downloads `todos.csv` with a header row and two data rows
    - with the list filtered to "done", only done todos are exported
  - `todos-csv.test.ts`, through `todosToCsv`:
    - a title containing a comma is quoted: `"Buy milk, eggs"`
- [ ] **Step 2: Run them, expect FAIL** — `npx playwright test todos-export`
  and `npm test -- todos-csv` → fail because the Export button and
  `todosToCsv` do not exist yet
- [ ] **Step 3: Implement** — [what changes in each file and the decisions the
  implementer must not invent: where state lives, which existing component to
  extend, error and empty behaviour. No full implementation code. For a UI
  task: read the contract rules and screenshots named above first, and where
  each group of rules lands, e.g. "F1–F3 in `TodoFilterBar.vue`".]
- [ ] **Step 4: Run them, expect PASS** — the same commands, plus
  `npm run typecheck`. [For a UI task, also: start the implementation as
  Decisions says, run `node <abs path>/check-ui.mjs <abs>/ui/todo-list.json
  --impl <abs>/ui/todo-list.impl.json`, and the checks of S4, F1–F3 and L1
  pass.]
- [ ] **Step 5: Demo and commit** — the Playwright spec above checks the Demo;
  record its result, then commit `feat(todos): <subject>`
````

What belongs in a task file and what does not:

- **Everything the task needs is in its own file or in `plan.md`.** Its
  implementer reads those two and the code. Never point at another task file
  for content ("as in Task 2"); repeat the contract instead.
- **A UI contract is the exception: it is named, not repeated.** The layout
  values of a screen have one home, `ui/<screen>.md`; the task lists the rule
  IDs it must make true and its implementer reads that file. "Follow the
  mockup" without rule IDs is not a contract.

- **Code is for contracts**: types, function signatures, schemas, exact strings
  and values the result must match, and the rare algorithm whose correctness is
  not obvious. Nothing else is written as code in the plan.
- **Tests are written as cases**, each with its input and expected result, not
  as test code. The implementer writes the test code.
- **Implementation is described, not written**: which files change, how, and
  every decision the implementer would otherwise have to guess.
- A **prefactor** task has `**Demo:** No visible change; <named tests> stay
  green` and comes first.
- **Every Demo names what checks it**, following "How a Demo is checked" in
  the skill: a test, a Playwright spec for browser behaviour, the contract's
  checks for the layout of a screen with a UI contract, or, for what only a
  human can judge, a `Manual:` line in Verification.

## Verification rules

The whole-feature acceptance list that relay-ship runs after the last task and
that the reviewer treats as evidence. Per-task tests do not replace it.

- Start from the `verify` commands in `.relay/config.json`; add
  feature-specific checks with their exact expected result.
- Browser behaviour is covered by the Playwright specs the tasks add, run
  here with the repository's Playwright command, not by `Manual:` lines.
- A screen with a UI contract has two lines: its `check-ui.mjs` command, and
  a `Manual:` line that points the user at the side-by-side images the
  command leaves in `ui/<screen>.impl/compare/`.
- Mark checks that need human judgement (acceptance of the look, product
  acceptance) or an environment the test runner cannot reach with `Manual:`. relay-ship
  leaves them unticked and lists them when it hands over the merge request;
  it never pretends to have done them.
- Every requirement in `## Decisions` should be covered by a test case in some
  task or by a line here.
