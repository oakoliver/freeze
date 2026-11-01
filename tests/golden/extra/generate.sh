#!/bin/bash
# Regenerate the extra goldens with the Go binary:
#   FREEZE_GO=/path/to/freeze tests/golden/extra/generate.sh
# (built from charmbracelet/freeze main at 65acb1e with `go build`).
set -e
cd "$(dirname "$0")/../../.."
bun -e '
const cases = JSON.parse(require("fs").readFileSync("tests/golden/extra/cases.json", "utf8"));
const { spawnSync } = require("child_process");
for (const c of cases) {
  const out = `tests/golden/extra/${c.output}.svg`;
  const args = [...(c.input ? [c.input] : []), ...c.flags, "--output", out];
  const r = spawnSync(process.env.FREEZE_GO, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (r.status !== 0) { console.error(c.output, r.stdout, r.stderr); process.exit(1); }
  const fs = require("fs");
  fs.writeFileSync(out, fs.readFileSync(out, "utf8").replace(/base64,[A-Za-z0-9+\/=]*\)/, "base64,{{FONT}})"));
  console.log("wrote", out);
}'
