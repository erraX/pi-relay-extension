# relay

**relay** is a personal SDLC workflow for Cursor:
idea → design → plan → fresh-context implementation per task (by subagents, or by hand one session per task) → fresh-context review → draft merge request.

This branch is the Cursor plugin. The pi extension stays on `main`.

The workflow itself is a set of Agent Skills, and those skills are the slash entries (`/relay-init`, `/relay-design`, and the rest). `/relay-status` and `/relay-done` are commands, because they only run a local script. The plugin also adds the `relay-implementer` and `relay-reviewer` subagents, and a status line read from disk.

```
🔨 2026-01-02-csv-export  ▰▰▰▱▱▱▱▱ 3/8 · T4 Export button
   ✓T1 ✓T2 ✓T3 ●T4 ○T5 ○T6 ○T7 ○T8   verify 0/4 · 2 manual
   → /relay-ship .relay/2026-01-02-csv-export
```

A new Cursor session is told the open feature whose plan names the current branch (else the most recently touched one). `/relay-status` prints every feature. A shipped feature is left out of that session line, and nothing but `/relay-done` marks a feature shipped: `/relay-ship` stops at `in-review`. To drop a feature that has no plan yet, remove its directory.

## Commands

| Command | What it does |
|---|---|
| `/relay-init` | Set up a self-ignoring `.relay/` directory and `config.json` (base branch, verify commands, review rounds, models) in the current repo |
| `/relay-grill [file]` | One-question-at-a-time interview to stress-test an idea or a relay doc; no files by default |
| `/relay-design <topic>` | Idea → approved `design.md` (interview, compared approaches, HTML mockups, a UI contract per screen that has a visual reference, then a review of the files in the editor) |
| `/relay-plan <topic \| feature dir>` | Design or conversation → approved `plan.md` plus one file per demoable vertical-slice task under `tasks/`; asks whether to review the files in the editor before approving |
| `/relay-ship <feature dir>` | Approved plan → a fresh implementer subagent per task, verification, fresh-context review, fix, open a draft MR |
| `/relay-task <feature dir> [task]` | One task of an approved plan, implemented in the current session; then stops and names the next command |
| `/relay-status` | Every feature under `.relay/` and its next step, printed by `scripts/relay.ts` |
| `/relay-done [feature dir]` | Mark a feature shipped once its merge request is merged (writes `status: shipped` into `plan.md`). Without an argument: the open feature for the current branch |

`/relay-ship` keeps its own session as a thin orchestrator: every task, the verification pass and every fix pass run in a fresh `relay-implementer` subagent, so a long plan never piles up in one context window. Each task has its own file, so its implementer reads `plan.md` and that one file, not the other tasks. Implementers hand state to each other through files only: the ticks in the task files, `git log`, and `notes.md`.

Because that state is on disk, you can also implement tasks by hand: `/relay-task` does the next unfinished task in the current session, under the same rules as the subagents, and you start a new session for each task. The two mix freely at task boundaries. Verification, review, fixes and the merge request are always `/relay-ship`'s. `/relay-task` runs on the session's own model; `models.implementer` in the config applies to the subagents only, and is a Cursor model id (or `null` to inherit the session model).

Design and plan review happen in the editor. The agent names the file paths and waits; you reply with changes or an explicit approval. It does not call an external review app.

All artifacts live in `.relay/` at the repository root. It contains a `.gitignore` with `*`, so nothing relay writes is committed and the repository's own `.gitignore` is never touched.

```
.relay/
  .gitignore              `*`: nothing in here is committed
  config.json
  2026-01-02-csv-export/
    design.md             optional, from /relay-design
    ui/                   optional: one contract per screen that has a visual reference
      todo-list.md        the layout rules the implementation must follow, each with an ID
      todo-list.json      which page, states and elements were measured, and the checks of the rules
      todo-list/          reference screenshots per state, measurements.json
      todo-list.impl.json where the same states and elements are in the implementation
      todo-list.impl/     check report, reference and implementation side by side
    plan.md               goal, constraints, decisions, task overview, verification
    tasks/
      01-csv-encoder.md   one file per task: demo, files, interfaces, steps to tick
      02-export-button.md
    notes.md              what each implementer leaves for the next
    reviews/round-1.md    review reports and fix logs
```

A plan written before tasks had their own files (`### Task N:` sections inside `plan.md`) still shows its progress, and `/relay-ship` splits it into task files before it continues.

`verify` counts the commands in the plan's `## Verification` section, which `/relay-ship` runs and ticks. Its `Manual:` lines are yours to tick, some only after the merge, so they are counted apart.

## Install

Copy this repository into `~/.cursor/plugins/local/relay`, so that `.cursor-plugin/plugin.json` sits directly inside that folder. Cursor skips a symlink whose target lives outside `~/.cursor/plugins/local`. Then run **Developer: Reload Window**.

The skills, `/relay-status`, `/relay-done`, and the two subagents show up under Customize. On a Team or Enterprise account, an admin has to allow local plugin imports; otherwise Cursor ignores the folder.

`/relay-ship` dispatches `relay-implementer` and `relay-reviewer` with the Task tool, one at a time. If those subagent types are missing, it stops.

## Requirements

- Cursor, with this plugin loaded
- Optional: `glab` (GitLab) or `gh` (GitHub) to open the draft merge request
- Optional: Playwright in the repository you work on. `/relay-design` uses it to measure a visual reference (`skills/relay-design/scripts/distill-ui.mjs`) for the UI contract; without it the agent measures with its own browser tool or works from images. The implementer and the verification pass use it to judge the implementation against the contract's checks (`check-ui.mjs`)

## Layout

```
.cursor-plugin/plugin.json
commands/                 /relay-status and /relay-done; the other slash entries are the skills
skills/relay-*/           the workflow
skills/relay-design/scripts/distill-ui.mjs   screenshots and measurements of a visual reference
skills/relay-design/scripts/check-ui.mjs     the contract's checks, side-by-side images
agents/relay-implementer.md   fresh-context implementer (one task / verification / fix pass)
agents/relay-reviewer.md      fresh-context reviewer; writes only the report
hooks/session-status.mjs      one status line at session start
scripts/relay.ts              /relay-status and /relay-done
lib/                          parser behind the status script, with its tests
```

## Credits

Several skills are adapted from [obra/superpowers](https://github.com/obra/superpowers) and [mattpocock/skills](https://github.com/mattpocock/skills) (both MIT). See `LICENSE` and the `forkedFrom` metadata in each skill.

## License

MIT
