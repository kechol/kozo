import { Icon, toneIcon } from "./icons.tsx";
import { dismiss, type Toast, toasts } from "./store.ts";

/**
 * Where actions answer. Both live regions are always in the page, so that a screen reader
 * announces each toast put in them: an answer politely, a failure at once.
 */
export function Toasts() {
  const list = (failed: boolean) =>
    toasts.value
      .filter((toast) => toast.failed === failed)
      .map((toast) => <ToastItem key={toast.id} toast={toast} />);
  return (
    <section class="toasts" aria-label="Notifications">
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
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
