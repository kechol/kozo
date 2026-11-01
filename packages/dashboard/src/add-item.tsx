import { useId, useState } from "preact/hooks";
import { busyAttributes } from "./actions.tsx";
import type { Api } from "./api.ts";
import { Modal } from "./dialog.tsx";
import { workClasses } from "./format.ts";
import { Icon } from "./icons.tsx";
import { run, status } from "./store.ts";
import { t } from "./words.ts";

/**
 * Adds an item as `kozo add` does, from a dialog: a title, the request, and the repository and
 * work class when the human wants to choose them. What was typed stays until the item is added,
 * and a failure is said in the dialog.
 */
export function AddItem({ api }: { api: Api }) {
  const repositories = status.value?.repositories ?? [];
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [repository, setRepository] = useState("");
  const [workClass, setWorkClass] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const id = useId();

  const close = () => {
    if (busy) return;
    setFailure(null);
    setOpen(false);
  };
  const ready = title.trim() !== "" && (repositories.length <= 1 || repository !== "");
  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setFailure(null);
    const added = await run(
      api,
      () =>
        api.post("/api/items", {
          title: title.trim(),
          body: request.trim(),
          ...(repository ? { repository } : {}),
          ...(workClass ? { class: workClass } : {}),
        }),
      setFailure,
    );
    setBusy(false);
    if (added) {
      setTitle("");
      setRequest("");
      setRepository("");
      setWorkClass("");
      setOpen(false);
    }
  };
  return (
    <>
      <button type="button" class="primary" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        {t("addItem.new")}
      </button>
      {open ? (
        <Modal label={`${id}-title`} onClose={close}>
          <form
            class="action-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h2 id={`${id}-title`}>{t("addItem.new")}</h2>
            <label class="field">
              <span>{t("field.title")}</span>
              <input
                value={title}
                required
                onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>{t("field.request")}</span>
              <textarea
                rows={5}
                value={request}
                placeholder={t("addItem.requestHint")}
                onInput={(event) => setRequest((event.target as HTMLTextAreaElement).value)}
              />
            </label>
            {repositories.length > 1 ? (
              <label class="field">
                <span>{t("field.repository")}</span>
                <select
                  value={repository}
                  required
                  onChange={(event) => setRepository((event.target as HTMLSelectElement).value)}
                >
                  <option value="">{t("addItem.chooseRepository")}</option>
                  {repositories.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label class="field">
              <span>{t("addItem.workClass")}</span>
              <select
                value={workClass}
                onChange={(event) => setWorkClass((event.target as HTMLSelectElement).value)}
              >
                <option value="">{t("addItem.triage")}</option>
                {workClasses.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {failure ? (
              <div class="problem" role="alert">
                {failure}
              </div>
            ) : null}
            <div class="row form-actions">
              <button type="button" class="ghost" onClick={close} disabled={busy}>
                {t("action.back")}
              </button>
              <button type="submit" class="primary" disabled={!ready} {...busyAttributes(busy)}>
                {t(busy ? "addItem.adding" : "addItem.add")}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
