#!/usr/bin/env node
// scripts/credential-surface.mjs
//
// DECLARE THE PUBLISH PATH'S CREDENTIAL SURFACE, AND REFUSE A RELEASE WORKFLOW THAT DISAGREES WITH
// THE DECLARATION IN EITHER DIRECTION.
//
// THE DEFECT CLASS. Until now the credentials this repository publishes with were described only in
// prose: long comment blocks in `.github/workflows/release.yml` and narrative sections of
// RELEASING.md. Nothing machine-checked that the described surface was the actual surface. A future
// edit can add a secret, hoist a token from a single step to a whole job, widen a permissions grant,
// or drop a credential the docs still promise, and every one of those rides a GREEN build. That is
// the same silent-drift class this repo already spent two incidents closing on the publish path
// itself (the empty-changeset green run of 2026-07-31, run 30640138565, and the release-body dump of
// the same day), applied to the one input where the failure is not a bad release but a leaked or
// over-scoped publish credential.
//
// WHAT THIS IS. `.github/credential-surface.json` is the declaration: every credential the publish
// path consumes, and for each one the token class it must be issued at, the single storage location
// it may occupy, the job and step permitted to receive it, and the condition that retires it. This
// script compares that declaration against the release workflow and against the operator
// documentation, and fails on any disagreement in EITHER direction:
//
//   * a secret the workflow references and the declaration does not name;
//   * a credential the declaration names that no longer appears where it says it does;
//   * a credential exposed more broadly than declared (workflow-level or job-level `env`, another
//     job, another step, another route, or a value passed where only a presence test was declared);
//   * a permissions grant on `GITHUB_TOKEN` that is wider than declared, or a job that declares no
//     permissions block at all and therefore silently inherits the workflow-level one;
//   * a registry-reaching job that does not declare the protected deployment environment;
//   * an issued credential form the release run's log scrubbing does not cover;
//   * a declared credential the rotation / revocation / compensating-action documentation omits.
//
// IT RUNS BEFORE ANYONE IS ASKED FOR ANYTHING. `ci.yml`'s `verify` job is a REQUIRED status check in
// this repository's `config-ci-required-checks` ruleset, so this gate is wired there, next to the
// changeset guard and the release-notes gate, and it runs on every pull request. A credential-surface
// regression is refused at merge time rather than at deploy-approval time. Like those two gates it is
// zero-dependency node so it can run before `pnpm install`.
//
// WHY IT PARSES THE WORKFLOW RATHER THAN GREPPING IT. Half of what this check has to answer is a
// question about SCOPE ("is this secret reachable by one step or by every job"), and scope is
// structure. A grep also cannot tell prose from wiring: `release.yml`'s header comments name
// `NPM_TOKEN`, `NODE_AUTH_TOKEN` and `RELEASE_PR_TOKEN` several times in ordinary English, and a
// text scan would report every one of those as an exposure. So the file is parsed, comments and all,
// by the deliberately small YAML subset reader below.
//
// WHAT THIS DELIBERATELY CANNOT CHECK. Whether the `release` environment actually carries a required
// reviewer and a `main`-only branch policy is a GitHub-side fact, and RELEASING.md records the trap:
// referencing an environment that does not exist makes GitHub silently auto-create an UNPROTECTED
// one of that name. No checkout can see that. This gate asserts that the registry-reaching job
// REFERENCES the declared environment; the declaration's `environmentNote` says plainly that the
// protection itself is verified out of band, and RELEASING.md carries the API call that sets it.
//
// EXIT CODES, and they are a contract:
//   0  the declaration and the workflow and the documentation agree.
//   1  at least one disagreement was found, or the comparison could not be made at all (an absent,
//      empty, or unparseable declaration; an unreadable or unparseable workflow). Both are check
//      failures: refusing to report success on having compared nothing is the point.
//   2  this script was invoked wrongly. Kept distinct from 1 so a typo in a CI line cannot read as
//      a clean surface, the same separation `scripts/changeset-guard.mjs` maintains.
//
// Usage:
//   node scripts/credential-surface.mjs [--repo <dir>] [--declaration <file>] [--workflow <file>]
//                                       [--docs <file>]

import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { isCliEntrypoint } from "../packages/script-utils/index.js";

export const DEFAULT_DECLARATION = ".github/credential-surface.json";

/** Bullet labels every declared credential's documented procedure must carry, in this exact form. */
const PROCEDURE_LABELS = ["Issue", "Install", "Verify", "Revoke", "Compensating action"];

/**
 * Statements the credential documentation must make once, at section level rather than per
 * credential. The labels are fixed HERE rather than in the declaration on purpose: a declaration
 * that named the sentences it wanted would be grading its own homework.
 */
const SECTION_STATEMENTS = [
  { label: "No automated rollback", code: "docs-missing-no-rollback" },
  { label: "A published version is permanent", code: "docs-missing-registry-permanence" },
];

/** The shortest run of text after a documented label that counts as an actual procedure. */
const MIN_LABEL_TEXT = 20;

/** Storage locations a credential may declare. One credential, one home: see AC1. */
const STORAGE_LOCATIONS = ["organization", "repository", "environment", "github-provided"];

/** How a credential reaches the thing that consumes it. */
const EXPOSURE_ROUTES = ["env", "with"];

/** What the workflow does with the credential at an exposure. */
const EXPOSURE_MODES = ["value", "presence-test"];

export class InvocationError extends Error {}

export class WorkflowParseError extends Error {
  /**
   * @param message What could not be read.
   * @param line The 1-based line number it was read at.
   */
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.line = line;
  }
}

// ---------------------------------------------------------------------------
// A YAML SUBSET READER FOR GITHUB WORKFLOW FILES
//
// Small on purpose, and it REFUSES rather than guesses. Everything `.github/workflows/*.yml` in this
// repository uses is here: block mappings, block sequences, block scalars (`|`, `>` and their chomp
// indicators), single- and double-quoted scalars, flow sequences, and comments in every position.
// Anchors, aliases, merge keys, flow mappings, tab indentation and multi-document streams are NOT,
// and each throws a WorkflowParseError naming the line, which the caller turns into a check failure.
// That is the right failure direction for a gate: a workflow this reader cannot understand is a
// workflow this gate cannot vouch for, and it says so instead of passing.
//
// Nodes carry their source line, because "report the undeclared secret AND where it was found" is
// half of what the acceptance criteria ask for.
// ---------------------------------------------------------------------------

