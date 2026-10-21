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
