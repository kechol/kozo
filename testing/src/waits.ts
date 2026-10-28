/**
 * Resolves once `check` holds, looking again every few milliseconds, and fails naming `what`
 * after `timeoutMs`; the interval decides nothing but how soon the wait ends.
 */
export async function eventually(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

/** What `promise` resolves to, failing naming `what` if it takes longer than `timeoutMs`. */
export async function inTime<T>(promise: Promise<T>, what: string, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}