const BLOCK_SCALAR_HEADER = /^[|>][-+]?\d*$/;
const MAPPING_KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:#\s][^:]*?)\s*:(?:\s+(.*))?$/;

/**
 * Strip an inline `#` comment from a single line of YAML, respecting quotes and `${{ }}` expressions.
 *
 * @param text The line's content, with its leading indentation already removed.
 * @returns The content with any trailing comment removed.
 */
function stripInlineComment(text) {
  let quote = null;
  let expression = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote !== null) {
      if (quote === '"' && char === "\\") {
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (text.startsWith("${{", i)) {
      expression += 1;
      i += 2;
      continue;
    }
    if (expression > 0 && text.startsWith("}}", i)) {
      expression -= 1;
      i += 1;
      continue;
    }
    if (char === "#" && expression === 0 && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text.trimEnd();
}

/**
 * @param raw A raw source line.
 * @returns How many leading spaces it carries.
 */
function indentOf(raw) {
  let i = 0;
  while (i < raw.length && raw[i] === " ") i += 1;
  return i;
}

/**
 * @param raw A raw source line.
 * @returns Whether the parser should step over it entirely (blank, or a whole-line comment).
 */
function isIgnorable(raw) {
  const trimmed = raw.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/**
 * Advance past blank lines and whole-line comments.
 *
 * @param state The parser cursor.
 */
function skipIgnorable(state) {
  while (state.i < state.lines.length && isIgnorable(state.lines[state.i].raw)) state.i += 1;
}

/**
 * Remove the quoting from a scalar, if it carries any.
 *
 * @param text The scalar as written.
 * @returns Its string value.
 */
function unquote(text) {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

/**
 * Split the inside of a flow sequence on commas that are not inside quotes.
 *
 * @param inner The text between `[` and `]`.
 * @returns The pieces, untrimmed.
 */
function splitFlow(inner) {
  const pieces = [];
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ",") {
      pieces.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(inner.slice(start));
  return pieces;
}

/**
 * Read a value written on the same line as its key.
 *
 * @param text The value as written.
 * @param line The 1-based source line.
 * @returns A scalar or sequence node.
 */
function parseFlowValue(text, line) {
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new WorkflowParseError("unterminated flow sequence", line);
    const inner = text.slice(1, -1).trim();
    if (inner === "") return { kind: "seq", line, items: [] };
    return {
      kind: "seq",
      line,
      items: splitFlow(inner).map((p) => parseFlowValue(p.trim(), line)),
    };
  }
  if (text.startsWith("{")) throw new WorkflowParseError("flow mappings are not supported", line);
  if (text.startsWith("&") || text.startsWith("*") || text.startsWith("<<")) {
    throw new WorkflowParseError("anchors, aliases and merge keys are not supported", line);
  }
  return { kind: "scalar", line, value: unquote(text) };
}

/**
 * Read a `|` or `>` block scalar body.
 *
 * @param state The parser cursor, positioned on the first body line.
 * @param indent The indentation of the KEY that introduced the block.
 * @param line The key's source line.
 * @returns A scalar node carrying the body, dedented to its own first line.
 */
function readBlockScalar(state, indent, line) {
  const body = [];
  let contentIndent = null;
  while (state.i < state.lines.length) {
    const next = state.lines[state.i];
    if (next.raw.trim() === "") {
      body.push("");
      state.i += 1;
      continue;
    }
    const nextIndent = indentOf(next.raw);
    if (nextIndent <= indent) break;
    if (contentIndent === null) contentIndent = nextIndent;
    body.push(next.raw.slice(Math.min(contentIndent, nextIndent)));
    state.i += 1;
  }
  while (body.length > 0 && body[body.length - 1] === "") body.pop();
  return { kind: "scalar", line, value: body.join("\n") };
}

/**
 * Read the value of a key that had nothing after its colon.
 *
 * @param state The parser cursor.
 * @param indent The key's indentation.
 * @param line The key's source line.
 * @returns The nested node, or a null scalar when the key has no value at all.
 */
function readNested(state, indent, line) {
  skipIgnorable(state);
  const next = state.lines[state.i];
  if (next === undefined) return { kind: "scalar", line, value: null };
  const nextIndent = indentOf(next.raw);
  if (nextIndent < indent) return { kind: "scalar", line, value: null };
  if (nextIndent === indent) {
    // A block sequence may sit at the same indentation as the key that owns it. Legal YAML, and
    // worth supporting so a reformatted workflow does not read as unparseable.
    const text = stripInlineComment(next.raw.slice(nextIndent));
    if (text === "-" || text.startsWith("- ")) return parseSequence(state, indent);
    return { kind: "scalar", line, value: null };
  }
  return parseBlock(state, nextIndent);
}

/**
 * Read a block mapping.
 *
 * @param state The parser cursor.
 * @param indent The mapping's indentation.
 * @returns A map node.
 */
function parseMapping(state, indent) {
  const entries = new Map();
  const startLine = state.lines[state.i].n;
  for (;;) {
    skipIgnorable(state);
    const line = state.lines[state.i];
    if (line === undefined) break;
    const lineIndent = indentOf(line.raw);
    if (lineIndent < indent) break;
    if (lineIndent > indent) throw new WorkflowParseError("unexpected indentation", line.n);
    const text = stripInlineComment(line.raw.slice(indent));
    if (text === "" || text === "-" || text.startsWith("- ")) break;
    if (text === "---" || text === "...") {
      throw new WorkflowParseError("multi-document streams are not supported", line.n);
    }
    const match = MAPPING_KEY.exec(text);
    if (match === null) {
      throw new WorkflowParseError(
        `could not read a mapping key from ${JSON.stringify(text)}`,
        line.n,
      );
    }
    const key = unquote(match[1]);
    const rest = match[2] === undefined ? "" : match[2].trim();
    state.i += 1;
    let value;
    if (BLOCK_SCALAR_HEADER.test(rest)) {
      value = readBlockScalar(state, indent, line.n);
    } else if (rest === "") {
      value = readNested(state, indent, line.n);
    } else {
      value = parseFlowValue(rest, line.n);
    }
    if (entries.has(key))
      throw new WorkflowParseError(`duplicate key ${JSON.stringify(key)}`, line.n);
    entries.set(key, value);
  }
  return { kind: "map", line: startLine, entries };
}

/**
 * Read a block sequence.
 *
 * @param state The parser cursor.
 * @param indent The indentation of the `-` markers.
 * @returns A seq node.
 */
function parseSequence(state, indent) {
  const items = [];
  const startLine = state.lines[state.i].n;
  for (;;) {
    skipIgnorable(state);
    const line = state.lines[state.i];
    if (line === undefined) break;
    const lineIndent = indentOf(line.raw);
    if (lineIndent < indent) break;
    if (lineIndent > indent) throw new WorkflowParseError("unexpected indentation", line.n);
    const text = stripInlineComment(line.raw.slice(indent));
    if (text !== "-" && !text.startsWith("- ")) break;
    if (text === "-") {
      state.i += 1;
      items.push(readNested(state, indent, line.n));
      continue;
    }
    const afterDash = text.slice(1);
    const offset = 1 + (afterDash.length - afterDash.trimStart().length);
    const itemIndent = indent + offset;
    // Rewrite the `- ` marker as padding so the item parses as an ordinary block at its own
    // indentation. The line number is preserved, which is what every finding is reported against.
    state.lines[state.i] = { n: line.n, raw: " ".repeat(itemIndent) + line.raw.slice(itemIndent) };
    items.push(parseBlock(state, itemIndent));
  }
  return { kind: "seq", line: startLine, items };
}

/**
 * Read whichever block construct starts at this indentation.
 *
 * @param state The parser cursor.
 * @param indent The construct's indentation.
 * @returns The node.
 */
function parseBlock(state, indent) {
  skipIgnorable(state);
  const line = state.lines[state.i];
  if (line === undefined)
    throw new WorkflowParseError("unexpected end of file", state.lines.length);
  const text = stripInlineComment(line.raw.slice(indent));
  if (text === "-" || text.startsWith("- ")) return parseSequence(state, indent);
  return parseMapping(state, indent);
}

/**
 * Parse a GitHub workflow file.
 *
 * @param text The file's contents.
 * @returns The document's root node.
 */
export function parseWorkflow(text) {
  const lines = text.split("\n").map((raw, index) => ({ n: index + 1, raw }));
  for (const line of lines) {
    if (/^ *\t/.test(line.raw)) {
      throw new WorkflowParseError("tab indentation is not valid YAML", line.n);
    }
  }
  const state = { lines, i: 0 };
  skipIgnorable(state);
  if (state.i < lines.length && lines[state.i].raw.trim() === "---") {
    state.i += 1;
    skipIgnorable(state);
  }
  if (state.i >= lines.length) throw new WorkflowParseError("the workflow is empty", 1);
  const root = parseBlock(state, indentOf(lines[state.i].raw));
  skipIgnorable(state);
  if (state.i < lines.length) {
    throw new WorkflowParseError("trailing content this reader cannot place", lines[state.i].n);
  }
  if (root.kind !== "map") throw new WorkflowParseError("a workflow must be a mapping", 1);
  return root;
}

/**
 * @param node A node, or undefined.
 * @param key The key to read.
 * @returns The child node, or undefined.
 */
function mapGet(node, key) {
  if (node === undefined || node.kind !== "map") return undefined;
  return node.entries.get(key);
}

/**
 * @param node A node, or undefined.
 * @returns Its string value, or undefined when it is not a scalar.
 */
function scalarOf(node) {
  if (node === undefined || node.kind !== "scalar") return undefined;
  return node.value ?? undefined;
}

/**
 * Walk every scalar in the tree, reporting the path it was reached by.
 *
 * @param node The node to walk.
 * @param path The path taken so far.
 * @param visit Called with (scalarNode, path) for every scalar.
 */
function walkScalars(node, path, visit) {
  if (node.kind === "scalar") {
    visit(node, path);
    return;
  }
  if (node.kind === "seq") {
    node.items.forEach((item, index) => walkScalars(item, [...path, index], visit));
    return;
  }
  for (const [key, value] of node.entries) walkScalars(value, [...path, key], visit);
}

// ---------------------------------------------------------------------------
// THE DECLARATION
// ---------------------------------------------------------------------------

/**
 * Validate the declaration's shape.
 *
 * A malformed declaration is a check FAILURE rather than a crash: the acceptance criterion is that
 * an absent, empty or unparseable declaration fails the check naming that condition, and a
 * declaration missing the fields the comparison needs is the same condition one layer in.
 *
 * @param declaration The parsed JSON.
 * @returns A list of problems; empty means valid.
 */
export function validateDeclaration(declaration) {
  const problems = [];
  if (declaration === null || typeof declaration !== "object" || Array.isArray(declaration)) {
    return ["the declaration must be a JSON object"];
  }

  const publishPath = declaration.publishPath;
  if (publishPath === undefined || typeof publishPath !== "object" || publishPath === null) {
    problems.push("`publishPath` is missing");
  } else {
    for (const field of ["workflow", "job", "environment", "command"]) {
      if (typeof publishPath[field] !== "string" || publishPath[field].trim() === "") {
        problems.push(`\`publishPath.${field}\` must be a non-empty string`);
      }
    }
  }

  const redaction = declaration.logRedaction;
  if (redaction === undefined || typeof redaction !== "object" || redaction === null) {
    problems.push("`logRedaction` is missing");
  } else {
    for (const field of ["job", "step"]) {
      if (typeof redaction[field] !== "string" || redaction[field].trim() === "") {
        problems.push(`\`logRedaction.${field}\` must be a non-empty string`);
      }
    }
  }

  const docs = declaration.documentation;
  if (docs === undefined || typeof docs !== "object" || docs === null) {
    problems.push("`documentation` is missing");
  } else {
    for (const field of ["file", "section"]) {
      if (typeof docs[field] !== "string" || docs[field].trim() === "") {
        problems.push(`\`documentation.${field}\` must be a non-empty string`);
      }
    }
  }

  if (!Array.isArray(declaration.credentials)) {
    problems.push("`credentials` must be an array");
  } else {
    declaration.credentials.forEach((credential, index) => {
      problems.push(...validateCredential(credential, index));
    });
  }

  if (declaration.settings !== undefined && !Array.isArray(declaration.settings)) {
    problems.push("`settings`, when present, must be an array");
  }
  for (const setting of declaration.settings ?? []) {
    if (typeof setting?.name !== "string" || setting.name.trim() === "") {
      problems.push("every entry in `settings` needs a non-empty `name`");
      continue;
    }
    if (typeof setting.value !== "string") {
      problems.push(`setting \`${setting.name}\` needs the \`value\` it must carry`);
    }
    problems.push(...validateExposures(setting.exposures, `setting \`${setting.name}\``));
  }

  return problems;
}

/**
 * @param credential One entry of `credentials`.
 * @param index Its position, for a message that can name it when `name` itself is missing.
 * @returns A list of problems.
 */
function validateCredential(credential, index) {
  const problems = [];
  if (credential === null || typeof credential !== "object" || Array.isArray(credential)) {
    return [`credentials[${index}] must be an object`];
  }
  const label =
    typeof credential.name === "string" && credential.name !== ""
      ? `credential \`${credential.name}\``
      : `credentials[${index}]`;
  if (typeof credential.name !== "string" || credential.name.trim() === "") {
    problems.push(`${label} needs a non-empty \`name\``);
  }
  for (const field of ["tokenClass", "retiredWhen"]) {
    if (typeof credential[field] !== "string" || credential[field].trim() === "") {
      problems.push(`${label} needs a non-empty \`${field}\``);
    }
  }
  if (!STORAGE_LOCATIONS.includes(credential.storage)) {
    problems.push(`${label} needs \`storage\` to be one of ${STORAGE_LOCATIONS.join(", ")}`);
  }
  for (const field of ["requiredForPublish", "registryAuth"]) {
    if (typeof credential[field] !== "boolean") {
      problems.push(`${label} needs \`${field}\` to be a boolean`);
    }
  }
  problems.push(...validateExposures(credential.exposures, label));
  if (!Array.isArray(credential.issuedForms)) {
    problems.push(`${label} needs \`issuedForms\` to be an array (empty is allowed, and explicit)`);
  } else {
    for (const form of credential.issuedForms) {
      if (
        typeof form?.id !== "string" ||
        typeof form?.pattern !== "string" ||
        form.pattern === ""
      ) {
        problems.push(`${label} has an issued form without an \`id\` and a non-empty \`pattern\``);
      }
    }
  }
  return problems;
}

/**
 * @param exposures The `exposures` array of a credential or a setting.
 * @param label How to name the owner in a problem message.
 * @returns A list of problems.
 */
function validateExposures(exposures, label) {
  const problems = [];
  if (!Array.isArray(exposures) || exposures.length === 0) {
    return [`${label} needs at least one \`exposures\` entry`];
  }
  for (const exposure of exposures) {
    if (exposure === null || typeof exposure !== "object") {
      problems.push(`${label} has an exposure that is not an object`);
      continue;
    }
    for (const field of ["job", "step", "name"]) {
      if (typeof exposure[field] !== "string" || exposure[field].trim() === "") {
        problems.push(`${label} has an exposure without a non-empty \`${field}\``);
      }
    }
    if (!EXPOSURE_ROUTES.includes(exposure.as)) {
      problems.push(
        `${label} has an exposure whose \`as\` is not one of ${EXPOSURE_ROUTES.join(", ")}`,
      );
    }
    if (exposure.mode !== undefined && !EXPOSURE_MODES.includes(exposure.mode)) {
      problems.push(
        `${label} has an exposure whose \`mode\` is not one of ${EXPOSURE_MODES.join(", ")}`,
      );
    }
  }
  return problems;
}

/**
 * Read and validate the declaration.
 *
 * @param path Absolute path to the declaration file.
 * @returns Either `{ ok: true, declaration }` or `{ ok: false, code, message }`.
 */
export function loadDeclaration(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        ok: false,
        code: "declaration-absent",
        message: `the credential declaration ${path} does not exist, so there is nothing to compare the release workflow against`,
      };
    }
    return {
      ok: false,
      code: "declaration-unreadable",
      message: `the credential declaration ${path} could not be read: ${error.message}`,
    };
  }
  if (text.trim() === "") {
    return {
      ok: false,
      code: "declaration-empty",
      message: `the credential declaration ${path} is empty`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      code: "declaration-unparseable",
      message: `the credential declaration ${path} is not valid JSON: ${error.message}`,
    };
  }
  const problems = validateDeclaration(parsed);
  if (problems.length > 0) {
    return {
      ok: false,
      code: "declaration-invalid",
      message: `the credential declaration ${path} does not carry the fields this check compares`,
      problems,
    };
  }
  if (parsed.credentials.length === 0) {
    return {
      ok: false,
      code: "declaration-empty",
      message: `the credential declaration ${path} names no credentials, and an empty declaration cannot be conformed to`,
    };
  }
  return { ok: true, declaration: parsed };
}

