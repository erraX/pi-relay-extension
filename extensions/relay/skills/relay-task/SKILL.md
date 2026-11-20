---
name: relay-task
description: Implement one task of an approved relay plan in the current session, by hand instead of through relay-ship's subagents - pick the first unfinished task file (or the one the user names), follow the same implementer rules (failing tests first, tick the steps, commit, leave notes), then stop and name the next command. Use when the user runs /relay-task on a .relay/<feature> directory, normally in a fresh session per task. Not for the verification pass, the review, or the merge request (relay-ship does those), and not for planning (relay-plan).
disable-model-invocation: true
---

# Relay task

Implement **one** task of the plan in `.relay/YYYY-MM-DD-<slug>/` in this
session, then stop. This is the by-hand way of doing what relay-ship does with
a fresh subagent per task: the user opens a session for each task, watches the
work, and can step in.

Both ways leave the same state on disk: ticked steps in the task file,
commits, and `notes.md`. So the user can switch between them at any task
boundary, and relay-ship finishes the feature (verification, review, fixes,
merge request) whoever implemented the tasks.

What keeps this as reliable as the subagents is **one task per session**. A
task started in a context that already holds another task's work, or the
planning conversation, starts with the clutter the task files were split to
keep out.

## 0. Inputs

- Argument: a feature directory or its `plan.md`, optionally followed by a
  task (its number or its file). Without a feature, use the single feature
  under `.relay/` whose plan is `approved` or `implementing`; if there are
  several, ask which.
- `.relay/config.json` is required (`git.base`, `git.branchPrefix`, `verify`).
  If missing, stop and ask the user to run `/relay-init`.
- If this session already wrote this plan or implemented another of its
  tasks, say so in one line and suggest a new session. Go on only if the user
  says to.

## 1. Preflight

Run the checks in `../relay-ship/references/preflight.md`, in order, and stop
with a one-line reason on the first failure.

## 2. Pick the task

List `[FEATURE_DIR]/tasks/`; file-name order is plan order. A task is
unfinished while its file has an unticked step:
`grep -c '^- \[ \]' <task file>` prints something other than `0`.

- No task named: take the first unfinished one.
- A task named: take that one. If an earlier task is unfinished, say which and
  ask before going on; each task builds on the commits of the ones before.
- Nothing unfinished: skip to the report in step 5.

Tell the user in one line which task this session implements.

## 3. Implement

Record `START_SHA=$(git rev-parse HEAD)`.

Your instructions are in `../relay-ship/references/implementer-prompt.md`: the
**Common** block and the **Assignment: task** block. Fill the placeholders
with this feature's absolute paths; `[TASK_PATH]` is the file picked in step
2 and `[BASE_SHA]` comes from the preflight. The verification and fix
assignments in that file are not yours.

The blocks are written for a subagent that cannot talk to anyone. Follow them
as they stand, with two differences because the user is here:

- **Blocked means ask.** Where the prompt says to stop and report
  `Status: blocked`, stop and ask the user instead, with the same evidence:
  the plan or task text quoted, the error, what you tried. When their answer
  changes the plan, record it in `plan.md`'s `## Decisions` as one line ending
  in `(decided during ship)`, so later implementers and the reviewer see it,
  then continue. Apart from the preflight's frontmatter, that is the only
  edit this session makes to `plan.md`.
- **No machine-readable final message.** The `Status:` / `Commits:` /
  `Notes:` lines are for an orchestrator. End with the report in step 5.

## 4. Check the result

The checks relay-ship runs after each subagent, run here on your own work:

- still on the feature branch, and `git status --porcelain --untracked-files=no`
  is empty;
- no unticked step is left in the task file, and
  `git rev-list START_SHA..HEAD` is not empty;
- `git diff --name-only START_SHA..HEAD` contains no path from
  `untracked.txt` and nothing under `.relay/`.

Put right what a check finds before you report. If you cannot, say what is
left instead of reporting the task as done.

## 5. Report and stop

A few lines: the task and its commits, how its Demo was checked (or what a
human still has to look at), anything decided on the way. Then the next step,
one of:

> Task N of M done. Next: start a new session and run `/relay-task .relay/YYYY-MM-DD-<slug>` for Task N+1 (<name>), or `/relay-ship .relay/YYYY-MM-DD-<slug>` to hand the remaining tasks to subagents.

> All M tasks are done. Next: `/relay-ship .relay/YYYY-MM-DD-<slug>` to verify, review, fix, and open the merge request.

Stop there. Do not start the next task, the verification pass, or a review in
this session. If the user asks to carry on here anyway, remind them once why
a new session is better, then do as they say.
