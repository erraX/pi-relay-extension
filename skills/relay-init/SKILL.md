---
name: relay-init
description: Set up the relay workflow in the current git repository. Creates a self-ignoring .relay/ directory and a config.json with the base branch, verification commands, branch prefix, review rounds, and per-role models. Use when the user runs /relay-init, asks to "set up relay" in a repo, or when another relay skill reports that .relay/config.json is missing. Safe to re-run; it shows the current values and lets the user change them.
disable-model-invocation: true
---

# Relay init

Relay keeps all of its artifacts (designs, plans, review reports, config) in a
`.relay/` directory at the repository root. The directory ignores itself with a
`.gitignore` containing `*`, so it never shows up in `git status`, is never
committed by `git add -A`, and nothing tracked by the repository is modified.
This matters because relay is a personal workflow: shared repositories must not
see it, and the repository's own `.gitignore` is never touched.

Your job here is to detect as much as possible, ask only for what cannot be
detected, and write two files. Keep the whole thing short.

## 1. Preconditions

- Confirm you are inside a git repository: `git rev-parse --show-toplevel`.
  Everything below is relative to that root.
- Check tools and report missing ones without installing anything:
  `glab` or `gh` (relay-ship opens the draft merge request with whichever
  the repository uses). A missing client does not block init.
- If `.relay/config.json` already exists, read it: its values become the
  defaults for every question below, and you tell the user you are updating an
  existing config.

## 2. Detect

Run these read-only checks and keep the results as proposed defaults:

| Setting | How to detect |
|---|---|
| `git.base` | `git symbolic-ref --short refs/remotes/origin/HEAD` (strip to `origin/<branch>`). Fall back to `origin/main` or `origin/master`, whichever exists in `git branch -r`. |
| `verify` | Scripts in `package.json` named `typecheck`, `lint`, `test` (in that order, as `npm run <name>` or the repo's package manager), then the end-to-end command when the repo has Playwright (a `test:e2e`/`e2e` script, else `npx playwright test` when a `playwright.config.*` exists); otherwise Makefile targets `test`/`check`; otherwise `pytest`, `go test ./...`, `cargo test` when the matching project file exists. Propose only commands that actually exist. |
| `git.branchPrefix` | Keep the current config value, else `feat/`. |

Load the remaining defaults from `assets/defaults.json` in this skill's
directory.

## 3. Ask

One question per message, each with the proposed default so the user can
accept it with a short reply. Do not ask about things that have only one
sensible answer.

1. **Base branch and verification commands** — show the detected `git.base`
   and the `verify` list; ask whether to keep, change, or add commands. The
   verify commands are what relay-ship runs before opening a merge request and
   what the reviewer treats as evidence, so they should be the real gate for
   this repo, not a subset.
2. **Models** — `models.reviewer` runs the fresh-context code review in
   relay-ship and deserves the strongest model the user wants on that pass;
   `models.implementer` runs the fresh implementer subagents relay-ship
   dispatches for each task, the verification pass and the fix passes.
   `null` means the subagent inherits the session's model. A value is a
   Cursor model id the Task tool accepts. Show the current values and accept
   the user's answer. If a later dispatch rejects the id, relay-ship omits it
   and says so.
3. **Review rounds** — only if the user seems to want it; otherwise keep
   `review.maxRounds` at 2 and mention it in the summary. Two rounds means one
   review, one fix pass, one re-review; more rounds rarely converge and cost a
   lot.

## 4. Write

Create the directory and both files. Use the file-writing tools, not shell
redirection.

- `.relay/.gitignore` containing exactly:

  ```
  *
  ```

- `.relay/config.json` with this shape and the answers from above:

  ```json
  {
    "git": { "base": "origin/master", "branchPrefix": "feat/" },
    "verify": ["npm run typecheck", "npm test"],
    "review": { "maxRounds": 2 },
    "models": { "implementer": null, "reviewer": null }
  }
  ```

Never create or modify the repository's `.gitignore`, `.git/info/exclude`, or
global git configuration for this.

## 5. Report

Print the final config, then the two caveats of the self-ignoring directory
and the next step:

- `git clean -fdx` deletes `.relay/` (ignored files are fair game for it).
  Plans can be reconstructed from the branch and the conversation, but mention
  it once.
- `git add -f .relay/...` would bypass the ignore; relay skills never force-add.
- Next: `/relay-design <topic>` for a feature whose design is still open, or
  `/relay-plan <topic>` when the direction is already clear.
