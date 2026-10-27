/** One word of a shell command, with whether any part of it comes from an expansion. */
export interface Word {
  text: string;
  /** True when the word holds a parameter, command or arithmetic expansion, or a glob. */
  dynamic: boolean;
}

export interface ParsedShell {
  /** Every simple command, those inside substitutions included, in source order. */
  commands: Word[][];
  /** Here-document bodies, which a command such as `sh` may read as a script. */
  heredocs: string[];
  /** Whether any command runs in the background with `&`. */
  background: boolean;
}

export class ShellParseError extends Error {}

const blank = (c: string | undefined) => c === " " || c === "\t";
const operatorChars = new Set([";", "&", "|", "(", ")", "\n"]);
const reservedWords = new Set([
  "{",
  "}",
  "!",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "while",
  "until",
  "do",
  "done",
  "esac",
]);
const redirection = /^(?:\d+|&)?(?:<<<|<<-|<<|>>|<>|>&|<&|>\||<|>)/;

/**
 * Splits shell text into simple commands the way a POSIX shell would before running them,
 * close enough to see every command name and its literal arguments, including those inside
 * command and process substitutions. Text that does not parse, such as an unclosed quote,
 * throws instead of being guessed at.
 */
export function parseShell(source: string): ParsedShell {
  const commands: Word[][] = [];
  const heredocs: string[] = [];
  let background = false;
  let current: Word[] = [];
  let pending: { delimiter: string; strip: boolean }[] = [];
  let i = 0;

  const finish = () => {
    if (current.length > 0) commands.push(current);
    current = [];
  };
  const nested = (text: string) => {
    const inner = parseShell(text);
    commands.push(...inner.commands);
    heredocs.push(...inner.heredocs);
    background ||= inner.background;
  };

  /** The index just past the `)` that closes the `(` at `open`, skipping quoted text. */
  const closing = (open: number): number => {
    let depth = 0;
    for (let j = open; j < source.length; j += 1) {
      const c = source[j];
      if (c === "\\") j += 1;
      else if (c === "'") {
        j = source.indexOf("'", j + 1);
        if (j === -1) break;
      } else if (c === '"') {
        for (j += 1; j < source.length && source[j] !== '"'; j += 1) if (source[j] === "\\") j += 1;
      } else if (c === "(") depth += 1;
      else if (c === ")" && --depth === 0) return j + 1;
    }
    throw new ShellParseError("an unclosed parenthesis");
  };

  /** Reads `$...` at `j`: a substitution is parsed for its commands, any other is a value. */
  const expansion = (j: number): number => {
    const next = source[j + 1];
    if (next === "(") {
      // Arithmetic, $((...)), is parsed like a substitution too: it may hold one.
      const end = closing(j + 1);
      nested(source.slice(j + 2, end - 1));
      return end;
    }
    if (next === "{") {
      let depth = 0;
      for (let k = j + 1; k < source.length; k += 1) {
        if (source[k] === "{") depth += 1;
        else if (source[k] === "}" && --depth === 0) {
          const inner = source.slice(j + 2, k);
          // ${x:-$(cmd)} runs cmd; rather than parse every operator of ${...}, refuse it.
          if (inner.includes("$(") || inner.includes("`")) {
            throw new ShellParseError("a substitution inside a parameter expansion");
          }
          return k + 1;
        }
      }
      throw new ShellParseError("an unclosed ${");
    }
    let k = j + 1;
    if (/[@*#?$!0-9-]/.test(source[k] ?? "")) return k + 1;
    while (/[A-Za-z0-9_]/.test(source[k] ?? "")) k += 1;
    return k;
  };

  const backtick = (j: number): number => {
    const end = source.indexOf("`", j + 1);
    if (end === -1) throw new ShellParseError("an unclosed backtick");
    nested(source.slice(j + 1, end));
    return end + 1;
  };

  const readWord = (): Word => {
    let text = "";
    let dynamic = false;
    // Where an unquoted brace opened in `text`: `{a,b}` and `{a..z}` expand into other words, so
    // a pair around anything is dynamic, while a lone brace and find's `{}` stay literal.
    let brace = -1;
    while (i < source.length) {
      const c = source[i] ?? "";
      if (blank(c) || operatorChars.has(c)) break;
      if ((c === "<" || c === ">") && text !== "" && !dynamic) break;
      if (c === "\\") {
        if (source[i + 1] !== "\n") text += source[i + 1] ?? "";
        i += 2;
      } else if (c === "'") {
        const end = source.indexOf("'", i + 1);
        if (end === -1) throw new ShellParseError("an unclosed single quote");
        text += source.slice(i + 1, end);
        i = end + 1;
      } else if (c === '"') {
        i += 1;
        while (source[i] !== '"') {
          if (i >= source.length) throw new ShellParseError("an unclosed double quote");
          const d = source[i] ?? "";
          if (d === "\\") {
            text += source[i + 1] ?? "";
            i += 2;
          } else if (d === "$") {
            dynamic = true;
            i = expansion(i);
          } else if (d === "`") {
            dynamic = true;
            i = backtick(i);
          } else {
            text += d;
            i += 1;
          }
        }
        i += 1;
      } else if (c === "$") {
        dynamic = true;
        i = expansion(i);
      } else if (c === "`") {
        dynamic = true;
        i = backtick(i);
      } else {
        if (c === "*" || c === "?" || c === "[") dynamic = true;
        if (c === "{") brace = text.length;
        if (c === "}" && brace !== -1 && text.length > brace + 1) dynamic = true;
        text += c;
        i += 1;
      }
    }
    return { text, dynamic };
  };

  const readHeredocs = () => {
    for (const { delimiter, strip } of pending) {
      const lines: string[] = [];
      for (;;) {
        if (i >= source.length) throw new ShellParseError(`an unclosed here-document ${delimiter}`);
        const end = source.indexOf("\n", i);
        const line = source.slice(i, end === -1 ? undefined : end);
        i = end === -1 ? source.length : end + 1;
        if ((strip ? line.replace(/^\t+/, "") : line) === delimiter) break;
        lines.push(line);
      }
      heredocs.push(lines.join("\n"));
    }
    pending = [];
  };

  while (i < source.length) {
    const c = source[i] ?? "";
    if (blank(c)) {
      i += 1;
    } else if (c === "\\" && source[i + 1] === "\n") {
      i += 2;
    } else if (c === "#") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (c === "\n") {
      finish();
      i += 1;
      readHeredocs();
    } else if ((c === "<" || c === ">") && source[i + 1] === "(") {
      const end = closing(i + 1);
      nested(source.slice(i + 2, end - 1));
      current.push({ text: source.slice(i, end), dynamic: true });
      i = end;
    } else if (redirection.test(source.slice(i)) && (c !== "&" || /^&>/.test(source.slice(i)))) {
      const operator = redirection.exec(source.slice(i))?.[0] ?? "";
      i += operator.length;
      while (blank(source[i])) i += 1;
      const target = readWord();
      if (operator.endsWith("<<") || operator.endsWith("<<-")) {
        pending.push({ delimiter: target.text, strip: operator.endsWith("<<-") });
      }
    } else if (operatorChars.has(c)) {
      finish();
      const double = source[i + 1] === c || (c === "|" && source[i + 1] === "&");
      if (c === "&" && !double) background = true;
      i += double ? 2 : 1;
    } else {
      const word = readWord();
      if (current.length === 0 && !word.dynamic && reservedWords.has(word.text)) continue;
      current.push(word);
    }
  }
  if (pending.length > 0) throw new ShellParseError("an unclosed here-document");
  finish();
  return { commands, heredocs, background };
}
