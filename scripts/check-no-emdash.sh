#!/usr/bin/env bash
# scripts/check-no-emdash.sh
# Brand rule (founder directive, 2026-07-24): cosyte never uses the em dash.
# The em dash (U+2014) reads as an AI tell, so it is banned outright across every
# cosyte surface. Source of truth: `knowledgebase/06-brand/voice-and-tone.md`
# ("No em dashes. Ever."), which names COMMIT MESSAGES explicitly.
#
# Ported into config on 2026-07-30 (EMDASH-CONFORMANCE part 2). Composed from the
# sibling copies rather than taken from any one of them:
#
#   * BASE: the text-only shape hl7, x12, ncpdp, fhir, pathways and knowledgebase run.
#     No binary partition at all. See BINARY POSTURE below for why that is the RIGHT
#     shape here and not merely the simpler one.
#   * PLUS cli's route fixes ([cli#41](https://github.com/cosyte/cli/pull/41)): every
#     scanned path is `./`-prefixed so a tracked file named exactly `-` cannot be read
#     as standard input; `-d skip` is NOT used, so a tracked symlink to a directory
#     cannot pass silently; `-H` so every hit carries its filename; a tracked entry
#     that is not a regular file is refused BY NAME rather than skipped.
#   * PLUS dicom's binary-match diagnostic branch, so a red caused by a match inside
#     input grep cannot read as text says so instead of blaming an I/O failure.
#   * PLUS the fix for cross-repo residual (iv), which every other copy of this gate
#     documents as a KNOWN HOLE and declines to close. astm's
#     `scripts/check-no-internal-refs.sh` has the reference implementation and this is
#     the em-dash gate's first copy of it: `unset -f grep xargs sed awk`, and the
#     SCANNER VISIBILITY PROBE. See THE INTERPOSED-TOOL HOLE below. The probe is the
#     important half.
#
# MEASURED BEFORE THE PORT, byte level, over ALL 126 tracked files (not a markdown
# sample: a markdown-only count is what wrongly cleared dicom, and this repo would
# have been cleared the same way):
#   * 529 occurrences of U+2014 as the LITERAL character, across 73 of the 126 files.
#     42 of those 73 are not markdown (31 are).
#   * ONE occurrence in an ENCODED form, and a literal-character sweep would have
#     missed it: `scripts/parser-template/package.json` carried the JS escape in its
#     npm `description`. That file is the scaffold `scripts/scaffold-parser.mjs`
#     generates every new parser repo from, so the escape would have been copied into
#     the published `description` of every future `@cosyte/*` parser. claude-containers
#     found the same class of miss as an HTML entity; this repo found it as an escape.
#     Sweep for the encodings, never only for the character.
#   * ZERO in `%E2%80%94`, `&mdash;`, `&#8212;` or `&#x2014;` form.
#   * ZERO tracked files hold a NUL byte, ZERO are gitlinks (no mode 160000 entry),
#     ZERO are symlinks (no mode 120000 entry), and `git ls-files --eol` reports ZERO
#     as binary. Every tracked file decodes as UTF-8.
#   * THREE occurrences were SEMANTIC VALUES rather than punctuation, plus one glyph
#     used as a drawing character, and all three were converted by hand BEFORE any
#     bulk transform ran. They are listed in the commit that added this gate.
#
# All 530 were rewritten in the SAME commit that added this gate, so it arrives green
# over a tree that was cleared rather than green over a tree nobody looked at. A gate
# without the sweep reds CI on arrival; a sweep without the gate lets it grow back.
#
# The fix is never to re-encode the character: rewrite the sentence with a period, a
# colon, a comma, or parentheses.
#
# Two modes:
#   check-no-emdash.sh                 scan every tracked file
#   check-no-emdash.sh --stdin LABEL   scan text on stdin (CI feeds it the PR title,
#                                      body, and commit messages)
#
# Note: this script itself is excluded from the tracked-file scan (it necessarily
# names the encodings it bans). It matches by codepoint and by encoding, so it never
# contains the literal character. Nothing checks the checker, so keep it that way.
#
# ---------------------------------------------------------------------------
# BINARY POSTURE. This repo scans EVERY tracked file with NO binary partition and
# NO `-I`, which is fail-CLOSED, and it is a measured choice rather than a default.
#
# cli and website partition NUL-bearing files out as binary because they must: cli
# vendors ten `pnpm pack` tarballs and one of them already contains the byte sequence
# E2 80 94 by DEFLATE coincidence, so a text-only port goes red there TODAY on a
# compressed stream nobody wrote. That partition costs them a real hole: seed one of
# those tarballs with a live em dash and their gate prints OK.
#
# config pays no such cost. It tracks 126 files and not one holds a NUL byte, so the
# partition would exempt nothing while opening the hole anyway. Scanning everything
# means a NUL-bearing file that arrives LATER cannot be skipped in silence: grep
# reports "binary file matches" on stderr, refuse_if_incomplete escalates it to a red,
# and a human looks. A loud false positive on a future binary beats a silent miss.
#
# Bare `-I` is NOT the alternative and must not be re-added. `-I` asks grep's
# heuristic "does this look like text", and that heuristic also skips a genuine TEXT
# file whose encoding is broken, so an em dash inside one would be missed in silence.
# That is the exact failure this whole script exists to refuse.
#
# If this repo ever tracks a real binary, revisit this posture deliberately (cli's
# header has the full argument and the arithmetic). Never revisit the ban.
# ---------------------------------------------------------------------------
# THE INTERPOSED-TOOL HOLE, cross-repo residual (iv), CLOSED HERE.
#
# Every other copy of this gate TRUSTS that `grep` resolves to a binary, records that
# trust as a known hole, and declines to close it on the argument that a divergent
# variant is worse than a shared documented limit. That argument has a shelf life, and
# astm's `check-no-internal-refs.sh` already ended it: the fix is small, self-testing,
# and strictly safer than the hole. This is the em-dash gate's first copy of it.
#
# The mechanism is real and was found live, not imagined for symmetry. The development
# container this repo is worked in defines `grep` as a shell FUNCTION forwarding to
# `ugrep` with `-G --ignore-files -I` FORCED. Under that shim:
#
#   * `-I` SKIPS ANY FILE THE TOOL CALLS BINARY, SILENTLY, AT EXIT 0. Every argument
#     this header makes against `-I` then applies to the script itself, and the gate
#     prints OK over a file it never opened.
#   * `-G` FORCES BASIC REGULAR EXPRESSIONS, under which `|` in PATTERN is a LITERAL.
#     The pattern would match nothing, which is indistinguishable from a clean tree.
#   * `--ignore-files` honours `.gitignore`. It is immaterial to THIS script, which
#     only ever passes explicit operands produced by `git ls-files` (tracked, so never
#     ignored), and it is stated so it is not re-litigated. It matters enormously to a
#     HAND sweep, where it silently reports zero over a surface it never opened.
#
# A shell function is not exported to a child process, so `bash scripts/check-no-emdash.sh`
# gets the real binary and CI is unaffected. But `export -f grep` in a caller's
# environment WOULD reach here, so the functions are unset rather than assumed absent.
# `unset -f` on a name that is not a function is a no-op, so this costs nothing.
#
# The `-G` half needs no separate guard: the SELF-TEST below uses alternation, so a
# BRE-forced grep fails it and the script refuses. The `-I` half DOES need one, because
# it changes what is READ rather than what is MATCHED, and no pattern assertion can see
# that: a tool that skips a file produces the same empty output as a tool that read the
# file and found it clean, and both exit 0. That is the SCANNER VISIBILITY PROBE.
# ---------------------------------------------------------------------------
set -euo pipefail

