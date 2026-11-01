import { Icon, toneIcon } from "./icons.tsx";
import { dismiss, holdToasts, type Toast, toasts } from "./store.ts";
import { t } from "./words.ts";

/**
 * Where actions answer. Both live regions are always in the page, so that a screen reader
 * announces each toast put in them: an answer politely, a failure at once. Answers stay while
 * the pointer or focus is on them.
 */
export function Toasts() {
  const list = (failed: boolean) =>
    toasts.value
      .filter((toast) => toast.failed === failed)
      .map((toast) => <ToastItem key={toast.id} toast={toast} />);
  return (
    <section
      class="toasts"
      aria-label={t("toasts.label")}
      // The region lets the pointer through to its toasts, whose pointer events reach it here.
      onPointerOver={() => holdToasts(true)}
      onPointerOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) holdToasts(false);
      }}
      onFocusIn={() => holdToasts(true)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) holdToasts(false);
      }}
    >
      <div class="toast-list" role="status">
        {list(false)}
      </div>
      <div class="toast-list" role="alert">
        {list(true)}
      </div>
    </section>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const tone = toast.failed ? "negative" : "positive";
  return (
    <div class={`toast ${tone}`}>
      <span class="toast-mark">
        <Icon name={toneIcon[tone]} />
      </span>
      <p>{toast.text}</p>
      <button
        type="button"
        class="ghost icon-button"
        aria-label={t("toasts.dismiss")}
        onClick={() => dismiss(toast.id)}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
