# Preflight

What must hold before any code of a plan is written. relay-ship runs it at the
start of every run, relay-task at the start of every task. Every check is safe
to repeat: on a plan that is already `implementing` it confirms the state
instead of creating it.

`[FEATURE_DIR]` is `.relay/YYYY-MM-DD-<slug>/`. Check in order, and stop with
a one-line reason on the first failure:

1. `status` in the plan frontmatter is `approved`, or `implementing`, which
   means resuming: some tasks may already be done, by relay-ship's subagents
   or by hand with relay-task. Redo nothing that is done.
2. `tasks/` holds one file per row of the Task Overview. A plan written by an
   older relay keeps its tasks inside `plan.md`, as `### Task N:` sections
   under `## Tasks`, and has no `tasks/`: split it before going on. Move each
   section verbatim, ticks included, into `tasks/NN-<task-slug>.md` with its
   heading changed to `# Task N: <name>`, then delete the `## Tasks` section
   from `plan.md`. Change no other wording.
3. No uncommitted changes to tracked files:
   `git status --porcelain --untracked-files=no` is empty. Untracked files do
   not block: other tools and the user leave local files in a repo (design
   tool output, notes, scratch). They are not relay's: nobody stages, edits,
   moves, or deletes them.
4. Branch:
   - `branch:` set in the frontmatter → check it out.
   - Otherwise, if HEAD is on the base branch: `git fetch origin`, then create
     `<git.branchPrefix><slug>` from `git.base` (slug = feature directory name
     without the date prefix).
   - Otherwise ask once: use the current branch or create a new one.
5. Record `BASE_SHA=$(git merge-base <git.base> HEAD)`; every implementer and
   every review uses it.
6. The **pre-existing untracked list**: if `[FEATURE_DIR]/untracked.txt` does
   not exist, write the paths from
   `git status --porcelain --untracked-files=all` into it, one per line (an
   empty file when there are none), and mention the count in one line. When
   resuming, keep the existing file: files a previous attempt left behind are
   not pre-existing. `.relay/` ignores itself and never appears in the list.
7. Write `status: implementing` and `branch:` into the frontmatter.
