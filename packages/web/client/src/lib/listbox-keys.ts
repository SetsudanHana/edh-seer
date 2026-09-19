import { useState, type KeyboardEvent } from "react";

/** THE COMBOBOX KEYBOARD, ONCE (ARIA authoring practices: combobox with listbox popup).
 *
 *  `HeaderSearch` shipped this first and owned it alone: arrows move and wrap, Enter takes the
 *  active row or the first one, Escape closes. The event pickers (roadmap AJ3) need the identical
 *  contract, and a second hand-written copy of an accessibility rule is one that drifts the first
 *  time only one of them is fixed.
 *
 *  THE HOOK OWNS THE ACTIVE ROW AND NOTHING ELSE. Open state, the option list and
 *  `aria-activedescendant` stay with the component, which is what lets the header keep its portal
 *  and the picker keep its chips without either knowing about the other. */
export function useListboxKeys({ count, onChoose, onClose }: {
  count: number;
  onChoose: (index: number) => void;
  onClose?: () => void;
}): {
  active: number;
  setActive: (index: number) => void;
  onKey: (ev: KeyboardEvent<HTMLInputElement>) => void;
  reset: () => void;
} {
  const [active, setActive] = useState(-1);
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown" && count > 0) {
      ev.preventDefault(); setActive((a) => (a + 1) % count);
    } else if (ev.key === "ArrowUp" && count > 0) {
      ev.preventDefault(); setActive((a) => (a <= 0 ? count - 1 : a - 1));
    } else if (ev.key === "Enter") {
      // NOTHING TO CHOOSE IS NOT A CHOICE. Enter on an empty list must not report row 0, which is
      // the one way this control could name an option that is not on screen.
      if (count === 0) return;
      ev.preventDefault(); onChoose(active >= 0 ? active : 0);
    } else if (ev.key === "Escape") {
      setActive(-1); onClose?.();
    }
  };
  return { active, setActive, onKey, reset: () => setActive(-1) };
}
