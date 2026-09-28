import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

function dirHash(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  files.sort((a, b) => a.slice(dir.length).localeCompare(b.slice(dir.length)));
  const h = createHash("sha256");
  for (const f of files) {
    h.update(f.slice(dir.length).replaceAll("\\", "/"));
    h.update(readFileSync(f, "utf8").replaceAll("\r\n", "\n"));
  }
  return h.digest("hex");
}

const [a, b] = process.argv.slice(2);
if (!existsSync(a) || !existsSync(b)) {
  console.log("missing");
  process.exit(2);
}
console.log(dirHash(a) === dirHash(b) ? "identical" : "different");
