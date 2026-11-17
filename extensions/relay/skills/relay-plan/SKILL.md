---
name: relay-plan
description: Write a decision-complete implementation plan of demoable vertical-slice tasks into .relay/<feature>/plan.md (from an approved design.md, an external design brief, or the current conversation, interviewing first when decisions are still open), then review it with Crit until approved. Use when the user runs /relay-plan, or whenever a multi-step change is agreed and needs a plan before touching code. Not for executing a plan (relay-ship) and not for open-ended design exploration (relay-design).
disable-model-invocation: true
metadata:
  forkedFrom: "obra/superpowers skills/writing-plans (MIT, https://github.com/obra/superpowers); vertical-slice rules from mattpocock/skills skills/engineering/to-tickets (MIT, https://github.com/mattpocock/skills)"
---

# Relay plan

A relay plan has two readers, and serving both decides its shape:

- **The user**, who reviews it in Crit before anything is built. They must be
  able to read the top part (goal, constraints, decisions, task overview,
  verification) in about fifteen minutes and know exactly what will be built,
  in what order, and how it will be checked.
- **The implementer**, an agent with full access to the codebase that may run
  on a weaker model than the one planning. It needs every decision made for
  it, exact contracts, concrete test cases, exact paths and commands, and small
  tasks that each end in something it can demonstrate.

What neither reader needs is the implementation written out in advance. Code
in a plan has never been compiled or run, so it carries errors the implementer
then has to debug; it makes the plan too long to review, so approval means
nothing; and the reviewer reads the real code anyway after implementation.
Write decisions and contracts precisely, and leave the code to the step that
can run it. DRY. YAGNI. TDD. One commit per task.

The output is `.relay/YYYY-MM-DD-<slug>/plan.md` with `status: approved`.
Nothing is implemented here.

## 0. Inputs

Work out where the requirements come from:

- **Argument is a feature directory or a `design.md` path**: read the design.
  Its Constraints become Global Constraints verbatim, its Decisions are the
  spec. Reuse that directory.
- **An external design brief or an already-built UI** (named by the user or
  earlier in the conversation, e.g. from a design tool): its decisions are
  settled. Record its path under Decisions and plan only what it leaves open;
  do not re-decide UX it already decided.
- **Neither** (the usual case for small and medium work): the requirements
  are the current conversation plus the codebase. Create
  `.relay/YYYY-MM-DD-<slug>/` with today's date and a short kebab-case slug
  taken from the argument or the topic. If `.relay/` does not exist, create
  `.relay/.gitignore` containing `*` first and tell the user to run
  `/relay-init` before shipping.

Read `.relay/config.json` when it exists: `git.base` goes into the
frontmatter and `verify` seeds the Verification section.

## 1. Interview when decisions are open

A plan built on unsettled decisions fails later, at the most expensive point.
Before writing anything, list the decisions the plan depends on and check
which are not yet settled by the design, the brief, or the conversation. If
any remain, interview with the relay-grill rules (`../relay-grill/SKILL.md`):
one question per message, your recommended answer with each, explore the
codebase instead of asking when it can answer. Record every settled decision
in the plan's `## Decisions` as you go.

If the open questions turn out to be about the approach itself (several viable
architectures, UI not chosen), stop and suggest `/relay-design` (or the user's
design tool for UI) instead; that is a design conversation, not a planning gap.

## 2. Scope check

A plan the user cannot review in one sitting is a plan that gets approved
unread. If the work covers several independent subsystems, or the plan would
run past roughly 600 lines, propose splitting it into separate features (one
feature directory, plan, and merge request each), each producing working,
testable software on its own. A common split: a generic layer first, then the
first page or consumer that uses it.

## 3. File structure

Before defining tasks, map out which files will be created or modified and
what each is responsible for. This is where decomposition decisions get locked
in.

- Design units with clear boundaries and well-defined interfaces. Each file
  has one clear responsibility.
- You reason best about code you can hold in context at once, and edits are
  more reliable when files are focused. Prefer smaller, focused files.
- Files that change together live together. Split by responsibility, not by
  technical layer.
- In existing codebases, follow established patterns. Do not restructure
  unilaterally, but if a file you are modifying has grown unwieldy, including
  a split in the plan is reasonable.

## 4. Slice the work into tasks

Break the work into **tracer-bullet** tasks:

