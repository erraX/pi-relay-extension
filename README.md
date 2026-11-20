# pi-relay-extension

**relay** is a personal SDLC workflow for the [pi](https://pi.dev) coding agent:
idea → design → plan → fresh-context implementation per task → fresh-context review → draft merge request.
The workflow itself is a set of plain Agent Skills; this extension is the shell
around them: slash commands, argument completion, a status card and a progress
footer.

```
🔨 relay csv-export ▰▰▰▱▱▱▱▱ 3/8 · T4 Export button · 6m
```

## Commands

| Command | What it does |
|---|---|
| `/relay-init` | Set up a self-ignoring `.relay/` directory and `config.json` (base branch, verify commands, review rounds, models) in the current repo |
| `/relay-grill [file]` | One-question-at-a-time interview to stress-test an idea or a relay doc; no files by default |
| `/relay-design <topic>` | Idea → approved `design.md` (interview, compared approaches, HTML mockups, Crit review) |
| `/relay-plan <topic \| feature dir>` | Design or conversation → approved `plan.md` plus one file per demoable vertical-slice task under `tasks/`; asks whether to review it in Crit before approving |
| `/relay-ship <feature dir>` | Approved plan → a fresh implementer subagent per task, verification, fresh-context review, fix, open a draft MR |
| `/relay-status` | Every feature under `.relay/` and its next step (rendered locally, never sent to the LLM) |

While a plan is being implemented, the footer shows task progress and turns
yellow/red when no step has been ticked for a while (`⏳ stalled 18m`), and a
two-line task strip sits below the editor:

```
 🔨 csv-export · T4 Export button · step 3/5 · 6m
 ✓T1 ✓T2 ✓T3 ●T4 ○T5 ○T6 ○T7 ○T8   verify 0/4 · 0 reviews
```

`/relay-ship` keeps its own session as a thin orchestrator: every task, the
verification pass and every fix pass run in a fresh `relay-implementer`
subagent, so a long plan never piles up in one context window. Each task has
its own file, so its implementer reads `plan.md` and that one file, not the
other tasks. Implementers hand state to each other through files only: the
ticks in the task files, `git log`, and `notes.md` (conventions and gotchas
the next implementer would otherwise rediscover).

All artifacts (designs, plans, notes, review reports, config) live in `.relay/` at the
repository root. It contains a `.gitignore` with `*`, so nothing relay writes is
ever committed and the repository's own `.gitignore` is never touched.

```
.relay/
  config.json
  2026-01-02-csv-export/
    design.md             optional, from /relay-design
    plan.md               goal, constraints, decisions, task overview, verification
    tasks/
      01-csv-encoder.md   one file per task: demo, files, interfaces, steps to tick
      02-export-button.md
    notes.md              what each implementer leaves for the next
    reviews/round-1.md    review reports and fix logs
```

A plan written before tasks had their own files (`### Task N:` sections
inside `plan.md`) still shows its progress, and `/relay-ship` splits it into
task files before it continues.

## Install

```bash
pi install git:github.com/erraX/pi-relay-extension
```

or try it for one session:

```bash
pi -e git:github.com/erraX/pi-relay-extension
```

## Requirements

- [pi](https://pi.dev)
- [pi-subagents](https://www.npmjs.com/package/pi-subagents) — `/relay-ship`
  dispatches the bundled `relay-implementer` agent for each task and fix pass
  and the `relay-reviewer` agent for each review round (both declared via
  `pi.subagents.agents` in `package.json`).
- Optional: [Crit](https://crit.md/) for reviewing `design.md` in the
  browser, and the plan when you ask for it; without it you review the file
  directly.
- Optional: `glab` (GitLab) or `gh` (GitHub) to open the draft merge request.

## Layout

```
extensions/relay/
  index.ts              commands (forward to the skills), completion, status card, footer, task strip
  features.ts           reads .relay/<feature>/ state: design.md, plan.md, tasks/*.md (pure)
  view.ts               task chips, durations, stall levels (pure)
  *.test.ts             `npm test` (Node ≥ 22.18 for native TypeScript)
  skills/relay-*/       the workflow, plain Agent Skills registered via resources_discover
  agents/relay-implementer.md  fresh-context implementer (one task / verification / fix pass) used by relay-ship
  agents/relay-reviewer.md     fresh-context, read-only reviewer used by relay-ship
```

## Credits

Several skills are adapted from [obra/superpowers](https://github.com/obra/superpowers)
and [mattpocock/skills](https://github.com/mattpocock/skills) (both MIT). See
`LICENSE` and the `forkedFrom` metadata in each skill.

## License

MIT
