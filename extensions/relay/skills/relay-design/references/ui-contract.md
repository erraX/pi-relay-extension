# UI contract

A screen that has a **visual reference** (the mockup chosen in the design, a
prototype or design-tool export the user brought, an existing page to match)
gets a UI contract: the rules of that reference the implementation must
follow, written so each one can be checked.

"The mockup governs the look" is not a spec. The implementer works from its
task file and never opens the reference unless told what to take from it. And
a reference cannot say which of its values matter: its CSS mixes the layout
that was designed (column widths, what sits in one row, where a divider goes)
with styling that only imitates the component library. Told to "use the real
components instead", an implementer drops both, and the screen comes out with
wrapped filters, squeezed columns and unstyled links. The contract is that
selection, made once, by the step that can still ask the user.

A screen without a visual reference needs no contract: the component library's
defaults are its design.

## Files

```
.relay/YYYY-MM-DD-<slug>/ui/
  reference/              a copy of the reference, when it lives outside the worktree
  shared.md               rules that hold on every screen (links, table base, page container)
  <screen>.md             the contract of one screen
  <screen>.json           what to open, which states, which elements, which checks: input of the scripts
  <screen>/
    screenshots/          one image per state
    measurements.json     boxes and computed styles of the named elements
    check-report.md       the checks judged against the reference itself
```

During implementation the same directory gets `<screen>.impl.json` and
`<screen>.impl/` (the implementation measured the same way, the check report
and the side-by-side images); `../../relay-ship/references/ui-check.md`
describes them.

## 1. Make the reference reachable

Everything later in the workflow reads the reference from this worktree: the
implementer of each task, and the reviewer. Open it yourself first.

- A mockup under `mockups/` is already in place.
- A local prototype outside the worktree (another checkout, a temp directory,
  a git-ignored folder that worktrees do not share): copy it to
  `ui/reference/`.
- A URL: it must open without a login. Otherwise save the pages locally, or
  work from images (see "When the reference cannot be run").

## 2. Measure, do not estimate

Numbers read off an image are wrong by just enough to break a layout: 168px
and 192px look the same in a screenshot, and one of them wraps the row. Take
them from the running reference with `scripts/distill-ui.mjs` (in this skill's
directory). Write `ui/<screen>.json`, then run from the repository root:

```sh
node <relay-design skill>/scripts/distill-ui.mjs .relay/YYYY-MM-DD-<slug>/ui/<screen>.json
```

```json
{
  "url": "reference/index.html#/todos",
  "root": "#app",
  "hide": ["#demo-bar"],
  "waitFor": "table",
  "tokenPrefix": "--ds_",
  "states": [
    {
      "name": "01-default",
      "description": "First load, 8 rows",
      "elements": {
        "filterCard": ".filters",
        "filterFields": { "all": ".filters .field" },
        "headerCells": { "all": "thead th" },
        "rowActions": "tbody tr:first-child .actions"
      },
      "crops": { "filters": ".filters" }
    },
    {
      "name": "02-row-menu-open",
      "steps": [{ "click": "tbody tr:nth-child(2) .menu-trigger" }],
      "elements": { "rowMenu": "tbody tr:nth-child(2) .menu" }
    }
  ]
}
```

- `url`: a URL, or a file path relative to the spec. `root`: the element the
  screenshots capture and the boxes are relative to; pick the page container so
  demo controls and the application shell stay out. `hide`: selectors of
  anything on the page that is not part of the product.
- `tokenPrefix`: the prefix of the design system's custom properties, when the
  reference loads them. Each colour and length is then listed with the tokens
  that have the same value. They are candidates: several tokens share a value,
  and the reference's own CSS says which one was meant.
- A state is one screenshot. `steps` put the page into it, each one of
  `click`, `hover`, `fill` (`[selector, text]`), `select` (`[selector, value]`),
  `press` (a key), `wait` (ms), `waitFor` (a selector). Selectors are
  Playwright selectors. Every state starts from a fresh load.
- `elements` names what to measure in that state: a selector for the first
  match, `{ "all": … }` for every match (the cells of a row, the fields of a
  filter bar). `crops` adds close-up screenshots.