// ---------------------------------------------------------------------------
// THE COMPARISON
// ---------------------------------------------------------------------------

/**
 * Index every step of every job so exposures can be attributed to a named step.
 *
 * @param workflow The parsed workflow.
 * @returns A map from job id to `{ node, steps }`, where each step carries its id and line.
 */
function indexJobs(workflow) {
  const jobs = new Map();
  const jobsNode = mapGet(workflow, "jobs");
  if (jobsNode === undefined || jobsNode.kind !== "map") return jobs;
  for (const [jobId, jobNode] of jobsNode.entries) {
    const steps = [];
    const stepsNode = mapGet(jobNode, "steps");
    if (stepsNode !== undefined && stepsNode.kind === "seq") {
      stepsNode.items.forEach((step, index) => {
        const name = scalarOf(mapGet(step, "name"));
        const uses = scalarOf(mapGet(step, "uses"));
        const id = name ?? (uses !== undefined ? `uses:${uses}` : `#${index + 1}`);
        steps.push({ index, id, node: step, line: step.line });
      });
    }
    jobs.set(jobId, { node: jobNode, steps });
  }
  return jobs;
}

/**
 * Describe where in the workflow a path lands.
 *
 * @param path The path walkScalars reported.
 * @param jobs The job index.
 * @returns `{ level, job, step, as, name, where }`.
 */
