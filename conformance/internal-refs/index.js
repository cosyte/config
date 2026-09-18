// conformance/internal-refs/index.js
//
// THE CONFORMANCE CORPUS LOADER, and the validator that decides whether an entry can be graded.
//
// WHY LOADING IS DYNAMIC AND PER-REPOSITORY. A static import list turns a missing entry file into a
// module-resolution error before anything runs, which fails loudly but says nothing about WHICH
// repository lost its entry, and takes the whole corpus down with it. Here each entry is reached on
// its own, and an entry that is absent or will not load arrives as a first-class state the graders
// report by name. That is the difference between a corpus that refuses and a corpus that vanishes.
//
// THE THREE STATES AN ENTRY CAN BE IN, and no others:
//
//   populated   a session adopted that repository and transcribed its variant from inside its own
//               checkout, or from a variant a spec manifest named. It carries the sha, the rule
//               inventory, and a positive and a negative sample for every rule in it.
//   pending     nobody has adopted it yet. It carries a reason and NO sample material, because
//               material nobody read inside that repository is material nobody can attribute.
//   unreadable  its file is absent or will not load. NEVER a skip: a corpus that drops an entry it
//               cannot read reports the same green as one that graded it.

import { REPOS } from "./repos.js";
import CONFLICTS from "./conflicts.js";

export { REPOS, CONFLICTS };

/** Fields that only a populated entry may carry. A pending entry holding one is malformed. */
const SAMPLE_FIELDS = ["ruleSets", "canonicalConfig", "sha", "sourcePath", "residuals"];

/** Is this a plain object? */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A sha is 40 hex characters. Anything shorter cannot identify a tree. */
const SHA_SHAPE = /^[0-9a-f]{40}$/;

/**
 * Grade one corpus entry against the shape its declared state requires.
 *
 * EVERY PROBLEM NAMES THE REPOSITORY AND THE FIELD, because "the corpus is malformed" sends a reader
 * to twelve files. A malformed entry is never skipped so the rest can pass: an entry that drops out
 * of the graded set is a repository whose conformance nothing is asserting, and it reads exactly
 * like one that conforms.
 *
 * @param {string} repo The repository this entry is keyed under.
 * @param {unknown} entry The loaded entry, or `undefined` when it could not be loaded.
 * @param {string | null} loadError The load failure, when there was one.
 * @returns {string[]} One line per problem. Empty means the entry is gradeable.
 */
