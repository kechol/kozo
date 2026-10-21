import { randomBytes } from "node:crypto";
import { chmod } from "node:fs/promises";
import type { KozoHome } from "./home.ts";

/** Reads the API token, creating it readable only by the owner on first use. */
export async function apiToken(home: KozoHome): Promise<string> {
  const file = Bun.file(home.apiToken);
  if (await file.exists()) return (await file.text()).trim();
  const token = randomBytes(32).toString("hex");
  await Bun.write(home.apiToken, `${token}\n`, { mode: 0o600 });
  await chmod(home.apiToken, 0o600);
  return token;
}