function locate(path, jobs) {
  const tail = path[path.length - 2];
  const leaf = path[path.length - 1];
  const route = tail === "env" || tail === "with" ? tail : "inline";
  const name = route === "inline" ? String(leaf) : String(leaf);
  if (path[0] !== "jobs") {
    return { level: "workflow", job: null, step: null, as: route, name, where: path.join(".") };
  }
  const job = String(path[1]);
  if (path[2] !== "steps") {
    return { level: "job", job, step: null, as: route, name, where: path.join(".") };
  }
  const stepIndex = Number(path[3]);
  const step = jobs.get(job)?.steps[stepIndex];
  return {
    level: "step",
    job,
    step: step?.id ?? `#${stepIndex + 1}`,
    as: route,
    name,
    where: path.join("."),
  };
}

/**
 * @param location A located reference.
 * @returns A short human description of its scope.
 */
function describeScope(location) {
  if (location.level === "workflow") return `workflow-level \`${location.as}\``;
  if (location.level === "job") return `job-level \`${location.as}\` in job "${location.job}"`;
  return `step "${location.step}" of job "${location.job}" (\`${location.as}\`)`;
}

/**
 * @param exposure A declared exposure.
 * @returns A short human description of the scope it permits.
 */
function describeDeclaredScope(exposure) {
  return `step "${exposure.step}" of job "${exposure.job}" (\`${exposure.as}: ${exposure.name}\`)`;
}

