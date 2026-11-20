---
name: relay-ship
description: Execute an approved relay plan end to end without check-ins - orchestrate a fresh-context implementer subagent per task, a verification pass, a fresh-context code review, fix passes for Critical and Important findings with re-review (bounded rounds), and open a draft merge request. Use when the user runs /relay-ship on a .relay/<feature> directory whose plan.md is approved, also to finish a plan whose tasks were implemented by hand with relay-task. Not for planning (relay-plan), not for implementing a single task in the current session (relay-task), and not for reviewing arbitrary branches.
disable-model-invocation: true
---

# Relay ship

Take the plan in `.relay/YYYY-MM-DD-<slug>/` (`plan.md` plus one file per task
in `tasks/`) from `status: approved` to an open draft merge request. The user has approved the plan; from here they
expect to come back to an MR and a review report, not to questions. The only
reasons to stop are listed under "Stop conditions"; "should I continue?" is
never one of them.

**This session orchestrates; it does not write code.** Every piece of writing
work runs in a fresh implementer subagent: one per task, one for the
verification pass, one per fix pass. Every review runs in a fresh reviewer
subagent. The reasons:

- A whole plan implemented in one context degrades: the Global Constraints
  read at the start fade, compaction drops details, and the fix pass runs when
  the context is fullest. Each fresh implementer reads `plan.md`, its own
  task file and the notes file, and works one task in a clean window.
- A reviewer that watched the code being written shares its blind spots.

State moves between them through files, never through the conversation: the
ticks in the task files and in the plan's Verification, `git log`, `notes.md`
and the review reports. Invoking this skill
authorizes these subagents, run one at a time, and nothing else.

Because the state is on disk, the user can also implement tasks by hand, one
per session, with `/relay-task`, and switch at any task boundary. A plan that
arrives here with some or all tasks already ticked is a normal resume: this
skill does the rest.

## 0. Inputs

- Argument: a feature directory or its `plan.md`. Without an argument, use the
  single feature directory under `.relay/` whose plan is `approved` or
  `implementing`; if there are several, ask which.
- `.relay/config.json` is required (`git.base`, `git.branchPrefix`, `verify`,
  `review.maxRounds`, `models`). If missing, stop and ask the user to run
  `/relay-init`.
- Read `plan.md`: frontmatter, Goal, Task Overview, Verification. List
  `tasks/` for the task files (`NN-<task-slug>.md`; file-name order is plan
  order) but do not open them: the task details are for the implementers, not
  for this session. Whether a task is done is a grep, not a read:
  `grep -c '^- \[ \]' <task file>` prints `0` when no step is left unticked.

## 1. Preflight

Run the checks in `references/preflight.md`, in order, and stop with a
one-line reason on the first failure. They are shared with relay-task.

When the plan was already `implementing`, this run resumes: continue at the
first task file with an unticked step, or at the first phase below that is
not done, and redo nothing that is.

## 2. Dispatching an implementer

Every implementer runs the same way:

1. Record `START_SHA=$(git rev-parse HEAD)`.
2. Fill `references/implementer-prompt.md`: its Common block plus exactly one
   Assignment block (task, verification, or fix), with absolute paths.
3. Dispatch it with the filled prompt as its whole task. With pi-subagents:
   `subagent({ agent: "relay-implementer", task: <prompt> })`, adding
   `model: <models.implementer>` when the config sets one. On another runtime,
   use its fresh subagent with write tools and the same prompt. If no subagent
   mechanism exists, say so and stop; implementing the plan in this session is
   what this skill exists to avoid. The user can still implement the tasks
   one per session with `/relay-task`.
4. Wait for it to finish. One subagent at a time; do not touch the working
   tree, the index, or the branch while it runs.
5. Read its final message: the `Status:` / `Commits:` / `Notes:` lines, plus
   the report above them when the status is not `done`. Do not pull its diff,
   test output, or the notes into this session; they would undo the point of
   the fresh context.

On `Status: done`, check the result cheaply before moving on:

- still on the feature branch, and `git status --porcelain --untracked-files=no`
  is empty;
- for a task: every step in its task file is ticked, and
  `git rev-list START_SHA..HEAD` is not empty;
- for the verification pass: every non-manual Verification line is ticked;
- `git diff --name-only START_SHA..HEAD` contains no path from
  `untracked.txt` and nothing under `.relay/`.

