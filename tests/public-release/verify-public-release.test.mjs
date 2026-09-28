import test from "node:test";
import assert from "node:assert/strict";
import {
  scanTextEntries,
} from "../../scripts/verify-public-release.mjs";

function scan(entries) {
  return scanTextEntries(entries.map(([path, content]) => ({ path, content })));
}

test("rejects concrete personal home paths on Windows, macOS, and Linux", () => {
  const findings = scan([
    ["AGENTS.md", "root " + ["C:", "Users", "alice", ".agents", "skills"].join("\\")],
    ["docs/a.md", ["", "Users", "alice", ".agents", "skills"].join("/")],
    ["docs/b.md", ["", "home", "alice", ".agents", "skills"].join("/")],
  ]);
  assert.equal(findings.filter((f) => f.rule === "personal-home-path").length, 3);
});

test("rejects operator worktree and Cursor transcript state paths", () => {
  const findings = scan([
    ["AGENTS.md", "D:" + "\\" + "codex-worktrees" + "\\"],
    [".cursor/hooks/state/index.json", ["C:", "Users", "alice", ".cursor", "projects", "c-Users-alice-agents", "agent-transcripts", "11111111-1111-4111-8111-111111111111", "run.jsonl"].join("\\")],
  ]);
  assert.ok(findings.some((f) => f.rule === "operator-path"));
  assert.ok(findings.some((f) => f.rule === "transcript-state"));
});

test("rejects private LAN endpoints used as concrete operator configuration", () => {
  const findings = scan([
    ["docs/device.md", `ssh shell@${[192, 168, 178, 89].join(".")} -p 8022`],
    ["config/example.json", `{"host":"${[10, 0, 0, 24].join(".")}"}`],
  ]);
  assert.equal(findings.filter((f) => f.rule === "private-network-endpoint").length, 2);
});

test("rejects high-confidence secret material", () => {
  const findings = scan([
    ["private.pem", "-----BEGIN " + "PRIVATE KEY-----\nnot-a-real-key"],
    ["config.txt", "token=" + "gh" + "p_abcdefghijklmnopqrstuvwxyz1234567890"],
    ["aws.txt", "AWS_ACCESS_KEY_ID=" + "AK" + "IAABCDEFGHIJKLMNOP"],
  ]);
  assert.ok(findings.some((f) => f.rule === "private-key"));
  assert.ok(findings.some((f) => f.rule === "github-token"));
  assert.ok(findings.some((f) => f.rule === "aws-access-key"));
});

test("allows placeholders, localhost, platform env vars, and public attribution", () => {
  const findings = scan([
    ["docs/example.md", "C:\\Users\\<user>\\.agents and /home/<user>/.agents"],
    ["docs/local.md", "http://localhost:3000"],
    ["authority-host/windows/README.md", "%LOCALAPPDATA%\\GitHubDeliveryAuthority"],
    ["skills/github-delivery/SKILL.md", "https://github.com/Wibias/github-delivery"],
    ["docs/token.md", "token=<token>\nTOKEN=YOUR_TOKEN"],
  ]);
  assert.deepEqual(findings, []);
});

test("rejects noncanonical shared read-github aliases", () => {
  const findings = scan([
    ["skills/operator-read-github/SKILL.md", "name: operator-read-github"],
  ]);
  assert.ok(findings.some((f) => f.rule === "noncanonical-shared-skill-name"));
});

test("findings are stable and sorted", () => {
  const findings = scan([
    ["z.md", ["", "home", "zed", ".agents"].join("/")],
    ["a.md", ["C:", "Users", "alice", ".agents"].join("\\")],
  ]);
  assert.deepEqual(findings.map((f) => f.path), ["a.md", "z.md"]);
});


test("rejects private schema namespaces", () => {
  const findings = scan([
    ["schema.json", `{"$id":"https://private${"."}local/example.schema.json"}`],
  ]);
  assert.ok(findings.some((f) => f.rule === "private-namespace"));
});


test("rejects concrete operator work paths outside home directories", () => {
  const segmentA = ["E:", "work", "operator", "cache"].join("\\");
  const segmentB = ["D:", "projects", "maintainer", "tools"].join("\\");
  const findings = scan([
    ["docs/a.md", segmentA],
    ["docs/b.md", segmentB],
  ]);
  assert.equal(findings.filter((f) => f.rule === "operator-work-path").length, 2);
});


test("allows ordinary web route paths that are not filesystem identities", () => {
  assert.deepEqual(scan([["docs/api.md", "Connect to /socket/ for live updates."]]), []);
});


test("rejects unconditional Windows defaults in shared skills", () => {
  const values = [
    ["skills/a/SKILL.md", ["Hub", "shell:", "PowerShell"].join(" ")],
    ["skills/b/SKILL.md", ["Skill", "path", "(Windows", "hub)"].join(" ")],
    ["skills/c/SKILL.md", ["available", "locally", "on", "Windows"].join(" ")],
    ["skills/d/SKILL.md", ["Resolve", "the", "plugin", "root", "from", "$env:USERPROFILE"].join(" ")],
    ["skills/e/SKILL.md", ["Scaffold", "(Windows", "—", "use", "python)"].join(" ")],
    ["skills/f/SKILL.md", ["#", "Windows", "hub"].join(" ")],
  ];
  const findings = scan(values);
  assert.equal(findings.filter((f) => f.rule === "unconditional-host-default").length, values.length);
});

test("allows conditional operating-system guidance", () => {
  const findings = scan([
    ["skills/a/SKILL.md", "On Windows use PowerShell; on POSIX use the shell already provided by the host."],
    ["skills/b/SKILL.md", "Use ~/.agents as the semantic Hub root and resolve it with the active operating system."],
  ]);
  assert.deepEqual(findings, []);
});