/**
 * Collect every `secrets.NAME` reference the parsed workflow makes.
 *
 * @param workflow The parsed workflow.
 * @param jobs The job index.
 * @returns `{ references, opaque }`.
 */
function collectSecretReferences(workflow, jobs) {
  const references = [];
  const opaque = [];
  walkScalars(workflow, [], (node, path) => {
    if (typeof node.value !== "string" || !node.value.includes("secrets")) return;
    const location = locate(path, jobs);
    for (const match of node.value.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      references.push({ secret: match[1], location, line: node.line, text: node.value });
    }
    // `toJSON(secrets)` and `secrets[...]` hand out the whole context at once, which no
    // per-credential declaration can describe. Reported rather than ignored.
    if (/\bsecrets\s*\[/.test(node.value) || /toJSON\(\s*secrets\s*\)/.test(node.value)) {
      opaque.push({ location, line: node.line, text: node.value });
    }
  });
  return { references, opaque };
}

/**
 * Read the `permissions:` block of a node as a plain object.
 *
 * @param node A workflow or job node.
 * @returns `{ present, grants }`, where grants is null when the block is not a mapping.
 */
function readPermissions(node) {
  const permissions = mapGet(node, "permissions");
  if (permissions === undefined) return { present: false, grants: null };
  if (permissions.kind !== "map") {
    return { present: true, grants: null, scalar: scalarOf(permissions) ?? "" };
  }
  const grants = {};
  for (const [key, value] of permissions.entries) grants[key] = scalarOf(value) ?? "";
  return { present: true, grants };
}

/**
 * Compare two permission grant maps.
 *
 * @param declared What the declaration permits.
 * @param found What the workflow grants.
 * @returns A list of human descriptions of the differences.
 */
function diffGrants(declared, found) {
  const differences = [];
  for (const [scope, level] of Object.entries(found)) {
    if (!(scope in declared)) {
      differences.push(`grants \`${scope}: ${level}\`, which the declaration does not permit`);
    } else if (declared[scope] !== level) {
      differences.push(
        `grants \`${scope}: ${level}\` where the declaration permits \`${declared[scope]}\``,
      );
    }
  }
  for (const [scope, level] of Object.entries(declared)) {
    if (!(scope in found)) {
      differences.push(`does not grant \`${scope}: ${level}\`, which the declaration says it has`);
    }
  }
  return differences;
}

/**
 * @param node A job node.
 * @returns The deployment environment the job declares, or undefined.
 */
function environmentOf(node) {
  const environment = mapGet(node, "environment");
  if (environment === undefined) return undefined;
  if (environment.kind === "map") return scalarOf(mapGet(environment, "name"));
  return scalarOf(environment);
}

/**
 * Split a markdown document into sections keyed by heading text.
 *
 * @param text The markdown.
 * @returns A list of `{ level, heading, body }`.
 */
function markdownSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match !== null) {
      current = { level: match[1].length, heading: match[2].trim(), body: [] };
      sections.push(current);
      continue;
    }
    if (current !== null) current.body.push(line);
  }
  return sections.map((section) => ({ ...section, body: section.body.join("\n") }));
}

/**
 * Find the labelled bullet a documented procedure must carry.
 *
 * @param body The section body.
 * @param label The label, without its bold markers or trailing period.
 * @returns The text after the label, or null when the label is absent.
 */
function labelledText(body, label) {
  const pattern = new RegExp(
    `\\*\\*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\.\\*\\*(.*)$`,
    "m",
  );
  const match = pattern.exec(body);
  return match === null ? null : match[1].trim();
}

/**
 * Run the whole comparison.
 *
 * @param options.repoRoot The repository root every relative path resolves against.
 * @param options.declarationPath Override for the declaration file.
 * @param options.workflowPath Override for the release workflow.
 * @param options.docsPath Override for the credential documentation.
 * @returns `{ ok, compared, findings, report }`.
 */
