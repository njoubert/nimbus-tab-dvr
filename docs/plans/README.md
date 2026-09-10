# Plans

What is going to be built, decided before it is built.
A plan is the document an agent is handed, and the document a reviewer argues with before any code exists.

## Naming

```text
YYYY-MM-DD-short-slug.md
```

**A plan is named for the day it was agreed and the work it covers**, so the pair of it and its report share one slug and sort together.
The report of the same work is `../reports/YYYY-MM-DD-HHMM-short-slug.md`.

## What a plan contains

- **Facts already checked**, first, each one something that was run or read rather than assumed.
  A plan that opens on facts is a plan whose risks are real.
- **Hard rules**, restated from [CLAUDE.md](../../CLAUDE.md) as invariants this work may not break.
- **The work, in the order it will be done**, split so that each piece is independently reviewable.
- **The size and the risk of each piece**, plainly, with the unknowns named as unknowns.
- **What is deliberately out of scope**, because a reviewer cannot approve a boundary they cannot see.

## A plan is a living document until it is executed

**A plan is rewritten in place while it is being argued about, and frozen when the work starts.**
What actually happened goes in the report, never back into the plan; the two together are the record.

**A plan that was abandoned stays.**
The reason it was abandoned goes in [docs/GRILLING.md](../GRILLING.md) or in the report that replaced it.

## Index

| Plan | Date | Report |
| ---- | ---- | ------ |
| [Capture feasibility spike](2026-09-09-capture-feasibility-spike.md) | 2026-09-09 | [2026-09-09-2343](../reports/2026-09-09-2343-capture-feasibility-spike.md) |
| [Tab recording sidecar sketch](2026-09-09-tab-recording-sidecar-sketch.md) | 2026-09-09 | the sketch the spike came from; not executed as written |
