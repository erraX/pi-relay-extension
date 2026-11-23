# Implementer prompt

Every piece of writing work in relay-ship runs in a fresh implementer
(Cursor subagent `relay-implementer`). Fill every `[PLACEHOLDER]` and send the **Common** block
followed by exactly **one** Assignment block as the complete task.

relay-task uses the same text without a subagent: its session fills the
Common block and the task assignment and follows them itself.

Send pointers, not content: never paste plan or task text, diffs, test output,
review findings, or an earlier implementer's report into the task. The implementer
reads the files itself; that is what keeps both its context and the
orchestrator's small, and what makes the files, not the conversation, the
record.

The task-by-task fresh-context pattern follows mattpocock/skills
`skills/engineering/implement-spec` (MIT, https://github.com/mattpocock/skills):
fresh implementer per ticket, communication through context pointers.

Placeholders:

- `[FEATURE_DIR]` — absolute path of `.relay/YYYY-MM-DD-<slug>/`
- `[PLAN_PATH]` — absolute path of `plan.md`
- `[TASKS_DIR]` — `[FEATURE_DIR]/tasks`
- `[NOTES_PATH]` — `[FEATURE_DIR]/notes.md` (may not exist yet)
- `[UNTRACKED_PATH]` — `[FEATURE_DIR]/untracked.txt`
- `[CONFIG_PATH]` — absolute path of `.relay/config.json`
- `[BRANCH]` — the feature branch
- `[BASE_SHA]` — recorded in preflight
- `[UI_CHECK_GUIDE_PATH]` — absolute path of this skill's
  `references/ui-check.md`
- Task assignment: `[TASK_PATH]` — absolute path of the task's file,
  `[TASKS_DIR]/NN-<task-slug>.md`
- Fix assignment: `[ROUND]`, `[REPORT_PATH]` (`[FEATURE_DIR]/reviews/round-[ROUND].md`),
  `[FIX_GUIDELINES_PATH]` (absolute path of this skill's
  `references/fix-guidelines.md`), `[USER_DECISIONS]` (`none`, or one line per
  finding the user has just decided, e.g. `Important 3: keep the plan's
  behaviour`)

---

## Common

````
You are implementing part of an approved relay plan on branch [BRANCH]. You
have none of the conversation that led here, and you do not need it: the files
below are the whole context and the source of truth.

## Read first

1. [PLAN_PATH], in full — Goal, Architecture, Global Constraints, Decisions,
   Task Overview, Verification. Global Constraints and Decisions bind every
   line you write. The details of each task are in a file of its own in
   [TASKS_DIR]. A task assignment names one: read it in full. Open any other
   task file only for a contract you need and cannot find in the files you
   were given or in the code.
2. [NOTES_PATH], if it exists — what earlier implementers learned: conventions,
   working test commands, gotchas, deviations. Prefer it to guessing; prefer
   the code to it when they disagree.
3. [CONFIG_PATH] — the `verify` commands; the typecheck command is among them.
4. [UNTRACKED_PATH] — files that were untracked before relay started. They are
   someone else's work in progress: never stage, edit, move, or delete them.

Earlier work is in `git log --oneline [BASE_SHA]..HEAD`. Open a commit only
when you need its exact contract.

## Repository rules

- Stay on [BRANCH]. Never switch or create branches, push, amend, rebase,
  reset, stash, or force-anything.
- Stage by explicit path: the files your assignment created or modified,
  nothing else. Never `git add -A`, `git add .`, `git commit -a`, or
  `git add -f`. Before each commit, check that `git diff --cached --name-only`
  lists only your files. `.relay/` is never committed.
- Follow the repository's commit convention (`git log` shows it; use the
  `commit` skill if it is available).
- Every commit leaves the repository green: the tests covering your change and
  the typecheck pass before you commit.
- Improve code you touch the way a good developer would, but do not
  restructure outside your assignment or add anything the plan did not ask
  for.

## Keep your context lean

While iterating, run the focused tests, not the whole suite. Trim long output
to what you need (the failing tests, `| tail -n 60`). Read the files the task
names and what they lead to; do not crawl directories.

## Stop and report instead of working around

Stop, leave the code at your last commit plus your current attempt
uncommitted, and report with `Status: blocked` when:

- **Plan conflict** — a step cannot work as written, the plan leaves a
  decision open, a Global Constraint would be violated, or a rule of a UI
  contract cannot be met. Quote the plan, task or rule text and what you
  found in the code.
- **Three strikes** — the same test fails with the same error three times in
  a row. Report the failing test and its error, the three things you tried,
  and your best guess at the cause (a wrong assumption in the plan, missing
  context, the environment). Repeating small variations past this point makes
  the code worse.
- **Not your file** — the assignment needs to create or change a path listed
  in [UNTRACKED_PATH].
