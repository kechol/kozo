import { parseArgs } from "node:util";
import { $ } from "bun";

// Usage: bun run scripts/compile.ts [--target bun-linux-x64] [--outdir dist]
const { values } = parseArgs({
  options: {
    target: { type: "string" },
    outdir: { type: "string", default: "dist" },
  },
});

const binaries = [
  { name: "kozo", entry: "packages/cli/src/main.ts" },
  { name: "kozod", entry: "packages/daemon/src/main.ts" },
];

const targetArgs = values.target ? ["--target", values.target] : [];

for (const { name, entry } of binaries) {
  await $`bun build --compile ${targetArgs} ${entry} --outfile ${values.outdir}/${name}`;
}
