import { $ } from "bun";

const binaries = [
  { name: "kozo", entry: "packages/cli/src/main.ts" },
  { name: "kozod", entry: "packages/daemon/src/main.ts" },
];

for (const { name, entry } of binaries) {
  await $`bun build --compile ${entry} --outfile dist/${name}`;
}
