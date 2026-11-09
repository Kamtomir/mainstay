/**
 * The Claude Code plugin is code too. These checks keep it installable with the
 * two commands in the README:
 *
 *   - both manifests are valid JSON with the fields Claude Code reads, and the
 *     marketplace lists the plugin under the name its own manifest gives it;
 *   - no version is set anywhere, so Claude Code versions the plugin by commit:
 *     every pushed commit reaches users on update. A fixed version would pin
 *     them to their first install until someone remembers to bump it;
 *   - the plugin folder holds the manifest and the skills, nothing else. No
 *     package.json or lockfile (with both, Claude Code installs the plugin's
 *     dependencies on the user's machine), and no hooks, MCP servers, agents or
 *     commands that would run in a user's session;
 *   - the harness files the setup skill installs are byte-identical to their
 *     source, and every path and link the skill names exists.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { filesUnder, HARNESS_COPY, harnessFiles, sameFile, syncPlugin } from "./scripts/sync-plugin.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const at = (...parts: string[]) => join(ROOT, ...parts);
const readJson = (...parts: string[]) => JSON.parse(readFileSync(at(...parts), "utf8"));

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPOSITORY = "https://github.com/Kamtomir/mainstay";
/** plugin.json keys that load components. The plugin declares none: its only component is skills/. */
const COMPONENT_KEYS = ["commands", "agents", "skills", "hooks", "mcpServers", "lspServers", "outputStyles", "workflows", "themes", "monitors"];

const marketplace = readJson(".claude-plugin", "marketplace.json");
const entry = marketplace.plugins?.[0] ?? {};
const PLUGIN = at(String(entry.source ?? "missing"));
const plugin = readJson(String(entry.source ?? "missing"), ".claude-plugin", "plugin.json");
const pkg = readJson("package.json");

describe("marketplace.json", () => {
  it("names the marketplace and its owner", () => {
    expect(marketplace.name).toMatch(KEBAB);
    expect(typeof marketplace.owner?.name).toBe("string");
    expect(marketplace.owner.name.trim()).not.toBe("");
  });

  it("lists exactly this plugin, from its folder in this repository", () => {
    expect(marketplace.plugins).toHaveLength(1);
    expect(entry.name).toBe(plugin.name);
    expect(entry.source).toBe("./plugins/mainstay");
    expect(String(entry.description ?? "").trim()).not.toBe("");
    expect(existsSync(join(PLUGIN, ".claude-plugin", "plugin.json"))).toBe(true);
  });

  it("adds no components to the plugin from the marketplace side", () => {
    expect(Object.keys(entry).filter((key) => COMPONENT_KEYS.includes(key))).toEqual([]);
  });
});

describe("plugin.json", () => {
  it("has the fields Claude Code reads", () => {
    expect(plugin.name).toBe("mainstay");
    expect(plugin.name).toMatch(KEBAB);
    expect(String(plugin.description ?? "").trim()).not.toBe("");
    expect(String(plugin.author?.name ?? "").trim()).not.toBe("");
    expect(plugin.license).toBe(pkg.license);
    expect(plugin.homepage).toBe(REPOSITORY);
    expect(plugin.repository).toBe(REPOSITORY);
  });

  it("sets no version, so every pushed commit is a new version", () => {
    expect(plugin.version, "a fixed version pins users to their first install").toBeUndefined();
    expect(entry.version, "a fixed version pins users to their first install").toBeUndefined();
  });

  it("declares no component paths: the plugin loads its skills folder only", () => {
    expect(Object.keys(plugin).filter((key) => COMPONENT_KEYS.includes(key))).toEqual([]);
  });
});

describe("the plugin folder", () => {
  it("holds the manifest and the skills, nothing else", () => {
    expect(
      readdirSync(PLUGIN).sort(),
      "no package.json or lockfile (Claude Code would install dependencies on the user's machine), no hooks, MCP servers, agents or commands",
    ).toEqual([".claude-plugin", "skills"]);
    expect(readdirSync(join(PLUGIN, ".claude-plugin"))).toEqual(["plugin.json"]);
  });
});

/** A skill's frontmatter and body, split at the closing `---`. */
function readSkill(dir: string): { meta: Record<string, unknown>; body: string } {
  const text = readFileSync(join(PLUGIN, "skills", dir, "SKILL.md"), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`skills/${dir}/SKILL.md has no frontmatter`);
  return { meta: parse(match[1]) as Record<string, unknown>, body: match[2] };
}

const skills = readdirSync(join(PLUGIN, "skills")).sort();