unset -f grep xargs sed awk 2>/dev/null || true

# LOCALE PIN, load-bearing. `grep -P` compiles `\x{NNNN}` as a Unicode codepoint only
# in PCRE's UTF-8 mode, which GNU grep enables from the locale. Under LC_CTYPE=POSIX
# (a bare container, cron, `sh -c`, any shell that inherits no locale) GNU grep 3.8
# instead ABORTS with "character code point value in \x{} or \o{} is too large".
# That is not a hypothetical here: it fired during this repo's own measurement pass,
# where an unpinned `/usr/bin/grep -P '\x{2014}'` aborted on every file and the empty
# output read exactly like a clean tree. An earlier version of this gate in a sibling
# repo discarded that on stderr and `|| true`d the pipeline, so it printed OK having
# scanned nothing. Do not remove the pin, and do not restore the stderr redirect.
#
# The pin cannot be traded for a raw-byte pattern: `\xe2\x80\x94` matches the em dash
# under POSIX but NOT under a UTF-8 locale, where PCRE reads it as three characters.
# One pattern cannot cover both, so the locale is fixed and the pattern follows it.
#
# It also pins grep's DIAGNOSTIC MESSAGES to English, which the binary-match branch in
# refuse_if_incomplete reads. That branch only refines wording, never the red.
export LC_ALL=C.UTF-8

