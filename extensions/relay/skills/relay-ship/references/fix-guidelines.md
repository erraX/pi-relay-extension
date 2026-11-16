# Fix guidelines

How to act on a review report. Forked from obra/superpowers
`skills/receiving-code-review` (MIT, https://github.com/obra/superpowers), reduced to what the fix
pass in relay-ship needs. The fix pass runs in a fresh implementer subagent;
the orchestrating session asks the user and starts the next review round.

Core principle: verify before implementing. The reviewer is an independent
expert without full context; its findings are suggestions to evaluate, not
orders to follow, and also not to be waved away.

## 1. Read everything first

Read the whole report before changing anything. Findings are often related; a
partial understanding produces the wrong fix. If a finding is unclear and the
code does not clarify it, say so in the fix log and leave it for the user
instead of guessing.

## 2. Verify each Critical and Important finding

For each one, check against the codebase before touching it:

- Is it technically correct for this codebase and this stack?
- Would the suggested fix break existing behaviour, a platform, a version?
- Is there a reason the code is the way it is (compatibility, a documented
  decision, an existing pattern)?
- Does the reviewer have the context it needed, or did it miss a call site, a
  test, a constraint in the plan?

Outcomes:

- **Correct**: fix it.
- **Wrong, with evidence**: do not change the code. Record the pushback with
  the evidence (file:line, test, documented decision) in the fix log. Technical
  reasoning, not defensiveness.
- **Conflicts with the plan's Decisions or Global Constraints**: the user
  decides which governs. Unless the task already carries the user's decision
  for it, do not change the code; record it as `Needs user decision` in the
  fix log, quoting the finding and the plan text, and report it. Do not pick
  silently in either direction.
- **Cannot verify** without something you do not have: say so and leave it to
  the user.

If the reviewer suggests "implementing properly" something nothing uses, check
usage first; unused code is removed, not improved (YAGNI).

## 3. Fix in order, one at a time

1. Blocking issues: breakage, security, data loss.
2. Simple fixes: typos, imports, obvious one-liners.
3. Complex fixes: logic, refactoring.

After each fix, run the tests that cover the changed code. Run the full
`verify` commands once when all fixes are in, not after every edit. Commit
fixes in small, well-named commits; do not amend or rewrite the reviewed
history. Stage only the files the fix changed, by explicit path, exactly as
during implementation (no `git add -A`, `git add .`, or `git commit -a`).

## 4. Minor findings

Do not fix Minor findings during the fix pass unless the fix is trivial, safe,
and in a file you are already changing. List the rest in the fix log so the
merge request description can carry them for triage; a Minor finding nobody
sees again is a silent discard.

## 5. Record the fix log

Append to the current round's report (`reviews/round-N.md`):

```markdown
## Fixes (round N)

- Critical 1: Fixed — <commit sha> — <one line>
- Important 1: Fixed — <commit sha> — <one line>
- Important 2: Pushed back — <evidence>
- Important 3: Needs user decision — conflicts with Decisions: "<quote>"
- Minor: deferred — 1, 3; fixed in passing — 2

Tests: `<command>` — <result summary>
```

State facts. No gratitude, no "you're absolutely right"; the code and the log
show the feedback was heard.

## 6. Re-review

Do not start it yourself. The orchestrator runs the next review round on the
updated range: same base, new head, previous report set to this round's file.
The next reviewer confirms each previous Critical and Important finding is
resolved and reviews the whole range again.
