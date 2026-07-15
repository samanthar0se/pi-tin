import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogFocus<T extends HTMLElement>() {
  const dialogRef = useRef<T>(null);
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      const preferred = dialog.querySelector<HTMLElement>("[data-dialog-autofocus]");
      (preferred || dialog.querySelector<HTMLElement>(focusableSelector))?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
    };
  }, []);

  const trapFocus = (event: ReactKeyboardEvent<T>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((element) => element.offsetParent !== null);
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, trapFocus };
}