If a check fails, dispatch one fresh implementer for the same assignment, with
one added line at the end of the task saying what was missing. If the second
attempt fails the same check, stop and report.

On `Status: blocked`: stop and relay its report to the user, keeping the plan
quotes and the error text intact. When the user has decided, record the
decision in the plan's `## Decisions` as one line ending in
`(decided during ship)`, so later implementers and the reviewer see it, and
dispatch a fresh implementer for the same assignment. The previous attempt's
uncommitted changes stay in the tree only if the user says to keep them;
otherwise ask the user to discard them first (the preflight's clean-tree
check applies again).

## 3. Implement

For each file in `tasks/`, in file-name order, that still has an unticked
step, dispatch an implementer with the **task** assignment and that file as
`[TASK_PATH]`. Tasks run strictly one after another; each builds on the
commits of the ones before.

## 4. Verify

After the last task, dispatch an implementer with the **verification**
assignment. It runs every non-manual line of `## Verification`, ticks and
records the passing ones, and fixes failures within the plan's scope.

## 5. Review

Each round `N` (starting at 1):

1. Record `HEAD_SHA=$(git rev-parse HEAD)`. Create `reviews/` in the feature
   directory if needed.
2. Fill `references/reviewer-prompt.md` with the absolute paths, shas, round
   number, report path `reviews/round-N.md`, and the previous round's report
   (or `none`).
3. Dispatch a fresh reviewer with the filled prompt as its whole task. With
   pi-subagents: `subagent({ agent: "relay-reviewer", task: <prompt> })`,
   adding `model: <models.reviewer>` when the config sets one. On another
   runtime, use its fresh, read-only subagent with the same prompt. If no
   subagent mechanism exists, say so and stop; a self-review is not what the
   user asked for.
4. Wait for the reviewer's completion. Do not change the branch while it
   runs. Its final message carries `Ready to merge: Yes | No | With fixes`,
   the report path, and the counts.

## 6. Fix

- `Yes` → go to step 7.
- `With fixes` or `No`, and `N < review.maxRounds` → dispatch an implementer
  with the **fix** assignment for round `N` (`[USER_DECISIONS]` = `none`).
  - `Status: needs-decision` → ask the user about each listed finding, one
    message with all of them, quoting the finding and the plan text it
    conflicts with. Record each answer that changes the plan in `## Decisions`
    with `(decided during ship)`, then dispatch one more fix implementer for
    the same round with the answers as `[USER_DECISIONS]`.
  - Then run review round `N + 1`.
- Not `Yes` after `review.maxRounds` rounds → stop. Leave `status:
  implementing`, do not open a merge request, and report the review paths and
  the open findings. The user decides how to proceed.

## 7. Verify and open the merge request

1. Run every `verify` command from the config once more, keeping only the
   tail of each output (`| tail -n 30`). If one fails, dispatch the
   verification assignment once; if the commands still fail, stop and report.
2. `git push -u origin <branch>`.
3. Open a **draft** merge request with the `mr-create` skill if one is
   available, otherwise with `glab mr create --draft` (or `gh pr create
   --draft` on GitHub). Besides the normal summary, include a short relay
   section in the description: review rounds and final verdict, deferred
   Minor findings, the `Manual:` verification items still open, and the
   demos only a human can check (the `human:` lines in `notes.md`). Any
   diagram in the description is a Mermaid block following
   `../relay-design/references/diagrams.md`, never ASCII art.
4. Write `mr: <url>` and `status: in-review` into the plan frontmatter.

Never merge, never force-push, never mark the MR ready; those are the user's
calls.

## 8. Hand over

Report in a few lines:

- MR URL and branch
- Review: rounds, final verdict, report paths
- Verification: what passed; the manual items waiting for the user
- Demos only a human can check, one line each, from the `human:` lines in
  `notes.md` (task and what to look at)
- Anything deferred, pushed back, or decided during ship that the user should
  look at

## Stop conditions

Stop and report (do not work around) when: the plan is not approved or the
config is missing; tracked files have uncommitted changes; no subagent
mechanism exists; an implementer reports `blocked` (plan conflict, three
strikes on the same failing test, a pre-existing untracked file in the way,
a fix outside the plan's scope, a check the environment will not let run); an implementer's result fails the checks
twice; the review is not `Yes` after the last allowed round; opening the merge
request fails. Review findings that need a user decision are not a stop: ask
them in one message, wait for the answers, and continue the run. Everything
else is handled without asking.
