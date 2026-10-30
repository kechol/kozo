import { useState } from "preact/hooks";
import type { Api } from "./api.ts";
import { run, status } from "./store.ts";

const classes = ["docs", "deps", "bugfix", "refactor", "perf", "migration", "feature"] as const;

/** Adds an item as `kozo add` does: the first line is its title and the rest its body. */
export function AddItem({ api }: { api: Api }) {
  const repositories = status.value?.repositories ?? [];
  const [text, setText] = useState("");
  const [repository, setRepository] = useState("");
  const [workClass, setWorkClass] = useState("");
  const lines = text.trim().split("\n");
  const title = lines[0]?.trim() ?? "";
  const submit = async () => {
    const added = await run(api, () =>
      api.post("/api/items", {
        title,
        body: lines.slice(1).join("\n").trim(),
        ...(repository ? { repository } : {}),
        ...(workClass ? { class: workClass } : {}),
      }),
    );
    if (added) setText("");
  };
  return (
    <form
      class="card add-item"
      onSubmit={(event) => {
        event.preventDefault();
        if (title) void submit();
      }}
    >
      <label for="new-item">Add an item: the first line is its title, the rest its request</label>
      <textarea
        id="new-item"
        rows={3}
        value={text}
        onInput={(event) => setText((event.target as HTMLTextAreaElement).value)}
      />
      <div class="row">
        {repositories.length > 1 ? (
          <select
            aria-label="Repository"
            value={repository}
            onChange={(event) => setRepository((event.target as HTMLSelectElement).value)}
          >
            <option value="">Choose a repository</option>
            {repositories.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label="Work class"
          value={workClass}
          onChange={(event) => setWorkClass((event.target as HTMLSelectElement).value)}
        >
          <option value="">Let triage choose the class</option>
          {classes.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          class="primary md"
          disabled={!title || (repositories.length > 1 && !repository)}
        >
          Add
        </button>
      </div>
    </form>
  );
}
