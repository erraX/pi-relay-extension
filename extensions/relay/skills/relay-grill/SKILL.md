---
name: relay-grill
description: Relentless one-question-at-a-time interview that stress-tests a plan, design, or half-formed idea until every decision is settled. Use when the user runs /relay-grill, says "grill me", or wants their thinking pressure-tested without producing a document. It is also the questioning procedure that relay-design and relay-plan reuse.
disable-model-invocation: true
metadata:
  forkedFrom: "mattpocock/skills skills/productivity/grilling (MIT, https://github.com/mattpocock/skills)"
---

Interview me relentlessly about every aspect of this plan until we reach a
shared understanding. Walk down each branch of the design tree, resolving
dependencies between decisions one by one. For each question, provide your
recommended answer.

Ask the questions one at a time, waiting for feedback on each question before
continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase
instead.

## Relay additions

- If the user passes a file path as the argument, read it first and interview
  about that document.
- If a relay artifact (`design.md` or `plan.md` under `.relay/`) is already in
  the conversation or named by the user, record each decision in its
  `## Decisions` section as soon as it is settled, so the conclusion survives
  into planning and review. Otherwise this is a pure conversation: produce no
  files.
- The interview is over when no open question remains that would change the
  design. Say so, summarize the settled decisions in a short list, and stop.
  Do not start a design, a plan, or any implementation from here.