export function validateEntry(repo, entry, loadError = null) {
  const problems = [];
  const say = (line) => problems.push(`${repo}: ${line}`);

  if (loadError !== null) {
    say(`its entry file could not be loaded: ${loadError}`);
    return problems;
  }
  if (!isPlainObject(entry)) {
    say("its entry file does not export an object");
    return problems;
  }
  if (entry.repo !== repo) {
    say(
      `field \`repo\` is ${JSON.stringify(entry.repo)} in the file keyed for ${JSON.stringify(repo)}`,
    );
  }
  if (entry.state !== "populated" && entry.state !== "pending") {
    say(
      `field \`state\` is ${JSON.stringify(entry.state)}, and the only declarable states are ` +
        `"populated" and "pending"`,
    );
    return problems;
  }

  if (entry.state === "pending") {
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      say("field `reason` is required on a pending entry, so a reader learns why it is empty");
    }
    for (const field of SAMPLE_FIELDS) {
      if (entry[field] !== undefined) {
        say(
          `field \`${field}\` is present on a PENDING entry. Material nobody read inside that ` +
            "repository is material nobody can attribute, so a pending entry carrying sample " +
            "material is malformed rather than a head start.",
        );
      }
    }
    return problems;
  }

  if (typeof entry.sha !== "string" || !SHA_SHAPE.test(entry.sha)) {
    say(
      `field \`sha\` is ${JSON.stringify(entry.sha)}, which is not a 40-character commit id. A ` +
        "populated entry with no sha records a rule set nobody can attribute to a tree.",
    );
  }
  if (typeof entry.sourcePath !== "string" || entry.sourcePath.trim() === "") {
    say("field `sourcePath` is required, so a reader knows which file was transcribed");
  }
  if (!isPlainObject(entry.canonicalConfig)) {
    say("field `canonicalConfig` is required: it is what the superset grader runs");
  }
  if (!Array.isArray(entry.ruleSets) || entry.ruleSets.length === 0) {
    say("field `ruleSets` is required and must hold at least one rule set");
    return problems;
  }

  const seenSets = new Set();
  entry.ruleSets.forEach((set, setIndex) => {
    const where =
      isPlainObject(set) && typeof set.id === "string" ? set.id : `ruleSets[${setIndex}]`;
    if (!isPlainObject(set)) {
      say(`field \`ruleSets[${setIndex}]\` is not an object`);
      return;
    }
    if (typeof set.id !== "string" || set.id.trim() === "") {
      say(`field \`ruleSets[${setIndex}].id\` is required`);
    } else if (seenSets.has(set.id)) {
      say(`field \`ruleSets[${setIndex}].id\` repeats ${JSON.stringify(set.id)}`);
    } else {
      seenSets.add(set.id);
    }
    if (typeof set.appliesTo !== "string" || set.appliesTo.trim() === "") {
      say(`field \`${where}.appliesTo\` is required: a rule set with no surface grades nothing`);
    }
    // THE SURFACE IS A CLOSED SET, and a third value reds rather than being graded through the
    // wrong pass. A rule set the grader silently ran against the public surface when the variant
    // guards its source would report a superset claim nobody made.
    if (set.surface !== "public" && set.surface !== "source") {
      say(
        `field \`${where}.surface\` is ${JSON.stringify(set.surface)}, and the shared ` +
          'implementation has two surfaces: "public" and "source". A rule set guarding a third ' +
          "one cannot be graded until the implementation grows that pass.",
      );
    }
    if (!Array.isArray(set.rules) || set.rules.length === 0) {
      say(`field \`${where}.rules\` is required and must hold at least one rule`);
      return;
    }
    set.rules.forEach((rule, ruleIndex) => {
      const at = `${where}.rules[${ruleIndex}]`;
      if (!isPlainObject(rule)) {
        say(`field \`${at}\` is not an object`);
        return;
      }
      if (typeof rule.name !== "string" || rule.name.trim() === "") {
        say(`field \`${at}.name\` is required`);
      }
      if (typeof rule.pattern !== "string" || rule.pattern.trim() === "") {
        say(`field \`${at}.pattern\` is required, so a reader can see what was adopted`);
      }
      for (const direction of ["positive", "negative"]) {
        const sample = rule[direction];
        if (sample === undefined) {
          say(
            `field \`${at}.${direction}\` is missing. A rule with no ${direction} sample is one ` +
              "the shared implementation cannot be graded against in that direction.",
          );
          continue;
        }
        const list = Array.isArray(sample) ? sample : [sample];
        if (list.length === 0) {
          say(`field \`${at}.${direction}\` is an empty list, which is the same as missing`);
        }
        for (const one of list) {
          if (typeof one !== "string" || one.trim() === "") {
            say(`field \`${at}.${direction}\` carries a sample that is not a non-empty string`);
          }
        }
      }
    });
  });

  return problems;
}

/** Every sample of one direction for one corpus rule, as a list whatever shape it was written in. */
export function samplesOf(rule, direction) {
  const sample = rule[direction];
  if (sample === undefined) return [];
  return Array.isArray(sample) ? sample : [sample];
}

/**
 * One contradiction between two rule sets, derived from the corpus entries alone.
 *
 * @typedef {object} Contradiction
 * @property {string} text The sample one rule set flags and another records as reference material.
 * @property {string} flaggedBy `repo/ruleSetId/ruleName` of the rule holding it as a POSITIVE.
 * @property {string} letThroughBy `repo/ruleSetId/ruleName` of the rule whose NEGATIVE holds it.
 * @property {string} rule The rule the flagging side calls it.
 * @property {string} letThroughRule The rule the other side calls it.
 * @property {string[]} repos The repositories the two sides come from.
 */

/** `repo/ruleSetId/ruleName`: the one label that names a rule set AND the rule inside it. */
function owner(repo, set, rule) {
  return `${repo}/${set.id}/${rule.name}`;
}

