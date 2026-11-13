---
name: relay-ship
description: Execute an approved relay plan end to end without check-ins - implement task by task with commits, get a fresh-context code review, fix Critical and Important findings, re-review (bounded rounds), run the verification commands, and open a draft merge request. Use when the user runs /relay-ship on a .relay/<feature> directory whose plan.md is approved. Not for planning (relay-plan) and not for reviewing arbitrary branches.
disable-model-invocation: true
---

# Relay ship

Take `.relay/YYYY-MM-DD-<slug>/plan.md` from `status: approved` to an open
draft merge request. The user has already reviewed the plan; from here they
expect to come back to an MR and a review report, not to questions. The only
reasons to stop are listed under "Stop conditions"; "should I continue?" is
never one of them.

Review is done by a fresh subagent on purpose: a reviewer that watched the
code being written shares its blind spots. Invoking this skill authorizes one
fresh reviewer subagent per review round and nothing else.

## 0. Inputs

- Argument: a feature directory or its `plan.md`. Without an argument, use the
  single feature directory under `.relay/` whose plan is `approved`; if there
  are several, ask which.
- `.relay/config.json` is required (`git.base`, `git.branchPrefix`, `verify`,
  `review.maxRounds`, `models`). If missing, stop and ask the user to run
  `/relay-init`.
- Read the whole plan once. Note Global Constraints and Decisions; they bind
  every task.

## 1. Preflight

Check, in order, and stop with a one-line reason on the first failure:

1. `status` in the plan frontmatter is `approved` (or `implementing`, which
   means resuming: skip to the first unticked step and do not redo ticked
   ones).
2. No uncommitted changes to tracked files:
   `git status --porcelain --untracked-files=no` is empty. Untracked files do
   not block: other tools and the user leave local files in a repo (design
   tool output, notes, scratch). Record them once with
   `git status --porcelain --untracked-files=all` as the **pre-existing
   untracked list** and mention the count in one line. They are not yours:
   never stage, edit, move, or delete them. `.relay/` ignores itself and does
   not appear at all.
3. Branch:
   - `branch:` set in the frontmatter → check it out.
   - Otherwise, if HEAD is on the base branch: `git fetch origin`, then create
     `<git.branchPrefix><slug>` from `git.base` (slug = feature directory name
     without the date prefix).
   - Otherwise ask once: use the current branch or create a new one.
4. Record `BASE_SHA=$(git merge-base <git.base> HEAD)`; every review uses it.
5. Write `status: implementing` and `branch:` into the frontmatter.

## 2. Implement

Work through the tasks in order. Each task is a vertical slice that ends in
something demoable (its `**Demo:**` line). For each task:

- Follow the steps as written: write the test cases the task lists as real
  tests, run them and see them fail, implement, run them and see them pass.
  The plan describes the implementation and pins the contracts; it does not
  contain the code, so write it to match the contracts and decisions exactly.
  While iterating, run the focused tests, not the whole suite.
- Before committing, run the task's tests and the typecheck (the typecheck
  command from `verify` in the config, if there is one). Both must pass, so
  every commit leaves the repository green.
- Check the Demo when a command or a test can show it, and note the result in
  the step. A Demo only a human can check (a visual, an interaction) is left
  for the hand-over list; do not claim it.
- Tick each step (`- [ ]` → `- [x]`) in `plan.md` as you complete it. The
  plan is the progress record; a session that resumes after compaction trusts
  the ticks and `git log`, not memory.
- One commit per task at least, following the repository's commit convention
  (the `commit` skill if available).
- Stage by explicit path: the files this task created or modified, nothing
  else. Never `git add -A`, `git add .`, `git commit -a`, or `git add -f`;
  they sweep in the pre-existing untracked files and anything else that
  happens to be lying around. Before each commit, check `git diff --cached
  --name-only` contains only this task's files. `.relay/` is never committed.
- If a task needs to create or change a path on the pre-existing untracked
  list, stop and ask: it is someone else's work in progress.
- Stay inside the task. Improve code you touch the way a good developer
  would, but do not restructure outside the task or add anything the plan did
  not ask for.

When something does not fit the plan — a step that cannot work as written, a
decision the plan did not make, a Global Constraint it would violate — do not
improvise around it. Stop, quote the plan text and what you found, and ask.
Plan conflicts are the user's decision.

**Three strikes.** When the same test fails with the same error three times in
a row, stop working on it. Repeating small variations past that point is the
most common way an implementation burns an hour and makes the code worse.
Report instead: the task, the failing test and its error, the three things you
tried, and your best guess at the cause (a wrong assumption in the plan, a
missing piece of context, an environment problem). Leave the code at the last
commit plus your current attempt uncommitted, and wait for the user.

After the last task, run every non-manual line of `## Verification`. Tick the
ones that pass and record the result next to them (command, one-line
outcome). A failing check is fixed within the plan's scope before moving on;
if it cannot be, stop and report. `Manual:` lines stay unticked.

## 3. Review

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

## 4. Fix

- `Yes` → go to step 5.
- `With fixes` or `No`, and `N < review.maxRounds` → read the report and
  apply `references/fix-guidelines.md`: verify each Critical and Important
  finding against the code, fix the correct ones one at a time with covering
  tests, push back with evidence on the wrong ones, ask the user on findings
  that conflict with the plan, defer Minor ones, and append the fix log to the
  round's report. Then run round `N + 1`.
- Not `Yes` after `review.maxRounds` rounds → stop. Leave `status:
  implementing`, do not open a merge request, and report the review paths and
  the open findings. The user decides how to proceed.

## 5. Verify and open the merge request

1. Run every `verify` command from the config once more; all must pass.
   Re-tick the Verification section if anything changed.
2. `git push -u origin <branch>`.
3. Open a **draft** merge request with the `mr-create` skill if one is
   available, otherwise with `glab mr create --draft` (or `gh pr create
   --draft` on GitHub). Besides the normal summary, include a short relay section in the description:
   review rounds and final verdict, deferred Minor findings, and the
   `Manual:` verification items still open.
4. Write `mr: <url>` and `status: in-review` into the plan frontmatter.

Never merge, never force-push, never mark the MR ready; those are the user's
calls.

## 6. Hand over

Report in a few lines:

- MR URL and branch
- Review: rounds, final verdict, report paths
- Verification: what passed; the manual items waiting for the user
- Demos only a human can check, one line each (task and what to look at)
- Anything deferred or pushed back that the user should look at

## Stop conditions

Stop and report (do not work around) when: the plan is not approved or the
config is missing; tracked files have uncommitted changes; a task touches a
pre-existing untracked file; the same test fails with the same error three
times; a task or finding conflicts with the
plan; verification fails and the fix is outside the plan's scope; the review
is not `Yes` after the last allowed round; opening the merge request fails. Everything
else is handled without asking.