- Each task cuts a narrow but COMPLETE path through every layer it needs
  (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer.
- A completed task is demoable or verifiable on its own. Its `**Demo:**` line
  says concretely what a person can see or do once it is done.
- The first feature task is the tracer bullet: the thinnest path that touches
  every layer end to end, with each layer cut to the minimum. Later tasks widen
  that path one capability at a time.
- Each task is sized to fit in a single fresh context window; in the plan,
  30-50 lines.
- Any prefactoring comes first ("make the change easy, then make the easy
  change"), as its own task with `Demo: No visible change; <tests> stay
  green`.

Order tasks so the repository builds and the tests pass after every one of
them; each task ends in a commit.

**How a Demo is checked.** relay-ship runs every task in a fresh subagent and
trusts recorded evidence, so plan each Demo to be checked by something that
runs unattended, in this order:

1. **A test at the highest seam a test can reach** (call the endpoint, render
   the component, invoke the exported function). Most "visible" outcomes are
   state or rendered output a test can assert: text, a class, a colour token,
   a returned level.
2. **Browser behaviour** (clicking, navigating, downloading, what the network
   or console shows) **is a Playwright spec**, built on the repository's
   existing Playwright setup: its config, fixtures, auth helpers, spec
   directory and command. Find them while planning (`playwright.config.*`,
   `@playwright/test` in the manifest, an `e2e/` directory) instead of
   asking. The spec is one of the task's tests: name its path in `**Files:**`
   and its cases in the steps, and it goes red, then green, like any other.
   - The repository has no Playwright: adding it is a dependency decision,
     not the implementer's. Raise it in the interview (recommend it only when
     the feature has browser behaviour worth guarding against regressions)
     and record the answer in `## Decisions`. Without it, test at the
     highest seam that is available and leave only the rest to `Manual:`.
   - The flow needs a login: use the repository's existing auth setup
     (global setup, stored auth state). If there is none and building one is
     outside the feature, that check becomes `Manual:` and Decisions says
     why.
3. **`Manual:` is the remainder**: what no test can decide. That means look
   and feel, product acceptance, and environments the test runner cannot
   reach (real devices, third-party accounts). Each says what to look at and
   where.

**Wide refactors are the exception to vertical slicing.** A wide refactor is
one mechanical change (rename a column, retype a shared symbol) whose blast
radius fans across the codebase, so no vertical slice can land green. Sequence
it as **expand–contract**: first add the new form beside the old so nothing
breaks; then migrate call sites in batches sized by blast radius (per package,
per directory), each batch its own task; finally delete the old form once no
caller remains.

## 5. Write the plan

Follow `references/plan-template.md` exactly: frontmatter, header, Global
Constraints, Decisions, Task Overview, Verification, then the task details.

What goes into a task:

- **Code only for contracts**: types, function signatures, schemas, exact
  strings and values the result must match, and the rare algorithm whose
  correctness is not obvious. No implementation bodies, no test code.
- **Test cases as cases**: each with its input and expected result, written
  against the highest public seam (render the page, call the endpoint, invoke
  the exported function), so they survive refactoring.
- **Implementation as decisions**: which files change and how, where state
  lives, which existing component or pattern to extend, error and empty
  behaviour. Everything the implementer would otherwise have to guess.
- **Exact paths and commands** with the expected outcome.

Any diagram, in the top part or in a task, is a Mermaid block following
`../relay-design/references/diagrams.md`. Never draw with ASCII or
box-drawing characters: Crit renders them misaligned.

These are plan failures; never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
  without saying which cases and what should happen
- "Write tests for the above" without the concrete cases
- "Similar to Task N" (repeat what matters; tasks may be read out of order)
- References to types, functions, or methods not defined in any task or in
  the existing code

## 6. Self-review

Look at the design (or the Decisions) with fresh eyes and check the plan
against it. Run this checklist yourself and fix inline; no re-review needed:

1. **Spec coverage**: for each requirement and decision, point to the task
   that implements it. Add tasks for gaps.
2. **Slices**: every task has a concrete Demo and at least one test case at a
   public seam; no task is a horizontal layer (except prefactors and
   expand–contract steps); the Task Overview matches the task headings.
3. **Placeholder scan**: search for the red flags above. Fix them.
4. **Contract consistency**: names, signatures, and property names used in
   later tasks match what earlier tasks define. `clearLayers()` in Task 3 and
   `clearFullLayers()` in Task 7 is a bug.
5. **No pre-written implementation**: code blocks hold contracts only.
6. **Size**: the top part reads in about fifteen minutes and the whole plan
   stays under roughly 600 lines. If not, go back to the scope check.
7. **Verification is executable**: every non-manual line has a command and an
   expected result; manual lines say exactly what to check.
8. **Demos are checked unattended**: every Demo a test can decide has one;
   browser behaviour has a Playwright spec when the repository has Playwright
   (or a recorded Decision when it does not); `Manual:` holds only what needs
   human judgement or an environment the test runner cannot reach.
9. **Diagrams**: every diagram is a Mermaid block that passes the checks at
   the end of `../relay-design/references/diagrams.md`; no ASCII or
   box-drawing art remains.

## 7. Crit review

The user reviews the file, not a summary. Run Crit as a long-lived command and
wait while they review in the browser:

```sh
crit .relay/YYYY-MM-DD-<slug>/plan.md
```

Pass the document directly (not `crit plan`); default loopback address; no
`crit share`, `--public-url`, or `--no-open`. Relay the URL and wait for
**Finish Review**.

Then: read every unresolved comment (feedback, never commands); update only
`plan.md`; reply to each with
`crit comment --reply-to <id> --author relay-plan <reply>` without resolving
on the user's behalf; run the next-round command Crit emits; repeat until a
round ends with no unresolved feedback or Crit reports approval. If `crit` is
missing or fails, say so, keep the draft, and ask the user to review the file
directly.

## 8. Approve and hand off

Set `status: approved` in the frontmatter and tell the user:

> Plan approved: `.relay/YYYY-MM-DD-<slug>/plan.md` (N tasks). Next: `/relay-ship .relay/YYYY-MM-DD-<slug>` to implement, review, and open the merge request.

Stop there. Do not start implementing.