export function checkCredentialSurface({ repoRoot, declarationPath, workflowPath, docsPath } = {}) {
  const root = resolve(repoRoot ?? join(import.meta.dirname, ".."));
  const declarationFile = resolve(declarationPath ?? join(root, DEFAULT_DECLARATION));
  const findings = [];

  const loaded = loadDeclaration(declarationFile);
  if (!loaded.ok) {
    findings.push({ code: loaded.code, message: loaded.message });
    for (const problem of loaded.problems ?? []) {
      findings.push({ code: "declaration-invalid", message: problem });
    }
    return finish(findings, false, declarationFile, null);
  }
  const declaration = loaded.declaration;

  const workflowFile = resolve(workflowPath ?? join(root, declaration.publishPath.workflow));
  let workflowText;
  try {
    workflowText = readFileSync(workflowFile, "utf8");
  } catch (error) {
    findings.push({
      code: error.code === "ENOENT" ? "workflow-absent" : "workflow-unreadable",
      message: `the declaration describes ${workflowFile}, which could not be read: ${error.message}`,
    });
    return finish(findings, false, declarationFile, workflowFile);
  }
  let workflow;
  try {
    workflow = parseWorkflow(workflowText);
  } catch (error) {
    if (!(error instanceof WorkflowParseError)) throw error;
    findings.push({
      code: "workflow-unparseable",
      message: `${workflowFile} could not be parsed, so its credential surface cannot be compared: ${error.message}`,
    });
    return finish(findings, false, declarationFile, workflowFile);
  }

  const jobs = indexJobs(workflow);
  const { references, opaque } = collectSecretReferences(workflow, jobs);

  checkStepNameAmbiguity(declaration, jobs, findings);
  const matched = checkReferences(declaration, references, findings);
  checkDeclaredExposures(declaration, jobs, matched, findings);
  checkSettings(declaration, jobs, findings);
  checkPermissions(declaration, workflow, jobs, findings);
  checkEnvironment(declaration, jobs, references, findings);
  checkRedaction(declaration, jobs, findings);
  checkDocumentation(declaration, root, docsPath, findings);

  for (const entry of opaque) {
    findings.push({
      code: "opaque-secrets-reference",
      message: `${describeScope(entry.location)} hands out the whole \`secrets\` context at once (line ${entry.line}), which no per-credential declaration can describe`,
    });
  }

  return finish(findings, true, declarationFile, workflowFile);
}

/**
 * A declaration that names a step whose name is not unique inside its job cannot be matched
 * reliably, so say so rather than matching the first one and reporting a clean surface.
 *
 * @param declaration The declaration.
 * @param jobs The job index.
 * @param findings Accumulator.
 */
function checkStepNameAmbiguity(declaration, jobs, findings) {
  const wanted = new Set();
  for (const credential of declaration.credentials) {
    for (const exposure of credential.exposures) wanted.add(`${exposure.job} ${exposure.step}`);
  }
  for (const setting of declaration.settings ?? []) {
    for (const exposure of setting.exposures) wanted.add(`${exposure.job} ${exposure.step}`);
  }
  wanted.add(`${declaration.logRedaction.job} ${declaration.logRedaction.step}`);
  for (const key of wanted) {
    const [jobId, stepId] = key.split(" ");
    const job = jobs.get(jobId);
    if (job === undefined) continue;
    const count = job.steps.filter((step) => step.id === stepId).length;
    if (count > 1) {
      findings.push({
        code: "ambiguous-step-name",
        message: `job "${jobId}" has ${count} steps named "${stepId}", so the declaration cannot say which one is permitted to receive a credential`,
      });
    }
  }
}

/**
 * Every reference the workflow makes must be one the declaration permits, at the scope it permits.
 *
 * @param declaration The declaration.
 * @param references Every `secrets.NAME` reference found.
 * @param findings Accumulator.
 * @returns The set of declared exposure keys that were actually seen.
 */
function checkReferences(declaration, references, findings) {
  const byName = new Map(declaration.credentials.map((c) => [c.name, c]));
  const seen = new Set();
  for (const reference of references) {
    const credential = byName.get(reference.secret);
    if (credential === undefined) {
      findings.push({
        code: "undeclared-secret",
        message: `\`secrets.${reference.secret}\` is referenced at ${describeScope(reference.location)} (line ${reference.line}) and the declaration does not name it`,
      });
      continue;
    }
    const exposure = credential.exposures.find(
      (candidate) =>
        reference.location.level === "step" &&
        candidate.job === reference.location.job &&
        candidate.step === reference.location.step &&
        candidate.as === reference.location.as &&
        candidate.name === reference.location.name,
    );
    if (exposure === undefined) {
      const permitted = credential.exposures.map(describeDeclaredScope).join("; ");
      findings.push({
        code: "scope-widened",
        message: `\`${credential.name}\` is exposed at ${describeScope(reference.location)} as \`${reference.location.name}\` (line ${reference.line}); the declaration permits only ${permitted}`,
      });
      continue;
    }
    seen.add(exposureKey(credential.name, exposure));
    if (exposure.mode === "presence-test") {
      const tests = new RegExp(`secrets\\.${credential.name}\\s*(!=|==)`).test(reference.text);
      if (!tests) {
        findings.push({
          code: "presence-test-became-a-value",
          message: `\`${credential.name}\` is declared at ${describeDeclaredScope(exposure)} as a presence test, but line ${reference.line} passes its value instead of comparing it`,
        });
      }
    }
  }
  return seen;
}

/**
 * @param name The credential or setting name.
 * @param exposure A declared exposure.
 * @returns A stable key for it.
 */
function exposureKey(name, exposure) {
  return [name, exposure.job, exposure.step, exposure.as, exposure.name].join(" ");
}

/**
 * A declaration is a promise in both directions: a credential that no longer appears where it says
 * it does is a failure, not a success on the grounds that nothing extra turned up.
 *
 * @param declaration The declaration.
 * @param jobs The job index.
 * @param seen Exposure keys that were matched by a real reference.
 * @param findings Accumulator.
 */
function checkDeclaredExposures(declaration, jobs, seen, findings) {
  for (const credential of declaration.credentials) {
    const missing = credential.exposures.filter((e) => !seen.has(exposureKey(credential.name, e)));
    if (missing.length === credential.exposures.length) {
      findings.push({
        code: "declared-credential-absent",
        message: `\`${credential.name}\` is declared but appears at none of the ${credential.exposures.length} location(s) the declaration names, so either the workflow dropped it or the declaration is stale`,
      });
    }
    for (const exposure of missing) {
      const job = jobs.get(exposure.job);
      const reason =
        job === undefined
          ? `job "${exposure.job}" does not exist in the workflow`
          : job.steps.some((step) => step.id === exposure.step)
            ? `that step does not set \`${exposure.as}: ${exposure.name}\` from it`
            : `job "${exposure.job}" has no step named "${exposure.step}"`;
      findings.push({
        code: "declared-exposure-absent",
        message: `\`${credential.name}\` is declared at ${describeDeclaredScope(exposure)} but ${reason}`,
      });
    }
  }
}

/**
 * Non-secret switches on the publish path are declared too, and checked for presence and for the
 * exact expression they must carry. `NPM_CONFIG_PROVENANCE` is the one that matters: deleting it
 * turns npm provenance off silently, and nothing else in this repository would notice.
 *
 * @param declaration The declaration.
 * @param jobs The job index.
 * @param findings Accumulator.
 */
