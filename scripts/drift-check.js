// Drift check — fails when an @cosyte/* parser repo diverges from the canonical baseline.
//
// Zero-dep (Node stdlib only). Run from the meta-repo root:
//   node config/scripts/drift-check.js        (or: pnpm --dir config drift)
// It resolves the meta-repo as config's parent, reads drift-manifest.json, and checks each target
// repo's package.json / tsconfig.json / .github/workflows. Exits non-zero on any drift.
//
// NOTE: until Phases D/E migrate each parser onto the standard, this is EXPECTED to report drift —
// that output IS the per-repo migration worklist. Greenfield repos with no package.json are skipped.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const configRoot = resolve(scriptDir, ".."); // .../config
const umbrellaRoot = resolve(configRoot, ".."); // meta-repo root
const manifest = readJson(join(configRoot, "drift-manifest.json"));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function tryReadJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

function cleanVersion(spec) {
  return String(spec)
    .replace(/^[\^~=>< ]+/, "")
    .trim();
}

// "5.9" matches "^5.9.3"; "10" matches "10.2.0" but not "1.0.0"; "" means presence-only.
function versionMatches(spec, want) {
  if (want === "") return true;
  const have = cleanVersion(spec).split(".");
  return want.split(".").every((part, i) => have[i] === part);
}

function checkRepo(name) {
  const repoDir = join(umbrellaRoot, name);
  const pkg = tryReadJson(join(repoDir, "package.json"));
  if (!pkg) {
    return {
      name,
      skipped: true,
      reason: existsSync(repoDir) ? "no package.json (greenfield)" : "not present",
    };
  }

  const violations = [];
  const dev = pkg.devDependencies ?? {};

  // packageManager + Node engine
  if (!String(pkg.packageManager ?? "").startsWith(manifest.packageManagerPrefix)) {
    violations.push(
      `packageManager: want ${manifest.packageManagerPrefix}.x, got ${pkg.packageManager ?? "(none)"}`,
    );
  }
  const engineMajor = Number(/(\d+)/.exec(String(pkg.engines?.node ?? ""))?.[1] ?? 0);
  if (engineMajor < manifest.nodeEngineMinMajor) {
    violations.push(
      `engines.node: want >=${manifest.nodeEngineMinMajor}, got "${pkg.engines?.node ?? "(none)"}"`,
    );
  }

  // prettier config
  if (pkg.prettier !== manifest.prettier) {
    violations.push(
      `prettier: want "${manifest.prettier}", got ${JSON.stringify(pkg.prettier ?? null)}`,
    );
  }

  // required scripts + the --max-warnings gate
  for (const script of manifest.requiredScripts) {
    if (!pkg.scripts?.[script]) violations.push(`scripts.${script}: missing`);
  }
  if (pkg.scripts?.lint && !pkg.scripts.lint.includes(manifest.lintMustInclude)) {
    violations.push(`scripts.lint: must include ${manifest.lintMustInclude}`);
  }

  // devDep versions
  for (const [depName, want] of Object.entries(manifest.devDepVersions)) {
    const spec = dev[depName];
    if (!spec) {
      violations.push(`devDep ${depName}: missing (want ${want || "any"})`);
    } else if (!versionMatches(spec, want)) {
      violations.push(`devDep ${depName}: want ${want}.x, got ${spec}`);
    }
  }

  // shared config packages present
  for (const depName of manifest.requiredCosyteConfigDeps) {
    if (!dev[depName]) violations.push(`devDep ${depName}: missing`);
  }

  // exact pins (one summary line; @types/node and @cosyte/* may stay caret)
  const caretPinned = Object.entries(dev)
    .filter(
      ([depName, spec]) =>
        !manifest.caretAllowed.includes(depName) &&
        !depName.startsWith("@cosyte/") &&
        /^[\^~]/.test(String(spec)),
    )
    .map(([depName]) => depName);
  if (caretPinned.length > 0) {
    violations.push(
      `exact-pin: ${caretPinned.length} devDep(s) use ^/~ — ${caretPinned.join(", ")}`,
    );
  }

  // tsconfig extends the shared base
  const tsconfig = tryReadJson(join(repoDir, "tsconfig.json"));
  if (!tsconfig) {
    violations.push("tsconfig.json: missing");
  } else if (tsconfig.extends !== manifest.tsconfigExtends) {
    violations.push(
      `tsconfig extends: want "${manifest.tsconfigExtends}", got ${JSON.stringify(tsconfig.extends ?? null)}`,
    );
  }

  // required workflows
  const wfDir = join(repoDir, ".github", "workflows");
  const workflows = existsSync(wfDir) ? readdirSync(wfDir) : [];
  for (const workflow of manifest.requiredWorkflows) {
    if (!workflows.includes(workflow)) violations.push(`.github/workflows/${workflow}: missing`);
  }

  return { name, violations };
}

const results = manifest.targets.map(checkRepo);

let checked = 0;
let drifted = 0;
let skipped = 0;
for (const result of results) {
  if (result.skipped) {
    skipped += 1;
    console.log(`\n• ${result.name}: SKIP (${result.reason})`);
    continue;
  }
  checked += 1;
  if (result.violations.length === 0) {
    console.log(`\n✓ ${result.name}: matches the baseline`);
    continue;
  }
  drifted += 1;
  console.log(`\n✗ ${result.name}: ${result.violations.length} drift(s)`);
  for (const violation of result.violations) console.log(`    - ${violation}`);
}

console.log(`\n${"—".repeat(60)}`);
console.log(`checked ${checked} repo(s), ${drifted} with drift, ${skipped} skipped (greenfield)`);
process.exit(drifted > 0 ? 1 : 0);
