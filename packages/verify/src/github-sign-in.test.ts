import { describe, expect, test } from "bun:test";
import { activeGitHubLogin } from "./github-sign-in.ts";

describe("activeGitHubLogin", () => {
  test("reads the active github.com account", () => {
    const output = JSON.stringify({
      hosts: {
        "github.com": [
          { active: false, login: "other-example" },
          { active: true, login: "octo-example" },
        ],
      },
    });
    expect(activeGitHubLogin(output)).toBe("octo-example");
  });

  test("finds none without an active github.com account or with output that is not JSON", () => {
    expect(activeGitHubLogin(JSON.stringify({ hosts: {} }))).toBeUndefined();
    expect(
      activeGitHubLogin(
        JSON.stringify({ hosts: { "github.com": [{ active: false, login: "octo-example" }] } }),
      ),
    ).toBeUndefined();
    expect(activeGitHubLogin("not json")).toBeUndefined();
  });
});