/**
 * Derive every contradiction the populated entries expose, FROM THE ENTRIES THEMSELVES.
 *
 * A NEGATIVE SAMPLE IS A PROMISE ABOUT A WHOLE TEXT: this line must come back clean. So when one
 * rule set's POSITIVE sample occurs inside another rule set's NEGATIVE sample, the two disagree
 * about the same bytes - running the first rule over the second's reference material flags it. That
 * is the contradiction the register exists to record, and deriving it here is what stops the
 * register from being a claim nothing can falsify: a corpus with a contradiction nobody wrote down
 * looks exactly like a corpus with none.
 *
 * CONTAINMENT, NOT EQUALITY, and only in that direction. A positive that is a SUPERSTRING of some
 * negative is not a contradiction: the flagging side may be flagging the part the other side never
 * spoke about. A positive INSIDE a negative is, because the other side spoke about all of it.
 *
 * Rules are compared across rule sets and across repositories, including two rule sets of one
 * entry: hl7 keeps a public-surface set and a source doc-comment set that are allowed to diverge,
 * and a divergence where one flags what the other protects is the same defect as one between two
 * repositories.
 *
 * An entry that does not validate contributes nothing here; `planSuperset` already refuses on it,
 * and deriving over a half-read entry would report a contradiction against material nobody can
 * attribute.
 *
 * @param {{ repo: string, state: string, entry: object | null, loadError: string | null }[]} records
 *   The loaded corpus.
 * @returns {Contradiction[]} Every contradicting pair, in corpus order.
 */
export function deriveContradictions(records) {
  const rules = [];
  for (const record of records) {
    const entry = record.entry;
    if (!isPlainObject(entry) || entry.state !== "populated") continue;
    if (validateEntry(record.repo, entry, record.loadError).length > 0) continue;
    for (const set of entry.ruleSets) {
      for (const rule of set.rules) {
        rules.push({
          repo: record.repo,
          owner: owner(record.repo, set, rule),
          rule: rule.name,
          positives: samplesOf(rule, "positive"),
          negatives: samplesOf(rule, "negative"),
        });
      }
    }
  }

  const found = [];
  for (const flags of rules) {
    for (const letsThrough of rules) {
      if (flags.owner === letsThrough.owner) continue;
      for (const text of flags.positives) {
        for (const negative of letsThrough.negatives) {
          if (!negative.includes(text)) continue;
          found.push({
            text,
            flaggedBy: flags.owner,
            letThroughBy: letsThrough.owner,
            rule: flags.rule,
            letThroughRule: letsThrough.rule,
            repos: [...new Set([flags.repo, letsThrough.repo])],
          });
        }
      }
    }
  }
  return found;
}

/**
 * Does this register row record this contradiction?
 *
 * THE MATCH IS EXACT AND STRUCTURED, never prose. A row whose paragraphs happen to quote the text
 * would silently absorb the next contradiction that shares a word, which is the failure mode of a
 * register graded by reading. A row accounts for a derived pair by naming it: which rule set flags
 * it, which rule set protects it, and the text itself.
 */
function covers(row, contradiction) {
  const exposed = Array.isArray(row?.exposedBy) ? row.exposedBy : [];
  return exposed.some(
    (side) =>
      isPlainObject(side) &&
      side.text === contradiction.text &&
      side.flaggedBy === contradiction.flaggedBy &&
      side.letThroughBy === contradiction.letThroughBy,
  );
}

/**
 * The derived contradictions no register row records. Empty is the only passing answer.
 *
 * @param {{ repo: string, state: string, entry: object | null, loadError: string | null }[]} records
 *   The loaded corpus.
 * @param {object[]} [conflicts] The register to grade against. Defaults to the shipped one.
 * @returns {Contradiction[]} The unrecorded pairs.
 */
export function unregisteredContradictions(records, conflicts = CONFLICTS) {
  return deriveContradictions(records).filter(
    (contradiction) => !conflicts.some((row) => covers(row, contradiction)),
  );
}

/** What a refusal has to say for the reader to be able to resolve it without rediscovering it. */
function contradictionRefusal(contradiction) {
  return (
    "the populated entries contradict each other and the conflict register does not record it: " +
    `${contradiction.flaggedBy} FLAGS ${JSON.stringify(contradiction.text)}, and ` +
    `${contradiction.letThroughBy} records that same text as reference material it must never ` +
    "flag. Resolve it through a per-repository configuration value and record the pair in " +
    "`conflicts.js` - both rule sets, the rule, and what it was decided as - carrying " +
    `\`exposedBy: [{ flaggedBy: ${JSON.stringify(contradiction.flaggedBy)}, letThroughBy: ` +
    `${JSON.stringify(contradiction.letThroughBy)}, text: ${JSON.stringify(contradiction.text)} }]\`. ` +
    "Dropping either sample is not a resolution: it deletes the evidence the disagreement existed."
  );
}

