import { randomBytes } from "node:crypto";
import { chmod, stat } from "node:fs/promises";
import type { KozoHome } from "@kozo/core";

const tokenPattern = /^[0-9a-f]{64}$/;

/**
 * Reads the API token, creating it readable only by the owner on first use. A token file that
 * others can read, or that does not hold a full token, keeps kozod from starting: an empty or
 * short token would let a guess through.
 */
export async function apiToken(home: KozoHome): Promise<string> {
  const file = Bun.file(home.apiToken);
  if (!(await file.exists())) {
    const token = randomBytes(32).toString("hex");
    await Bun.write(home.apiToken, `${token}\n`, { mode: 0o600 });
    await chmod(home.apiToken, 0o600);
    return token;
  }
  if (((await stat(home.apiToken)).mode & 0o077) !== 0) {
    throw new Error(`${home.apiToken} is readable by others; run chmod 600 on it`);
  }
  const token = (await file.text()).trim();
  if (!tokenPattern.test(token)) {
    throw new Error(`${home.apiToken} does not hold a token; delete it to create a new one`);
  }
  return token;
}
