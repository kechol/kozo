/** Runs `command` through `sh -c` in `cwd`, passing its output to `log`, and returns its exit code. */
export async function runCommand(command: string, cwd: string, log: (text: string) => void) {
  const child = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  await Promise.all([forward(child.stdout, log), forward(child.stderr, log)]);
  return await child.exited;
}

async function forward(stream: ReadableStream<Uint8Array>, log: (text: string) => void) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) log(decoder.decode(chunk, { stream: true }));
  const rest = decoder.decode();
  if (rest) log(rest);
}

export function secondsSince(start: number) {
  return Math.round((performance.now() - start) / 1000);
}

type ErrorClass = abstract new (...args: never[]) => Error;

/**
 * Runs a verification layer, turning the errors it expects, such as a failed git call, into its
 * `error` status; anything else is a bug in kozo and is thrown on.
 */
export async function guarded<T>(
  log: (text: string) => void,
  expected: readonly ErrorClass[],
  layer: () => Promise<T>,
): Promise<T | { status: "error"; message: string }> {
  try {
    return await layer();
  } catch (error) {
    if (!expected.some((type) => error instanceof type)) throw error;
    const { message } = error as Error;
    log(`kozo: ${message}\n`);
    return { status: "error", message };
  }
}