/**
 * Turn a loaded corpus into the superset grader's worklist, or into the reasons it cannot run.
 *
 * THE REFUSAL IS THE POINT. A grader handed an entry it cannot read has two options, and only one
 * of them is honest: report a pass over the entries it COULD read, or refuse. The first is how a
 * corpus quietly shrinks, because the run conclusion is the only thing anyone reads and a shorter
 * corpus produces exactly the same green. So an unreadable entry, a malformed entry and an empty
 * populated set all arrive in `refusals`, and a caller that ignores them is asserting nothing.
 *
 * A PENDING ENTRY IS REPORTED AS PENDING AND CONTRIBUTES NO CASE. It never counts toward a pass:
 * nobody has read that repository's variant, so there is nothing to be a superset of yet.
 *
 * AN UNRECORDED CONTRADICTION IS A REFUSAL TOO. Two rule sets that disagree about the same bytes
 * make the superset claim self-contradictory - it would assert both that the text is flagged and
 * that it is not - and the resolution belongs in the register, where a reader can see which side
 * was given up and on what axis.
 *
 * @param {{ repo: string, state: string, entry: object | null, loadError: string | null }[]} records
 *   The loaded corpus.
 * @param {object[]} [conflicts] The register to grade against. Defaults to the shipped one.
 * @returns {{ cases: object[], pending: { repo: string, reason: string }[], refusals: string[] }}
 *   One case per repository per rule per direction, the pending report, and the refusals.
 */
export function planSuperset(records, conflicts = CONFLICTS) {
  const cases = [];
  const pending = [];
  const refusals = [];

  for (const record of records) {
    if (record.state === "unreadable" || record.entry === null) {
      refusals.push(
        `${record.repo}: the roster keys this repository and its entry could not be read ` +
          `(${record.loadError}). Refusing to report a superset over the entries that did load.`,
      );
      continue;
    }
    const problems = validateEntry(record.repo, record.entry, record.loadError);
    if (problems.length > 0) {
      refusals.push(...problems);
      continue;
    }
    if (record.entry.state === "pending") {
      pending.push({ repo: record.repo, reason: record.entry.reason });
      continue;
    }
    for (const set of record.entry.ruleSets) {
      for (const rule of set.rules) {
        for (const direction of ["positive", "negative"]) {
          for (const sample of samplesOf(rule, direction)) {
            cases.push({
              repo: record.repo,
              sha: record.entry.sha,
              ruleSetId: set.id,
              surface: set.surface,
              ruleName: rule.name,
              canonicalId: rule.canonicalId ?? null,
              direction,
              sample,
              config: record.entry.canonicalConfig,
            });
          }
        }
      }
    }
  }

  for (const contradiction of unregisteredContradictions(records, conflicts)) {
    refusals.push(contradictionRefusal(contradiction));
  }

  if (refusals.length === 0 && cases.length === 0) {
    refusals.push(
      "no populated entry contributed a case, so a green run here would assert nothing about any " +
        "repository. Refusing rather than reporting a superset over an empty corpus.",
    );
  }

  return { cases, pending, refusals };
}

/**
 * Load every entry the roster names.
 *
 * An entry that is absent or will not load arrives as `state: "unreadable"` with the cause, so a
 * grader can report it rather than silently grade a corpus one entry smaller.
 *
 * @returns {Promise<{ repo: string, state: string, entry: object | null, loadError: string | null }[]>}
 *   One record per repository on the roster, in roster order.
 */
export async function loadCorpus() {
  const loaded = [];
  for (const repo of REPOS) {
    try {
      const module = await import(`./entries/${repo}.js`);
      const entry = module.default;
      loaded.push({
        repo,
        state: isPlainObject(entry) && typeof entry.state === "string" ? entry.state : "malformed",
        entry: entry ?? null,
        loadError: null,
      });
    } catch (cause) {
      loaded.push({ repo, state: "unreadable", entry: null, loadError: String(cause) });
    }
  }
  return loaded;
}
