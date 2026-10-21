import { run } from "./index.ts";

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});
