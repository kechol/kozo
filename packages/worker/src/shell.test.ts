import { describe, expect, test } from "bun:test";
import { parseShell, type Word } from "./shell.ts";

const words = (source: string) => parseShell(source).commands;
const texts = (commands: Word[][]) => commands.map((command) => command.map((word) => word.text));

describe("parseShell", () => {
  test("joins quoted and escaped text into one word, and marks expansions", () => {
    expect(words(`echo 'a b' "c $x" d\\ e`)).toEqual([
      [
        { text: "echo", dynamic: false },
        { text: "a b", dynamic: false },
        { text: "c ", dynamic: true },
        { text: "d e", dynamic: false },
      ],
    ]);
    expect(words("x=1 env")).toEqual([
      [
        { text: "x=1", dynamic: false },
        { text: "env", dynamic: false },
      ],
    ]);
  });

  test("finds the commands inside command, process and arithmetic substitutions", () => {
    expect(texts(words("echo `whoami`"))).toEqual([["whoami"], ["echo", ""]]);
    expect(texts(words("diff <(git show HEAD) b"))).toEqual([
      ["git", "show", "HEAD"],
      ["diff", "<(git show HEAD)", "b"],
    ]);
    expect(words("echo $((1+2))")[1]?.[1]).toEqual({ text: "", dynamic: true });
  });

  test("keeps here-document bodies, stripping tabs for <<-", () => {
    expect(parseShell("cat <<EOF\ngit push\nEOF\n").heredocs).toEqual(["git push"]);
    expect(parseShell("cat <<-EOF\n\tgit push\n\tEOF\n").heredocs).toEqual(["\tgit push"]);
    expect(texts(parseShell("cat <<EOF\ngit push\nEOF\n").commands)).toEqual([["cat"]]);
  });

  test("skips reserved words at a command's start and notes a background job", () => {
    expect(texts(words("if true; then ls; fi"))).toEqual([["true"], ["ls"]]);
    expect(texts(words("{ bun test; }"))).toEqual([["bun", "test"]]);
    expect(parseShell("sleep 1 &").background).toBe(true);
    expect(parseShell("a && b").background).toBe(false);
  });

  test("marks brace expansions dynamic, but not a lone brace or find's {}", () => {
    const flags = (source: string) =>
      words(source)
        .flat()
        .map((word) => word.dynamic);
    expect(flags("{g..g}it push")).toEqual([true, false]);
    expect(flags("g{i,i}t status")).toEqual([true, false]);
    expect(flags("echo '{a,b}' { } {}")).toEqual([false, false, false, false, false]);
  });

  test("throws rather than guess at text it cannot read", () => {
    expect(() => parseShell("echo 'open")).toThrow("an unclosed single quote");
    expect(() => parseShell('echo "open')).toThrow("an unclosed double quote");
    expect(() => parseShell("echo `open")).toThrow("an unclosed backtick");
    expect(() => parseShell("cat <<EOF\nnever closed\n")).toThrow("an unclosed here-document");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, not a template.
    expect(() => parseShell("echo ${x:-$(git push)}")).toThrow(
      "a substitution inside a parameter expansion",
    );
  });
});
