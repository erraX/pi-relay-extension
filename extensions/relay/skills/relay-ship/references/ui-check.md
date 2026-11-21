# Checking an implementation against its UI contract

A screen with a UI contract (`[FEATURE_DIR]/ui/<screen>.md`) is verified in
three layers, each for what it can decide:

1. **The contract's checks**, by script: relations and sizes that have a
   number (same row, a width, a gap, inside a container, a computed style).
   Run by the implementer of each task that claims rules, and again in the
   verification pass.
2. **Reference and implementation side by side**, by the reviewer: the rules
   marked `look`, and differences no rule mentions.
3. **Acceptance**, by the user: whether the screen looks right. A `Manual:`
   line, with the side-by-side images already made.

Nothing here compares screenshots pixel by pixel. The real components differ
from a mockup's by a few pixels everywhere, so a pixel diff is red forever
and gets ignored.

## The implementation spec

`ui/<screen>.impl.json` tells the script how to open the implementation and
where its elements are. It has the shape of `ui/<screen>.json` (the
reference's spec, see `../../relay-design/references/ui-contract.md`) without
the checks:

- the **same state names, element names and crop names** as the reference's
  spec, because the checks refer to them;
- its own `url`, `root`, `waitFor`, `hide`, the `steps` that put the
  implementation into each state, and its own selectors;
- only the states and elements that the checks of the rules built so far
  need. The first task that builds the screen creates the file; each later
  task adds what its rules need.

Prefer the selectors the tests use (test ids, roles) over generated class
names.

## Running it

The implementation must be running and reachable without a login, showing
the same sample data as the reference; the plan's Decisions say how to start
it and at which URL. Start it, run the script from the repository root, stop
what you started:

```sh
node <relay-design skill>/scripts/check-ui.mjs [FEATURE_DIR]/ui/<screen>.json --impl [FEATURE_DIR]/ui/<screen>.impl.json
```

It measures the implementation afresh every time, judges every check of the
contract against it, and writes into `ui/<screen>.impl/`:

- `check-report.md`: failed checks first, with expected and actual values;
  then the **element mapping**, what the reference and the implementation
  matched for each element the checks use;
- `compare/<state>.png`: the reference on the left, the implementation on the
  right, for every state and crop both have;
- `screenshots/`, `measurements.json`: the implementation alone. Query the
  measurements with `distill-ui.mjs --show`, never read them whole.

It exits non-zero while a check fails.

## Reading the result

- **A check of a rule your task claims fails**: fix the implementation and run
  it again.
- **A check of a rule no task has built yet fails, or its state or element is
  "not measured"**: expected until that task runs. A task is done when the
  checks of the rules it claims pass; the verification pass needs all of them.
- **The element mapping shows a different count or an unrelated text**: the
  implementation spec points at the wrong element. Fix the selector. A check
  that passes on the wrong element proves nothing.
- **Look at the `compare/` images of the states you built.** The checks do not
  cover everything, and a missing card or an unstyled link is obvious in the
  pair.

## What you may not change

The contract, the reference's spec and its checks are the design the user
approved. Never edit `ui/<screen>.md` or `ui/<screen>.json`, loosen a
tolerance, or point a selector at a more convenient element to make a check
pass.

A rule that cannot be met (the component library does not allow it, two rules
contradict each other, the rule breaks at real content) is a plan conflict:
stop and report `Status: blocked` with the rule's ID, the check's expected and
actual values, and what stands in the way. The user decides whether the rule
changes; the decision is recorded in the plan's Decisions and in the
contract.

## These checks are not regression tests

They accept this build against its reference; when the design changes, the
contract changes with it. Do not copy them into the repository's test suite.
A rule worth guarding for good (no horizontal scroll, the filters on one row)
gets an assertion in a committed spec only where the plan says so.
