/** The element id of the shortcut slot in the report's surface row (Report, Graph, Cards, ...).
 *  `ReportShell` renders the empty slot and a surface portals into it; the graph puts its key cards
 *  there (UI review 2026-09-25). Its own module so neither side imports the other. */
export const SURFACE_ROW_SLOT_ID = "surface-row-slot";
