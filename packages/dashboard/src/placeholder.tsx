/**
 * Grey lines where content is loading, at about its final size, so the page does not jump when it
 * arrives. They are hidden from assistive technology; `Loading` says once what is loading.
 */
export function Placeholder({ lines = 3 }: { lines?: number }) {
  return (
    <div class="placeholder" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p class="sr-only" role="status">
      Loading {what}…
    </p>
  );
}
