# plan.md template

Write `.relay/YYYY-MM-DD-<slug>/plan.md` with exactly this skeleton. The
frontmatter is relay's state. Everything above the `## Tasks` line is what the
user reviews in Crit; the task details below it are for the implementer and
are skimmed in review.

## Top part: what the user reviews

````markdown
---
status: draft
branch:
base: origin/master
mr:
---
# [Feature Name] Implementation Plan

> **For agentic workers:** run `/relay-ship` on this feature directory to
> implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for
> tracking; tick them as you complete them.

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
already-built UI: its path and `UX decisions are settled there.` Otherwise:
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
- [ ] Manual: <what only a human can judge, step by step, and what they should see>

---

## Tasks
````

Frontmatter fields:

- `status`: `draft` → `approved` (after Crit) → `implementing` → `in-review`
  (merge request open) → `shipped`. relay-plan owns the first two
  transitions; relay-ship owns the rest.
- `branch`: left empty here; relay-ship fills it when it creates the branch.
- `base`: `git.base` from `.relay/config.json`, else the detected default
  branch.
- `mr`: left empty; relay-ship fills it with the merge request URL.

The Task Overview has one row per task, in the same order and with the same
numbers as the task headings below. The relay footer and `/relay-status` read
progress from the `### Task N:` headings and their checkboxes, so keep that
heading form exactly.

## Task structure

Each task is a vertical slice: a narrow but complete path through the layers it
needs, demoable or verifiable when done. Aim for 30-50 lines per task.

````markdown
### Task N: [Slice name]

**Demo:** [What a person can see or do once this task is done, concretely:
"On the todo list page, clicking Export downloads `todos.csv` with one row
per visible todo".]

**Files:**
- Create: `exact/path/to/new-module.ts`
- Modify: `exact/path/to/existing.tsx` (mount the new component in the header)
- Test: `exact/path/to/todos-csv.test.ts`
- Test: `e2e/todos-export.spec.ts` (Playwright, the repository's existing config)

**Interfaces:**
- Consumes: [what this task uses from earlier tasks — exact names and types]
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
  extend, error and empty behaviour. No full implementation code.]
- [ ] **Step 4: Run them, expect PASS** — the same commands, plus
  `npm run typecheck`
- [ ] **Step 5: Demo and commit** — the Playwright spec above checks the Demo;
  record its result, then commit `feat(todos): <subject>`
````

What belongs in a task and what does not:

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
  the skill: a test, a Playwright spec for browser behaviour, or, for what
  only a human can judge, a `Manual:` line in Verification.

## Verification rules

The whole-feature acceptance list that relay-ship runs after the last task and
that the reviewer treats as evidence. Per-task tests do not replace it.

- Start from the `verify` commands in `.relay/config.json`; add
  feature-specific checks with their exact expected result.
- Browser behaviour is covered by the Playwright specs the tasks add, run
  here with the repository's Playwright command, not by `Manual:` lines.
- Mark checks that need human judgement (look and feel, product acceptance)
  or an environment the test runner cannot reach with `Manual:`. relay-ship
  leaves them unticked and lists them when it hands over the merge request;
  it never pretends to have done them.
- Every requirement in `## Decisions` should be covered by a test case in some
  task or by a line here.
