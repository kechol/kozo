import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { Api } from "./api.ts";
import { Modal } from "./dialog.tsx";
import { Icon } from "./icons.tsx";
import { run, status } from "./store.ts";

const classes = ["docs", "deps", "bugfix", "refactor", "perf", "migration", "feature"] as const;

/**
 * Adds an item as `kozo add` does, from a dialog: a title, the request, and the repository and
 * work class when the human wants to choose them. What was typed stays until the item is added.
 */
export function AddItem({ api }: { api: Api }) {
  const repositories = status.value?.repositories ?? [];
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const [repository, setRepository] = useState("");
  const [workClass, setWorkClass] = useState("");
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const id = useId();

  useEffect(() => {
    if (open || !restore.current) return;
    restore.current = false;
    trigger.current?.focus();
  }, [open]);

  const close = () => {
    restore.current = true;
    setOpen(false);
  };
  const ready = title.trim() !== "" && (repositories.length <= 1 || repository !== "");
  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    const added = await run(api, () =>
      api.post("/api/items", {
        title: title.trim(),
        body: request.trim(),
        ...(repository ? { repository } : {}),
        ...(workClass ? { class: workClass } : {}),
      }),
    );
    setBusy(false);
    if (added) {
      setTitle("");
      setRequest("");
      close();
    }
  };
  return (
    <>
      <button type="button" ref={trigger} class="primary" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        New item
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
            <h2 id={`${id}-title`}>New item</h2>
            <label class="field">
              <span>Title</span>
              <input
                value={title}
                required
                onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>Request</span>
              <textarea
                rows={5}
                value={request}
                placeholder="What to change and why"
                onInput={(event) => setRequest((event.target as HTMLTextAreaElement).value)}
              />
            </label>
            {repositories.length > 1 ? (
              <label class="field">
                <span>Repository</span>
                <select
                  value={repository}
                  required
                  onChange={(event) => setRepository((event.target as HTMLSelectElement).value)}
                >
                  <option value="">Choose a repository</option>
                  {repositories.map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label class="field">
              <span>Work class</span>
              <select
                value={workClass}
                onChange={(event) => setWorkClass((event.target as HTMLSelectElement).value)}
              >
                <option value="">Let triage choose</option>
                {classes.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div class="row form-actions">
              <button type="button" class="ghost" onClick={close}>
                Back
              </button>
              <button
                type="submit"
                class="primary"
                disabled={!ready}
                {...(busy ? { "aria-busy": true, "aria-disabled": true } : {})}
              >
                {busy ? "Adding…" : "Add item"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