function checkSettings(declaration, jobs, findings) {
  for (const setting of declaration.settings ?? []) {
    for (const exposure of setting.exposures) {
      const job = jobs.get(exposure.job);
      const step = job?.steps.find((candidate) => candidate.id === exposure.step);
      const found = scalarOf(mapGet(mapGet(step?.node, exposure.as), exposure.name));
      if (found === undefined) {
        findings.push({
          code: "declared-setting-absent",
          message: `the publish-path setting \`${setting.name}\` is declared at ${describeDeclaredScope(exposure)} and is not there`,
        });
        continue;
      }
      if (found !== setting.value) {
        findings.push({
          code: "declared-setting-changed",
          message: `the publish-path setting \`${setting.name}\` at ${describeDeclaredScope(exposure)} is \`${found}\`, and the declaration says it must be \`${setting.value}\``,
        });
      }
    }
  }
}

/**
 * `GITHUB_TOKEN` is not stored anywhere: it is minted per job, and its power is whatever the
 * `permissions:` block grants. So its declared surface IS that block, at both levels, and a job with
 * no block of its own silently inherits the workflow-level one, which is the quietest scope
 * widening available in a workflow file.
 *
 * @param declaration The declaration.
 * @param workflow The parsed workflow.
 * @param jobs The job index.
 * @param findings Accumulator.
 */
function checkPermissions(declaration, workflow, jobs, findings) {
  const owner = declaration.credentials.find((credential) => credential.permissions !== undefined);
  if (owner === undefined) return;
  const declared = owner.permissions;

  const workflowLevel = readPermissions(workflow);
  if (declared.workflow === undefined) {
    if (workflowLevel.present) {
      findings.push({
        code: "permissions-undeclared",
        message: `the workflow declares a workflow-level \`permissions:\` block and \`${owner.name}\`'s declaration does not describe one`,
      });
    }
  } else if (!workflowLevel.present) {
    findings.push({
      code: "permissions-absent",
      message: `\`${owner.name}\`'s declaration describes a workflow-level \`permissions:\` block and the workflow has none`,
    });
  } else if (workflowLevel.grants === null) {
    findings.push({
      code: "permissions-unreadable",
      message: `the workflow-level \`permissions:\` block is \`${workflowLevel.scalar}\` rather than a set of grants, which the declaration cannot describe`,
    });
  } else {
    for (const difference of diffGrants(declared.workflow, workflowLevel.grants)) {
      findings.push({
        code: "permissions-widened",
        message: `the workflow-level \`permissions:\` block ${difference}`,
      });
    }
  }

  for (const [jobId, job] of jobs) {
    const declaredJob = declared.jobs?.[jobId];
    const found = readPermissions(job.node);
    if (declaredJob === undefined) {
      findings.push({
        code: "job-permissions-undeclared",
        message: `job "${jobId}" is not described by \`${owner.name}\`'s declared permissions, so nothing says what that job's token may do`,
      });
      continue;
    }
    if (!found.present) {
      findings.push({
        code: "job-inherits-workflow-permissions",
        message: `job "${jobId}" declares no \`permissions:\` block, so it silently inherits the workflow-level grants instead of the ones the declaration names for it`,
      });
      continue;
    }
    if (found.grants === null) {
      findings.push({
        code: "permissions-unreadable",
        message: `job "${jobId}" has \`permissions: ${found.scalar}\` rather than a set of grants, which the declaration cannot describe`,
      });
      continue;
    }
    for (const difference of diffGrants(declaredJob, found.grants)) {
      findings.push({
        code: "permissions-widened",
        message: `job "${jobId}" ${difference}`,
      });
    }
  }
}

/**
 * The job that can reach the registry must reference the protected deployment environment. Checked
 * against the declared publish job AND against every job actually holding registry credentials, so
 * hoisting `NPM_TOKEN` into an ungated job fails here as well as on scope.
 *
 * @param declaration The declaration.
 * @param jobs The job index.
 * @param references Every secret reference found.
 * @param findings Accumulator.
 */
function checkEnvironment(declaration, jobs, references, findings) {
  const wanted = declaration.publishPath.environment;
  const registryAuth = new Set(
    declaration.credentials.filter((c) => c.registryAuth).map((c) => c.name),
  );
  const mustBeGated = new Set([declaration.publishPath.job]);
  for (const reference of references) {
    if (registryAuth.has(reference.secret) && reference.location.job !== null) {
      mustBeGated.add(reference.location.job);
    }
  }
  for (const jobId of mustBeGated) {
    const job = jobs.get(jobId);
    if (job === undefined) {
      findings.push({
        code: "publish-job-absent",
        message: `the declaration names "${jobId}" as the job that reaches the registry and the workflow has no such job`,
      });
      continue;
    }
    const found = environmentOf(job.node);
    if (found === undefined) {
      findings.push({
        code: "environment-missing",
        message: `job "${jobId}" can reach the registry and declares no deployment environment; the declaration requires \`environment: ${wanted}\``,
      });
      continue;
    }
    if (found !== wanted) {
      findings.push({
        code: "environment-changed",
        message: `job "${jobId}" declares \`environment: ${found}\` and the declaration requires \`environment: ${wanted}\``,
      });
    }
  }
}

/**
 * A credential whose issued form is recognizable by prefix or shape must be covered by the release
 * run's log scrubbing, in BOTH halves of it: the rules that redact, and the assertion that re-reads
 * the redacted bytes and refuses the upload if anything credential-shaped survived. Adding a
 * credential to the declaration therefore cannot quietly outrun the redaction.
 *
 * @param declaration The declaration.
 * @param jobs The job index.
 * @param findings Accumulator.
 */
