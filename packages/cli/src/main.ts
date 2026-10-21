import { run } from "./index.ts";

process.exitCode = await run(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  rawStdout: (text) => process.stdout.write(text),
  rawStderr: (text) => process.stderr.write(text),
});
