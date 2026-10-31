import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/**
 * A modal dialog, open for as long as it is rendered. Opening focuses its first control, and
 * Escape asks the owner to close it; the owner gives focus back to what opened it.
 */
export function Modal({
  label,
  description,
  alert = false,
  onClose,
  children,
}: {
  /** The id of the element that names the dialog, and of the one that says what it does. */
  label: string;
  description?: string;
  /** An alert dialog asks before something that cannot be taken back. */
  alert?: boolean;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      class="dialog"
      role={alert ? "alertdialog" : undefined}
      aria-labelledby={label}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