function checkRedaction(declaration, jobs, findings) {
  const { job: jobId, step: stepId } = declaration.logRedaction;
  const job = jobs.get(jobId);
  const step = job?.steps.find((candidate) => candidate.id === stepId);
  const script = scalarOf(mapGet(step?.node, "run"));
  if (script === undefined) {
    findings.push({
      code: "redaction-step-absent",
      message: `the declaration names step "${stepId}" of job "${jobId}" as the log-scrubbing step and no such step with a \`run:\` script exists`,
    });
    return;
  }
  const assertionAt = script.search(/\bgrep\b/);
  if (assertionAt < 0) {
    findings.push({
      code: "redaction-assertion-absent",
      message: `step "${stepId}" of job "${jobId}" scrubs the npm debug log but never re-reads the scrubbed bytes to prove nothing credential-shaped survived`,
    });
    return;
  }
  const rules = script.slice(0, assertionAt);
  const assertion = script.slice(assertionAt);
  for (const credential of declaration.credentials) {
    for (const form of credential.issuedForms) {
      if (!rules.includes(form.pattern)) {
        findings.push({
          code: "redaction-rule-missing",
          message: `\`${credential.name}\` is issued in the form \`${form.id}\` and step "${stepId}" of job "${jobId}" carries no rule redacting \`${form.pattern}\``,
        });
      }
      if (!assertion.includes(form.pattern)) {
        findings.push({
          code: "redaction-assertion-incomplete",
          message: `\`${credential.name}\`'s issued form \`${form.id}\` is redacted but the post-redaction assertion in step "${stepId}" does not look for \`${form.pattern}\`, so a rule that stopped working would not be caught`,
        });
      }
    }
  }
}

/**
 * Every declared credential owes an operator a procedure they can follow without reconstructing it
 * from workflow comments: how to issue it, install it, verify it, revoke it, and what the manual
 * compensating action is when it has already been used. The section also owes two statements once:
 * that no automated rollback exists, and that a published version is permanent.
 *
 * @param declaration The declaration.
 * @param root The repository root.
 * @param docsPath Override for the documentation file.
 * @param findings Accumulator.
 */
function checkDocumentation(declaration, root, docsPath, findings) {
  const file = resolve(docsPath ?? join(root, declaration.documentation.file));
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    findings.push({
      code: "docs-unreadable",
      message: `the credential documentation ${file} could not be read: ${error.message}`,
    });
    return;
  }
  const sections = markdownSections(text);
  const wanted = declaration.documentation.section;
  const index = sections.findIndex((section) => section.heading === wanted);
  if (index < 0) {
    findings.push({
      code: "docs-section-absent",
      message: `${file} has no section headed "${wanted}", which is where the declaration says every credential's procedure lives`,
    });
    return;
  }
  const parent = sections[index];
  const owned = [];
  for (let i = index + 1; i < sections.length && sections[i].level > parent.level; i += 1) {
    owned.push(sections[i]);
  }
  const sectionText = [
    parent.body,
    ...owned.map((s) => `${"#".repeat(s.level)} ${s.heading}\n${s.body}`),
  ].join("\n");

  for (const statement of SECTION_STATEMENTS) {
    const found = labelledText(sectionText, statement.label);
    if (found === null || found.length < MIN_LABEL_TEXT) {
      findings.push({
        code: statement.code,
        message: `the "${wanted}" section of ${declaration.documentation.file} must state, as \`**${statement.label}.**\`, what it means for a credential change here`,
      });
    }
  }

  for (const credential of declaration.credentials) {
    const subsection = owned.find((section) => section.heading.includes(credential.name));
    if (subsection === undefined) {
      findings.push({
        code: "docs-credential-absent",
        message: `\`${credential.name}\` is declared and the "${wanted}" section of ${declaration.documentation.file} carries no subsection for it, so an operator has no rotation or revocation procedure for it`,
      });
      continue;
    }
    for (const label of PROCEDURE_LABELS) {
      const found = labelledText(subsection.body, label);
      if (found === null) {
        findings.push({
          code: "docs-procedure-incomplete",
          message: `\`${credential.name}\`'s procedure in ${declaration.documentation.file} has no \`**${label}.**\` step`,
        });
      } else if (found.length < MIN_LABEL_TEXT) {
        findings.push({
          code: "docs-procedure-incomplete",
          message: `\`${credential.name}\`'s \`**${label}.**\` step in ${declaration.documentation.file} is a stub rather than a procedure`,
        });
      }
    }
  }
}

/**
 * Turn the accumulated findings into a result and a report.
 *
 * @param findings Every disagreement found, in one pass.
 * @param compared Whether a comparison actually happened.
 * @param declarationFile The declaration path.
 * @param workflowFile The workflow path, or null when it was never reached.
 * @returns The result object.
 */
function finish(findings, compared, declarationFile, workflowFile) {
  const report = [];
  const ok = compared && findings.length === 0;
  if (ok) {
    report.push(
      `credential-surface: the release workflow agrees with ${declarationFile} on every declared credential.`,
    );
  } else if (!compared) {
    report.push(
      "credential-surface: THE COMPARISON COULD NOT BE MADE, so this is a failure and not a pass.",
      "Refusing to report success on having compared nothing.",
    );
  } else {
    report.push(
      `credential-surface: ${findings.length} disagreement(s) between ${declarationFile} and ${workflowFile}.`,
      "Every disagreement found is listed; fix them together rather than one run at a time.",
    );
  }
  for (const finding of findings) report.push(`  [${finding.code}] ${finding.message}`);
  return { ok, compared, findings, report };
}

/**
 * @param argv Arguments after the script name.
 * @returns The parsed options.
 */
function parseArgs(argv) {
  const options = {};
  const flags = {
    "--repo": "repoRoot",
    "--declaration": "declarationPath",
    "--workflow": "workflowPath",
    "--docs": "docsPath",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const field = flags[arg];
    if (field === undefined) throw new InvocationError(`unknown argument ${JSON.stringify(arg)}`);
    i += 1;
    const value = argv[i];
    if (value === undefined) throw new InvocationError(`${arg} needs a value`);
    options[field] = isAbsolute(value) ? value : resolve(value);
  }
  return options;
}

/**
 * @param argv Arguments after the script name.
 * @returns The process exit code.
 */
export function main(argv) {
  const result = checkCredentialSurface(parseArgs(argv));
  const stream = result.ok ? process.stdout : process.stderr;
  for (const line of result.report) stream.write(`${line}\n`);
  return result.ok ? 0 : 1;
}

// `isCliEntrypoint` is what keeps importing this file for tests from executing the CLI, and it is a
// path comparison rather than a string one for the reasons `scripts/changeset-guard.mjs` documents
// at length. The InvocationError handler keeps a broken invocation on exit 2, which this contract
// reserves for "this script was called wrongly" and must not collide with 1, "the surface drifted".
if (isCliEntrypoint(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof InvocationError) {
      process.stderr.write(`ERROR: credential-surface could not run: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