describe("skills", () => {
  it("are the setup skill", () => {
    expect(skills).toEqual(["setup"]);
  });

  it.each(skills)("%s: its name is its folder and its description fits the skill listing", (dir) => {
    const { meta } = readSkill(dir);
    expect(meta.name).toBe(dir);
    expect(meta.name).toMatch(KEBAB);
    const description = String(meta.description ?? "").trim();
    expect(description).not.toBe("");
    // Claude Code cuts a skill's description at 1,536 characters in the listing.
    expect(description.length).toBeLessThanOrEqual(1536);
  });

  it("setup runs only when the person types /mainstay:setup: it writes files", () => {
    expect(readSkill("setup").meta["disable-model-invocation"]).toBe(true);
  });

  it.each(skills)("%s: every bundled path it names exists", (dir) => {
    const { body } = readSkill(dir);
    const named = [...body.matchAll(/\$\{CLAUDE_SKILL_DIR\}"?((?:\/[\w.*-]+)*)/g)].map((m) => m[1].replace(/\/\*$/, "").replace(/\.+$/, ""));
    expect(named.length).toBeGreaterThan(0);
    const missing = named.filter((rel) => !existsSync(join(PLUGIN, "skills", dir, rel)));
    expect(missing, "the skill names a file it does not ship").toEqual([]);
  });

  it.each(skills)("%s: every link into this repository resolves", (dir) => {
    const { body } = readSkill(dir);
    const links = [...body.matchAll(/https:\/\/github\.com\/Kamtomir\/mainstay\/(?:blob|tree)\/main\/([\w./-]+[\w-])/g)].map((m) => m[1]);
    expect(links.filter((rel) => !existsSync(at(rel))), "dead links into the repository").toEqual([]);
  });
});

describe("the plugin's copy of the harness", () => {
  const copy = at(HARNESS_COPY);
  const wanted: string[] = harnessFiles(ROOT);

  it("is the guard helpers without tests or examples, plus the templates the skill installs", () => {
    expect(wanted).toContain("guards/core.ts");
    expect(wanted).toContain("guards/ratchet.ts");
    expect(wanted).toContain("ci/guard-first.yml");
    expect(wanted).toContain("agent/pre-push.sh");
    expect(wanted.filter((rel) => rel.endsWith(".test.ts") || rel.includes("/examples/"))).toEqual([]);
  });

  it.each(wanted)("%s is identical to its source", (rel) => {
    expect(sameFile(at(rel), join(copy, rel)), `the plugin's copy of ${rel} differs from the source: run npm run plugin:sync`).toBe(true);
  });

  it("holds nothing else", () => {
    expect(filesUnder(copy).filter((rel: string) => !wanted.includes(rel)), "copies without a source: run npm run plugin:sync").toEqual([]);
  });
});

describe("scripts/sync-plugin.mjs", () => {
  it("copies the helpers and templates, keeps the executable bit, and deletes copies whose source is gone", () => {
    const root = mkdtempSync(join(tmpdir(), "mainstay-sync-"));
    const write = (rel: string, text: string, mode = 0o644) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
      chmodSync(join(root, rel), mode);
    };
    write("guards/core.ts", "export const core = 1;\n");
    write("guards/README.md", "# guards\n");
    write("guards/core.test.ts", "a test, never shipped\n");
    write("guards/examples/demo/demo.guard.test.ts", "a demo, never shipped\n");
    write("ci/guard-first.yml", "name: CI\n");
    write("ci/should-run.sh", "#!/usr/bin/env bash\n", 0o755);
    write("agent/CLAUDE.md.template", "# {{PROJECT}}\n");
    write("agent/pre-push.sh", "#!/usr/bin/env bash\n", 0o755);
    write("agent/PR_CHECKLIST.md", "# PR checklist\n");
    write(`${HARNESS_COPY}/guards/retired.ts`, "a helper that no longer exists\n");

    const first = syncPlugin(root);
    expect(first.removed).toEqual(["guards/retired.ts"]);
    expect(first.copied).toEqual(harnessFiles(root));
    expect(filesUnder(join(root, HARNESS_COPY))).toEqual([
      "agent/CLAUDE.md.template",
      "agent/PR_CHECKLIST.md",
      "agent/pre-push.sh",
      "ci/guard-first.yml",
      "ci/should-run.sh",
      "guards/README.md",
      "guards/core.ts",
    ]);
    expect(statSync(join(root, HARNESS_COPY, "ci/should-run.sh")).mode & 0o111).not.toBe(0);
    expect(statSync(join(root, HARNESS_COPY, "guards/core.ts")).mode & 0o111).toBe(0);

    write("guards/core.ts", "export const core = 2;\n");
    expect(syncPlugin(root)).toEqual({ copied: ["guards/core.ts"], removed: [] });
    expect(syncPlugin(root)).toEqual({ copied: [], removed: [] });
  });
});

describe("README", () => {
  const readme = readFileSync(at("README.md"), "utf8");

  it("installs with the two commands this marketplace and plugin answer to", () => {
    expect(readme).toContain(`/plugin marketplace add ${REPOSITORY.replace("https://github.com/", "")}`);
    expect(readme).toContain(`/plugin install ${plugin.name}@${marketplace.name}`);
  });

  it("names the setup skill as Claude Code invokes it", () => {
    expect(readme).toContain(`/${plugin.name}:setup`);
  });
});