# Matches U+2014 as the literal character and as its encodings: %E2%80%94 (URL), the
# JS backslash-u escape, and the &mdash; / &#8212; / &#x2014; HTML entities. The
# escape is not theoretical in this repo: it is what the parser-template manifest
# carried, and a literal-only sweep passed straight over it.
PATTERN='\x{2014}|%E2%80%94|\\u2014|&mdash;|&#8212;|&#x2014;'

# Anything the scanner writes to stderr means either that it did not read everything it
# was given, or that it matched inside input it classifies as binary. Neither may print
# OK, and exit status cannot carry either signal: grep exits 1 on "no match", which
# xargs in turn reports as 123, so "clean" and "died part way through the batch" are
# indistinguishable by code, while a binary match exits 0 with empty stdout.
ERRLOG=$(mktemp)
FILELIST=$(mktemp)
SCANLIST=$(mktemp)
STDINBUF=$(mktemp)
BINPROBE=$(mktemp)
PROBEERR=$(mktemp)
trap 'rm -f "$ERRLOG" "$FILELIST" "$SCANLIST" "$STDINBUF" "$BINPROBE" "$PROBEERR"' EXIT

# Which mode is running, so the diagnosis below can name the right cause.
SCAN_MODE=files

# SELF-TEST: prove the scanner can still MATCH what it is meant to catch before any
# clean result is believed. `printf` emits U+2014 as its UTF-8 bytes, so this file
# still never contains the literal character. Scope the claim honestly: this proves
# the PATTERN compiles and matches, not that the scan reached every tracked file. The
# probe below and the refusals further down cover the second half.
if ! printf 'a\xe2\x80\x94b\n' | grep -qP "$PATTERN"; then
  echo "ERROR: check-no-emdash - the scanner cannot match a known em dash." >&2
  echo "       grep -P is unavailable, not in UTF-8 mode (LC_ALL=${LC_ALL}), or has" >&2
  echo "       been forced to basic regular expressions, under which the alternations" >&2
  echo "       in PATTERN are literals and match nothing." >&2
  echo "       Refusing to report a clean tree on a scanner that cannot see." >&2
  exit 1
fi

# SCANNER VISIBILITY PROBE: prove the scanner can still READ a file before believing a
# word it says about one. The self-test above asserts what the tool MATCHES; this
# asserts what it OPENS, and nothing above can substitute for it. A tool that silently
# skips a file produces the same empty output as a tool that read it and found it
# clean, and exit status cannot tell them apart because both are 0.
#
# The probe file holds a NUL byte and a seeded violation, which is precisely the input
# an `-I`-forced tool drops without a diagnostic. GNU grep does the opposite: it
# reports "binary file matches" on stderr, which refuse_if_incomplete escalates to a
# red. So the property pinned here is not "grep is GNU" (a version string is easy to
# satisfy and proves nothing about behaviour) but "a violation inside input this tool
# may classify as binary reaches me SOMEHOW": as a hit on stdout, or as a diagnostic on
# stderr. Either is fine. SILENCE IS NOT.
#
# Do NOT "fix" a red here by deleting the probe. A green report from a scanner that
# skips files is the exact defect this gate exists to prevent.
printf 'clean line\n\000 seeded \xe2\x80\x94 violation\n' > "$BINPROBE"
PROBE_OUT=$(grep -H -nP -e "$PATTERN" -- "$BINPROBE" 2>"$PROBEERR" || true)
PROBE_DIAG=$(cat "$PROBEERR" 2>/dev/null || true)
if [ -z "$PROBE_OUT" ] && [ -z "$PROBE_DIAG" ]; then
  echo "ERROR: check-no-emdash - the grep in use SILENTLY SKIPPED a probe file holding a" >&2
  echo "       NUL byte and a seeded em dash: no hit on stdout, no diagnostic on stderr," >&2
  echo "       exit 0. That is a scanner that cannot see its subject, and it is" >&2
  echo "       indistinguishable from a clean tree." >&2
  echo "       The known cause is a \`grep\` interposed with -I forced (the cosyte dev" >&2
  echo "       container ships one as a shell function; \`export -f grep\` reaches a child" >&2
  echo "       script). Run this gate with a real GNU grep." >&2
  exit 1
fi

