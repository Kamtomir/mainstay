import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatViolation, lineAt, listFiles, stripComments } from "./core";

describe("stripComments", () => {
  const strip = (src: string) => stripComments(src);

  it("blanks line and block comments and keeps every newline", () => {
    const src = "const a = 1; // note\n/* one\n   two */ const b = 2;\n";
    const out = strip(src);
    expect(out).not.toMatch(/note|one|two/);
    expect(out).toContain("const a = 1;");
    expect(out).toContain("const b = 2;");
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out.length).toBe(src.length);
  });

  it("blanks JSX comments", () => {
    expect(strip("<div>{/* hidden */}<b/></div>")).not.toContain("hidden");
  });

  it("keeps strings that look like comments", () => {
    const src = `const url = "http://example.com/a"; const s = '/* not a comment */';`;
    expect(strip(src)).toBe(src);
  });

  it("keeps template literals, including the text around ${}", () => {
    const src = "const t = `see //docs ${value} and /* this */`;";
    expect(strip(src)).toBe(src);
  });

  it("keeps regex literals, so a guard can still find a forbidden one", () => {
    const src = "const re = /(?<=\\s)@\\w+/g; // handles\nconst slashes = /\\/\\/+/;";
    const out = strip(src);
    expect(out).toContain("/(?<=\\s)@\\w+/g");
    expect(out).toContain("/\\/\\/+/");
    expect(out).not.toContain("handles");
  });

  it("keeps a slash inside a character class", () => {
    const src = "const re = /[/]+/g;";
    expect(strip(src)).toBe(src);
  });

  it("tells a division from a regex and still drops the comment after it", () => {
    const out = strip("const half = total / 2; // rounding\nreturn /x/.test(s);");
    expect(out).toContain("const half = total / 2;");
    expect(out).not.toContain("rounding");
    expect(out).toContain("return /x/.test(s);");
  });
});

describe("lineAt and formatViolation", () => {
  it("counts lines from 1", () => {
    const text = "a\nb\nc";
    expect(lineAt(text, 0)).toBe(1);
    expect(lineAt(text, text.indexOf("c"))).toBe(3);
  });

  it("prints file:line, rule, message and snippet on one line", () => {
    expect(formatViolation({ file: "src/a.ts", line: 3, rule: "r", message: "bad", snippet: "x()" })).toBe(
      'src/a.ts:3 [r] bad — "x()"',
    );
    expect(formatViolation({ file: "src/a.ts", message: "bad" })).toBe("src/a.ts bad");
  });
});

describe("listFiles", () => {
  const root = mkdtempSync(join(tmpdir(), "mainstay-core-"));
  const put = (rel: string, text = "export {};\n") => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put("src/a.ts");
  put("src/b.tsx");
  put("src/c.test.ts");
  put("src/__tests__/d.ts");
  put("src/readme.md", "# not code\n");
  put("node_modules/pkg/index.js");
  put("dist/out.js");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("returns sources as sorted paths from the root, without tests and build output", () => {
    expect(listFiles(root)).toEqual(["src/a.ts", "src/b.tsx"]);
  });

  it("includes tests on request and applies exclude", () => {
    expect(listFiles(root, { includeTests: true, exclude: /\.tsx$/ })).toEqual([
      "src/__tests__/d.ts",
      "src/a.ts",
      "src/c.test.ts",
    ]);
  });

  it("fails loudly on a missing root instead of scanning nothing", () => {
    expect(() => listFiles(join(root, "nope"))).toThrow(/does not exist/);
  });
});