- Keep the viewport taller than the page (the default is 1440 × 1400), so no
  screenshot scrolls.

The script exits non-zero and lists every selector that matched nothing: a
typo, or an element that is not there in that state.

Cover the states an implementer would otherwise have to imagine: the default,
every variant of a row or card, a selection, each open menu or popover,
filters applied, the empty state, hover. Add loading and error only when the
reference draws them.

`measurements.json` is large. Read it through the script, never whole:

```sh
node <relay-design skill>/scripts/distill-ui.mjs --show <measurements.json>                      # the states
node <relay-design skill>/scripts/distill-ui.mjs --show <measurements.json> 01-default headerCells
```

The script takes Playwright from the repository it runs in. In a repository
without it, do not add it: open the reference with the browser tool the
harness provides, take the same screenshots, and read the same values
(`getBoundingClientRect()`, `getComputedStyle()`). With neither, work from
images.

## 3. Write the contract

One file per screen, `ui/<screen>.md`, with these sections.

**Reference.** What was distilled (path or URL), the command that repeats it,
and a table of the screenshots: file, state, what to look at in it.

**Structure.** The regions of the screen from top to bottom as a nested list,
with the measured width of whatever has a fixed one. Not ASCII art
(`diagrams.md` says why).

**Rules.** One table per region (page skeleton, filter bar, table, cells,
states, empty state). A row is one rule:

| ID | Rule | Measured | Source | Check |
|---|---|---|---|---|
| F1 | The filters sit in a card: elevated background, 1px border, shadow | 1108 × 231 | `reference/app.css:338` | look |
| F2 | The five filter controls sit on one line, bottom-aligned, gap `spacing_3x`; they never wrap | all five at y = 217 | `reference/app.css:339` | script |
| F3 | Each select is 168px wide; Search takes the rest | 168 × 4; Search 338 | `reference/app.css:412` | script |
| T2 | Column widths: 44px, auto, 108px, 13%, 164px | 44 / 479 / 108 / 144 / 164 | `reference/app.css:420-421` | script |
| T8 | Row actions never extend past the table's right edge | actions end at 1120.7, table at 1124 | measured | script |

- **ID**: a letter per region and a number, unique in the file. Tasks claim
  rules by ID, so an ID never changes meaning once the design is approved.
- **Rule**: one sentence someone can check in a browser. Values are the
  project's design tokens where one exists and px only for fixed dimensions
  (a column, a control, a container).
- **Measured**: the value in the reference, from `measurements.json`.
- **Source**: the line of the reference's CSS or markup the rule comes from.
  When the two disagree, the source wins; the measurement is the cross-check.
- **Check**: `script` when a check in `<screen>.json` decides the rule (step
  4), `look` when only a person or a reviewer comparing the two screenshots
  can. Prefer `script`: a 24px difference is invisible in an image and
  obvious in a number.

What to look for, because these are what component defaults do not give:

1. **Structure**: what shares a row, what stacks, what may wrap and what must
   not.
2. **Size**: the container, columns, controls with a fixed width.
3. **Spacing** between blocks.
4. **Text roles**: which type style and colour a title, a label, secondary
   text and a link take. Raw links and headings have no component to style
   them.
5. **Overflow**: truncate, wrap, or scroll.
6. **Surfaces**: a card around a group, a divider, the background.

A rule earns its place when an implementer using the component library as it
comes would get it wrong. A stacked form may need ten rules, a dense table
screen fifty. Copy and behaviour are not rules here; they are in `design.md`.

**Conversions.** A reference often uses raw values (`#595959`, `13px`, an 8px
radius) where the project's conventions allow only tokens. List each one: the
raw value, where it is used, the token the contract uses instead, and how the
result differs from the reference.

**Left to the component library.** The controls whose own look (height,
padding, border, focus ring, disabled style) comes from the real component
and is not copied from the reference. Their width, position and the spacing
between them still follow the rules.

**Not in this contract.** What the screenshots show that is not product: demo
controls, sample data, parts another contract covers.

Rules that hold on every screen go to `ui/shared.md`, in the same table form,
and are not repeated per screen.

## 4. Write the checks

A rule that has a number or a relation in it is decided by a script when the
implementation is verified, so write that decision down now, while the
reference is at hand to prove it. Add `checks` to the state of `<screen>.json`
whose elements they use:

```json
"checks": [
  { "rule": "F2", "check": "sameRow", "of": "filterFields" },
  { "rule": "F2", "check": "gap", "of": "filterFields", "equals": 12 },
  { "rule": "F3", "check": "width", "of": "filterFields", "equals": [null, 168, 168, 168, 168] },
  { "rule": "T2", "check": "width", "of": "headerCells", "equals": [44, null, 108, "13%", 164], "percentOf": "table" },
  { "rule": "T8", "check": "inside", "of": "rowActions", "container": "table", "axis": "x" },
  { "rule": "R8", "check": "singleLine", "of": "ownerTeams" },
  { "rule": "L1", "check": "style", "of": "assetLink", "expect": { "color": "token:color_action_foreground", "text-decoration-line": "none" } },
  { "rule": "F1", "check": "style", "of": "filterCard", "expect": { "border-radius": "token:border_radius_200" }, "converted": true }
]
```

| `check` | Passes when | Arguments |
|---|---|---|
| `sameRow` | the elements share one line (each overlaps its neighbour vertically) | `of` |
| `stacked` | each element starts below the end of the one before | `of` |
| `width`, `height` | each element has the pinned size | `of`; `equals` (px, `"N%"` of `percentOf`, or a list with `null` for a size that is not pinned), `min`, `max` |
| `gap` | the distance from the end of one element to the start of the next is as pinned | `between: [a, b]` or `of` (neighbours); `axis` `x` (default) or `y`; `equals`, `min`, `max` |
| `inside` | no element leaves the container | `of`, `container`; `axis` `x`, `y` or `both` (default) |
| `singleLine` | the text takes one line | `of` |
| `style` | the computed style has these values | `of`; `expect`: property → value, `token:<name>` for a design token; `font-size`, `line-height`, `font-weight` are available too |
| `noHorizontalOverflow` | the page does not scroll sideways | |

- `of` is an element name of that state, or a list of names; an
  `{ "all": … }` element contributes every match.
- Every check has the `rule` it serves; a rule can have several. Sizes allow
  1px of difference; `tolerance` changes that for one check.
- Checks compare relations and sizes, never positions on the page: the real
  components are a few pixels taller than a mockup's, and a check that pins
  `y = 217` would fail for a reason nobody cares about.
- Point `singleLine` at the element that holds the text. A table cell is as
  tall as its row, so it says nothing about its own text.
- "Does not overflow" is an `inside` check against the container. A table
  that is too wide scrolls inside its own wrapper, and the page itself
  reports no overflow.
- `converted: true` marks a check whose value the contract changed on purpose
  (a Conversion): the reference is not expected to pass it.

Then run the checks against the reference:

```sh
node <relay-design skill>/scripts/check-ui.mjs .relay/YYYY-MM-DD-<slug>/ui/<screen>.json
```

Every check must pass, the converted ones aside. A check that fails on the
reference does not say what its rule says: fix the check, or the rule.

## 5. Conflicts are questions

Distilling turns up things only the user can settle. Ask them in the
interview, one at a time, with your recommendation, and record each answer in
`design.md`'s Decisions:

- The reference and the project's conventions disagree in a way a person
  would see (the conversion makes a radius, a colour or a size visibly
  different).
- The reference contradicts a decision already made.
- The reference has a flaw of its own: content that overflows its column,
  controls that do not line up between rows.

An approved design has no open question left in a contract.

## When the reference cannot be run

A design-tool export or a set of screenshots has no CSS to measure. Put the
images in `ui/<screen>/screenshots/`, write the same contract with every
number marked as an estimate (`≈ 168px`) and no Source, and say so at the top
of the file. The user confirms the numbers in the review. Checks can still be
written, but nothing proves them before the implementation exists; say that
too.

## Check before review

For each screen with a visual reference: the reference opens from this
worktree; `ui/<screen>.md` exists and its screenshots cover the states listed
above; every rule has an ID, a checkable sentence and a measured value; every
rule marked `script` has a check and `check-ui.mjs` passes on the reference;
every raw value of the reference appears under Conversions; nothing in the
file is an open question.