fail_with_hits() {
  local what="$1" hits="$2"
  echo "$hits" >&2
  echo "" >&2
  echo "ERROR: check-no-emdash - em dash (U+2014, or an encoded form) found in ${what}." >&2
  echo "       cosyte never uses em dashes (founder directive; 06-brand/voice-and-tone.md)." >&2
  echo "       Rewrite with a period, colon, comma, or parentheses. Never re-encode it." >&2
  exit 1
}

refuse_if_incomplete() {
  [ -s "$ERRLOG" ] || return 0
  cat "$ERRLOG" >&2
  echo "" >&2
  # GNU grep >= 3.5 prints "grep: FILE: binary file matches" on STDERR and nothing on
  # stdout, so a match in input grep cannot read as text arrives here rather than in
  # HITS. Name that case explicitly: without this branch the run reds saying the scan
  # did not read all of its input, which sends a reader hunting an I/O failure that
  # never happened. This branch only chooses the wording. Every path below exits 1, so
  # if grep's wording ever changes the run still reds through the generic message.
  if grep -qi 'binary file' "$ERRLOG"; then
    echo "ERROR: check-no-emdash - the input named above MATCHED the banned pattern, but" >&2
    echo "       grep classifies it as binary, so the hit is reported without a line" >&2
    echo "       number. Treat it as a real em dash." >&2
    if [ "$SCAN_MODE" = stdin ]; then
      echo "       The text piped in is not valid UTF-8. Fix the encoding of whatever" >&2
      echo "       produced it, then rewrite the sentence." >&2
    else
      echo "       This repo tracks NO binaries and applies no binary partition, so this" >&2
      echo "       is either a TEXT file with a broken encoding (repair it; it should be" >&2
      echo "       UTF-8, then rewrite the sentence) or the first real binary this repo" >&2
      echo "       has ever tracked. If it is the latter, read the BINARY POSTURE note in" >&2
      echo "       this script's header before changing anything." >&2
    fi
    echo "       cosyte never uses em dashes (founder directive; 06-brand/voice-and-tone.md)." >&2
  fi
  if grep -qiv 'binary file' "$ERRLOG"; then
    echo "ERROR: check-no-emdash - the scan reported errors, so it did not read all of" >&2
    echo "       its input. Refusing to report green from an incomplete scan." >&2
  fi
  exit 1
}

# ---- stdin mode: text that is not a file (commit messages, PR title and body) ----
if [ "${1:-}" = "--stdin" ]; then
  SCAN_MODE=stdin
  LABEL="${2:-stdin}"
  # Buffer stdin to a file first, for the same reason the file mode builds its list as
  # its own command: empty input must be REFUSED, not reported green. A caller whose
  # redirect silently produced nothing (a missing file, a `git log` that wrote to a
  # different stream, a mis-typed heredoc) would otherwise get OK from a scan that read
  # nothing, which is the exact blind-gate shape this script exists to refuse. The
  # shipped workflow always emits at least the title line, so this only fires on a
  # genuinely broken caller.
  cat > "$STDINBUF"
  if [ ! -s "$STDINBUF" ]; then
    echo "ERROR: check-no-emdash - nothing arrived on stdin for ${LABEL}. Refusing to" >&2
    echo "       report green from a scan that read nothing." >&2
    exit 1
  fi
  HITS=$(grep -nP -e "$PATTERN" -- "$STDINBUF" 2>>"$ERRLOG" || true)
  refuse_if_incomplete
  [ -n "$HITS" ] && fail_with_hits "$LABEL" "$HITS"
  echo "check-no-emdash: OK (no em dashes in ${LABEL})"
  exit 0
fi

# ---- default mode: every tracked file ----
#
# `git ls-files` is relative to the working directory, so from a subdirectory it lists
# a subtree and the scan would report OK having skipped the rest of the repo. That
# matters more here than in a flat repo: config is a pnpm workspace and `pnpm -r` runs
# scripts from each package directory. Anchor at the top level, which also keeps the
# self-exclusion path below correct.
cd "$(git rev-parse --show-toplevel)"

