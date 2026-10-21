/**
 * Runs `command` through `sh -c` in `cwd`, passing its output to `log`, and returns its exit
 * code. Without `env` the command inherits this process's environment.
 */
export async function runCommand(
  command: string,
  cwd: string,
  log: (text: string) => void,
  env?: Record<string, string>,
) {
  const child = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(env ? { env } : {}),
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

// What a gate or a test needs from the environment. Sign-in variables, tokens and cloud
// credentials stay with kozod, since the commands run code from the diff under check.
const commandEnvironment = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
];

/** The environment kozod runs a diff's commands with: `source` without any credential. */
export function commandEnvironmentFrom(source: Record<string, string | undefined>) {
  return Object.fromEntries(
    commandEnvironment.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  ) as Record<string, string>;
}
