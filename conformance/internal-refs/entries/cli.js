// conformance/internal-refs/entries/cli.js
//
// PENDING. cli carries its own hand-written variant of the internal-reference gate, and no
// session has adopted it yet.
//
// THIS ENTRY IS EMPTY ON PURPOSE AND IT IS NOT A GAP TO FILL FROM HERE. An entry is populated by
// the session ADOPTING this repository, from inside its own checkout, because no implementer may
// read another repository's source. Material added here by anyone else is material nobody can
// attribute to a tree, which is why the corpus grader treats a pending entry carrying any sample
// as malformed rather than as a head start.
//
// TO POPULATE IT: read this repository's own copy of the gate inside its checkout, record the sha
// you read it at, transcribe its rule inventory with a positive and a negative sample for every
// rule, resolve its axes into `canonicalConfig`, and add every contradiction against an already
// populated entry to `../conflicts.js`. `entries/hl7.js` is the worked example.

export default {
  repo: "cli",
  state: "pending",
  reason:
    "No session has adopted this repository. Its variant lives in its own checkout and is read " +
    "by the session that adopts it, never from here.",
};