# The choices below each close a route by which the scan could report green without
# having actually read its input, because a gate that prints OK when it did not read
# its input is worse than no gate at all.
#
# This list is NOT a claim of exhaustiveness. The bare `-` operand route was found by a
# refuter against a copy whose own comment implied it was already closed. Treat this as
# the routes that are known and closed, not as proof that no other exists.
#
#   the file list is built as its own command, not as the head of the pipeline, so a
#   `git ls-files` that fails (an unreadable or corrupt index) stops the run. Piped,
#   its status is erased by the `|| true` the no-match case needs, and the scan would
#   report OK over an empty list. An empty list is refused for the same reason.
#
#   -z, and -0 on the xargs below: `git ls-files` C-quotes any path holding a space, a
#   quote, or a non-ASCII byte, and unseparated, grep is handed a name no file has.
#   -r on xargs drops the grep invocation entirely when the list is empty; without it
#   grep falls back to reading stdin and prints OK.
#
#   -e before the pattern and -- after it, so neither the pattern nor a tracked
#   filename that starts with a dash is read as a grep option.
#
#   EVERY PATH IS `./`-PREFIXED as the list is built, which is what actually closes the
#   dash family. `--` alone does NOT: it stops `-` being parsed as an OPTION, but grep
#   then reads the bare operand `-` as STANDARD INPUT, and xargs points its child's
#   stdin at /dev/null. A tracked file literally named `-` (a `cmd > -` typo, which
#   `git add -A` stages without complaint) is therefore never opened, and the gate
#   prints OK over a live em dash. Prefixing in the LOOP rather than through `sed -z`
#   also keeps the scan a single command, so the stderr capture binds to all of it, and
#   drops a GNU-only dependency that has no self-test.
#
#   -H so every hit carries its filename. grep omits the name when handed exactly one
#   file, which an xargs batch boundary can produce, and an unattributable hit in a red
#   build is a worse report for no saving.
#
#   NO -d skip. It is the one fail-OPEN flag in this pipeline's ancestry: with it, a
#   tracked symlink to a directory is skipped silently (no stderr, so
#   refuse_if_incomplete never fires and the gate goes green). It is not needed, because
#   the loop below refuses a tracked entry that is not a regular file BY NAME, which is
#   louder still. Note that a plain `[ -d "$f" ]` test would reopen the same hole from
#   the other side: `-d` follows symlinks, so a symlink to a directory tests true and
#   would be skipped as if it were a gitlink. Hence the `! -L` guard.
#
#   no -I, and no binary partition: see BINARY POSTURE in the header.
#
#   stderr is captured and any of it fails the run (see refuse_if_incomplete above).
git ls-files -z > "$FILELIST"

if [ ! -s "$FILELIST" ]; then
  echo "ERROR: check-no-emdash - no tracked files to scan. Refusing to report green" >&2
  echo "       from a scan that read nothing." >&2
  exit 1
fi

: > "$SCANLIST"
gitlinks=0
while IFS= read -r -d '' f; do
  # The one file the scan does not cover is this script, which has to name the
  # encodings it bans.
  if [ "$f" = 'scripts/check-no-emdash.sh' ]; then
    continue
  fi

  # `git ls-files` lists a submodule as a gitlink, which on disk is a REAL directory.
  # config has none today (checked: `git ls-files -s` lists no mode 160000 entry), but
  # keep the rule narrow so it cannot quietly grow into the `-d skip` hole: a real
  # directory is skipped, a SYMLINK to a directory is not, and falls through to the
  # not-a-regular-file refusal below.
  if [ -d "$f" ] && [ ! -L "$f" ]; then
    gitlinks=$((gitlinks + 1))
    continue
  fi

  if [ ! -r "$f" ]; then
    echo "ERROR: check-no-emdash - tracked file is not readable: $f" >&2
    echo "       Refusing to report green from a scan that could not open its input." >&2
    exit 1
  fi

  # Anything tracked that is not a regular file after symlink resolution (a symlink to
  # a directory, a symlink to nothing, a device) is refused by name rather than
  # skipped. Skipping is how `-d skip` let an UNREAD entry pass green, which is a
  # missed read rather than a missed match and is the harder one to notice.
  if [ ! -f "$f" ]; then
    echo "ERROR: check-no-emdash - tracked entry is not a regular file: $f" >&2
    echo "       Refusing to report green from a scan that skipped one of its inputs." >&2
    exit 1
  fi

  printf './%s\0' "$f" >> "$SCANLIST"
done < "$FILELIST"

if [ ! -s "$SCANLIST" ]; then
  echo "ERROR: check-no-emdash - no tracked files left to scan. Refusing to report" >&2
  echo "       green from a scan that read nothing." >&2
  exit 1
fi

HITS=$(xargs -0 -r grep -H -nP -e "$PATTERN" -- < "$SCANLIST" 2>>"$ERRLOG" || true)

refuse_if_incomplete

[ -n "$HITS" ] && fail_with_hits "the tracked files listed above" "$HITS"

echo "check-no-emdash: OK (no em dashes in the tracked files; ${gitlinks} gitlink(s) skipped, this script excluded)"
