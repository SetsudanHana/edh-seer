# Design references

The approved mockups the report is built to. A PR that changes one of these surfaces shows the
reference beside a capture of the new screen at the same size (1280×860 desktop, 390×844 phone).
If the change departs from the reference, the PR says so and the owner approves it, and the
reference image is replaced in the same PR.

| Surface | Reference | Rules |
| --- | --- | --- |
| Report, first screen (Glance) | `report-first-screen.png`, `report-first-screen-phone.png` | The theme leads; the commander's map is next, whole, inside the first 1280×860 screen, with its colour key beside it (under it on a phone). The line for the table, the verdict and the card counts come after the map. `ReportShell.test.tsx` checks the order. |