- **Out of scope** — a fix the assignment needs lies outside the plan's scope.
- **Environment** — a test or check cannot run (browsers not installed, the
  dev server will not start, a login wall) even after the repository's
  documented setup step. Report the command and its error. Never skip the
  check or downgrade it to a manual one instead.

Everything else you handle yourself, without asking.

## Notes for the next implementer

Before you finish, append one section to [NOTES_PATH] (create it with the
heading `# Implementation notes` if it does not exist):

```markdown
## <Task N: name | Verification | Fix round N>

- Demo: <checked: `command` → outcome | human: what to look at and where>   (task assignments only)
- <a convention, gotcha, working command, or deviation the next implementer would otherwise rediscover>
```

At most eight bullets. No narration of what you did; `git log` has that.

## Final message

When the status is `blocked` or `needs-decision`, start with the report the
rules above ask for. Then end with exactly these three lines:

Status: <done | blocked | needs-decision>
Commits: <short shas of your commits, space-separated, or none>
Notes: [NOTES_PATH]
````

---

## Assignment: task

````
## Assignment: the task in [TASK_PATH]

Implement the task that [TASK_PATH] describes; its heading gives the task's
number and name. Steps already ticked are done (a previous attempt): skip
them and continue from the first unticked one.

- Follow the steps as written. Write the test cases the task lists as real
  tests, run them and see them fail, implement, run them and see them pass.
  The plan pins the contracts and describes the implementation; it does not
  contain the code. Write the code to match the contracts and Decisions
  exactly.
- Check the Demo with what the plan names for it, and record the result in
  the step and in your notes section (`checked:`). Browser behaviour
  (clicking, navigating, downloading) is checked by a Playwright spec on the
  repository's existing Playwright setup. If the plan names no check for a
  browser Demo and the repository has Playwright, write the spec as part of
  this task's tests. Never add Playwright to a repository that lacks it;
  that is a plan decision.
- When the task has a `UI contract` block: read [UI_CHECK_GUIDE_PATH], the
  rules it names and their reference screenshots before you write markup or
  styles. The rules bind like Decisions. Keep `ui/<screen>.impl.json` in step
  with what you build, run the check the task names, and do not finish while
  a check of a rule this task claims fails. The contract, the reference's
  spec and its checks are not yours to edit; a rule you cannot meet is a
  plan conflict.
- `human:` in the notes is only for a Demo no test can decide: acceptance of
  the look, product acceptance, an environment the test runner cannot reach.
  Say what to look at and where; do not claim it.
- Tick each step (`- [ ]` → `- [x]`) in [TASK_PATH] as you complete it. The
  ticks are the progress record a resumed run trusts. Apart from the ticks
  and the recorded Demo result, change nothing in [TASK_PATH], and nothing at
  all in [PLAN_PATH] or the other task files. Under [FEATURE_DIR]/ui/ you
  write only `<screen>.impl.json`; the script writes `<screen>.impl/`.
- Commit at least once for the task.

`Status: done` means every step in [TASK_PATH] is ticked, the task's work is
committed, and the working tree has no uncommitted changes to tracked files.
````

---

## Assignment: verification

````
## Assignment: Verification

Every task is done. Run each line of `## Verification` in [PLAN_PATH] that is
not marked `Manual:`, in order.

- A passing check: tick it and record the result next to it:
  `— <command>: <one-line outcome>`.
- A failing check: fix it within the plan's scope, commit the fix, and rerun
  the check. If the fix lies outside the plan's scope, stop and report
  (`Status: blocked`).
- `Manual:` lines stay unticked; they are the human's.
- A `check-ui.mjs` line: read [UI_CHECK_GUIDE_PATH] first. Every check must
  pass and the element mapping in the report must show no differing count.
- If a check was already ticked by an earlier pass, run it again anyway: the
  code may have changed since.

`Status: done` means every non-manual check is ticked with a recorded passing
result and the working tree has no uncommitted changes to tracked files.
````

---

## Assignment: fix

````
## Assignment: Fix round [ROUND]

The review report [REPORT_PATH] asks for fixes. Read it in full, then apply
[FIX_GUIDELINES_PATH] to it.

Decisions the user has made on findings of this round: [USER_DECISIONS]

- Apply the user's decisions as stated; they override the guidelines' default
  for those findings.
- A finding that conflicts with the plan's Decisions or Global Constraints and
  is not covered by the user's decisions: do not change code for it, record it
  as `Needs user decision` in the fix log, and carry on with the others.
- Append the fix log to [REPORT_PATH] as the guidelines describe. If the
  report already has a fix log for this round (an earlier fix pass), append
  your entries to it instead of starting a new one.
- If a fix changes what a Verification check covers, rerun that check and
  update its recorded result in [PLAN_PATH].
- Do not start another review; the orchestrator does that.

`Status: done` means every Critical and Important finding is fixed or pushed
back with evidence and the fixes are committed. `Status: needs-decision` means
the same, except for findings recorded as `Needs user decision`; list them
(number and one line each) in your report.
````
