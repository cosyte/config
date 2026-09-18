#!/usr/bin/env bash
# scripts/check-no-emdash.sh
# Brand rule (founder directive, 2026-07-24): cosyte never uses the em dash.
# The em dash (U+2014) reads as an AI tell, so it is banned outright across every
# cosyte surface. Source of truth: `knowledgebase/06-brand/voice-and-tone.md`
# ("No em dashes. Ever."), which names COMMIT MESSAGES explicitly.
#
# THIS FILE IS THE ONE IMPLEMENTATION OF THE EM-DASH GATE FOR THIS ESTATE, and config
# owns it. Every other repo EXECUTES THESE EXACT BYTES and tracks no implementation of
# its own: the copy at `packages/script-utils/check-no-emdash.sh` is untracked build
# output, generated from this file by `scripts/pack-emdash-gate.mjs` and published in
# the `@cosyte/script-utils` tarball, so a consumer runs
# `bash node_modules/@cosyte/script-utils/check-no-emdash.sh`. `--self-id` below is how
# a consumer proves it is running these bytes rather than a drifted copy.
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
# ---------------------------------------------------------------------------
# THE SURFACE. Four modes, and the exit vocabulary is CLOSED AT TWO CODES.
#
#   (no argument)     scan every tracked file
#   --stdin LABEL     scan the text arriving on stdin (CI feeds it the PR title, body
#                     and commit messages)
#   --list-scanned    write to stdout the NUL-separated, repo-root-relative path of
#                     every tracked file the default scan would read, and nothing else
#   --self-id         write to stdout one line, the lowercase 64-character sha256 of
#                     the implementation file that is executing, and nothing else
#
# Exit 0 means the mode completed and found nothing banned. Exit 1 means anything else:
# a banned form was found, an input could not be read, an input was not scanned, a
# declaration was unusable, or an argument was not recognised. THERE IS NO THIRD CODE,
# and adding one is a change to this surface that is specced as one.
#
# Hits and diagnostics go to STDERR in every mode. STDOUT carries the human OK line in
# the two SCANNING modes and the machine output in the two REPORTING modes, never both
# in one mode: `--list-scanned` is piped into a comparison and `--self-id` into a digest
# equality, and a progress line on either would corrupt the thing reading it.
#
# WHY THE TWO REPORTING MODES EXIST. "One implementation, many consumers" is otherwise
# an intention rather than a fact. `--self-id` makes "these are the same bytes"
# checkable by a command instead of by reading two files, and `--list-scanned` makes
# "the canonical reads everything the retired variant read" checkable by comparing two
# sets instead of by comparing two filter expressions. Both REPORT what this gate
# already does; neither grades anything that was not graded before.
#
# THE REPORTING MODES DO NOT RUN THE SCANNER SELF-TEST OR THE VISIBILITY PROBE, and
# that is deliberate rather than an omission. Both assertions are preconditions for
# BELIEVING A CLEAN SCAN, and neither reporting mode produces one: `--list-scanned`
# matches nothing and `--self-id` opens nothing but this file. A grep that cannot see
# does not make either answer wrong, and refusing them for it would red a consumer's
# coverage comparison for a condition that has no bearing on coverage. The two scanning
# modes, which DO produce a clean result, run both.
# ---------------------------------------------------------------------------
# THE EXCLUSION DECLARATION. A consuming repo declares what its scan leaves out in a
# tracked file at its top level, `scripts/check-no-emdash.exclude`. THIS REPO SHIPS NO
# SUCH FILE and is not expected to: config's own scan covers every tracked path.
#
#   * One entry per line. Blank lines, and lines whose first non-space character is
#     `#`, are ignored.
#   * An entry ending in `/` is a PATH PREFIX and covers every tracked path beneath it.
#     Any other entry is ONE EXACT TRACKED PATH.
#   * Entries are repo-root-relative and ANCHORED. An entry that is absolute, begins
#     with `./`, or contains `..` is unusable and the run exits 1.
#   * An entry matching NO tracked path is unusable and the run exits 1, because an
#     exclusion that has outlived its subject is a hole nobody is looking at.
#   * A repo with no such file declares no exclusions.
#   * The declaration file is itself tracked and is SCANNED LIKE ANY OTHER TRACKED
#     FILE. It is not self-excluding.
#
# AN ENTRY IS THE LINE VERBATIM: nothing is trimmed off either end, because a path is
# bytes and trimming would invent a second spelling for one entry. A line carrying
# stray whitespace or a trailing carriage return therefore matches no tracked path and
# is refused as stale, which is loud; the refusal names that possibility so the reader
# is not left hunting a path that looks right.
#
# THE DECLARATION IS READ ONLY WHEN IT IS TRACKED, which is the Contract's own wording
# ("a tracked file at its top level") taken literally. An untracked file at that path
# is not a reviewed, committed declaration, so it narrows nothing; the run says on
# stderr that it is being ignored rather than honouring an exclusion nobody approved.
#
# WHICH MODES APPLY IT: the two that ENUMERATE TRACKED PATHS, from one shared code path
# so they cannot disagree. `--stdin` scans text that is not a file and `--self-id`
# opens only this file, so in neither is there a path for an exclusion to subtract.
# ---------------------------------------------------------------------------
# THE SELF-EXCLUSION IS RESOLVED AT RUNTIME, NOT HARDCODED. The gate works out the
# implementation file it is executing and excludes that path from its own scan when,
# and ONLY when, that path is tracked in the repo under scan. In config that resolves
# to `scripts/check-no-emdash.sh`, which has to name the encodings it bans. In a
# consuming repo the implementation lives under `node_modules/`, which is tracked
# nowhere, so nothing is excluded and the consumer's own tree is scanned whole. A
# hardcoded name would have excluded a consuming repo's `scripts/check-no-emdash.sh`
# whether or not one existed, which is an exclusion granted to a file nobody reviewed.
#
# Nothing checks the checker, so keep this file free of the literal character: it
# matches by codepoint and by encoding and never spells one out.
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
#
# THE MATCH VOCABULARY IS FROZEN at these six forms. A consumer may narrow WHAT IS
# SCANNED through the declaration above; nothing may narrow WHAT IS MATCHED, and
# widening it is a change every consuming repo inherits at once and is specced as one.
PATTERN='\x{2014}|%E2%80%94|\\u2014|&mdash;|&#8212;|&#x2014;'

# The declaration's path, relative to the top level of the repo under scan. Deliberately
# NOT relative to this file: in a consuming repo this file lives under `node_modules/`
# and the declaration is the consumer's own tracked file.
DECLARATION='scripts/check-no-emdash.exclude'

# ---- resolve the implementation file that is executing --------------------------
#
# Resolved HERE, before any `cd`, because `${BASH_SOURCE[0]}` may be relative to the
# working directory the caller had. `readlink -f` is not used: it is GNU-only, and this
# gate runs on developer machines as well as on ubuntu runners. The loop below is the
# portable equivalent and follows a chain of symlinks, which is how a `node_modules`
# copy reached through a pnpm store link still resolves to the file that is executing.
resolve_self() {
  local src="${BASH_SOURCE[0]}" dir
  while [ -L "$src" ]; do
    dir=$(cd -P "$(dirname "$src")" > /dev/null && pwd)
    src=$(readlink "$src")
    case $src in
      /*) ;;
      *) src="$dir/$src" ;;
    esac
  done
  dir=$(cd -P "$(dirname "$src")" > /dev/null && pwd)
  printf '%s/%s\n' "$dir" "$(basename "$src")"
}
SELF_PATH=$(resolve_self)

# ---- argument dispatch ----------------------------------------------------------
#
# Every mode is named here and anything else is REFUSED rather than guessed at. An
# unrecognised flag silently taken as "the default scan" is how a caller ends up
# believing it ran `--list-scanned` while reading an OK line, and the closed exit
# vocabulary means the mistake carries no distinguishing code of its own.
MODE=files
LABEL=stdin
SCAN_MODE=files

refuse_arguments() {
  echo "ERROR: check-no-emdash - $1" >&2
  echo "       The modes are: (no argument) to scan every tracked file; --stdin LABEL" >&2
  echo "       to scan the text arriving on stdin; --list-scanned to write the paths the" >&2
  echo "       default scan reads; --self-id to write the sha256 of the implementation" >&2
  echo "       that is executing. Refusing to run rather than guess which was meant." >&2
  exit 1
}

case "${1:-}" in
  '')
    MODE=files
    ;;
  --stdin)
    MODE=stdin
    SCAN_MODE=stdin
    LABEL="${2:-stdin}"
    if [ "$#" -gt 2 ]; then
      refuse_arguments "--stdin takes one LABEL, and this was given after it: ${3}"
    fi
    ;;
  --list-scanned)
    MODE=list
    if [ "$#" -gt 1 ]; then
      refuse_arguments "--list-scanned takes no further argument, and this was given: ${2}"
    fi
    ;;
  --self-id)
    MODE=self-id
    if [ "$#" -gt 1 ]; then
      refuse_arguments "--self-id takes no further argument, and this was given: ${2}"
    fi
    ;;
  *)
    refuse_arguments "unrecognised argument: ${1}"
    ;;
esac

# ---- --self-id: which bytes am I ------------------------------------------------
#
# Answered FIRST, before the scanner assertions and before anything is created in the
# temporary directory, because this mode reads no scanned content and reports nothing
# about a tree. It is what a consuming repo runs to prove it is executing the canonical
# rather than a drifted copy, and that question is worth answering precisely when
# something else about the environment is wrong.
#
# The digest tool is whichever of the three is present, and the answer is CHECKED to be
# 64 lowercase hex characters before it is printed: a tool that emitted a different
# shape would otherwise hand a consumer a string that compares unequal for a reason
# nobody could see.
if [ "$MODE" = self-id ]; then
  if [ ! -r "$SELF_PATH" ]; then
    echo "ERROR: check-no-emdash - cannot read the implementation file to identify it:" >&2
    echo "       ${SELF_PATH}" >&2
    echo "       Refusing to report an identity for bytes that could not be read." >&2
    exit 1
  fi
  DIGEST=''
  if command -v sha256sum > /dev/null 2>&1; then
    DIGEST=$(sha256sum -- "$SELF_PATH")
    DIGEST=${DIGEST%% *}
  elif command -v shasum > /dev/null 2>&1; then
    DIGEST=$(shasum -a 256 -- "$SELF_PATH")
    DIGEST=${DIGEST%% *}
  elif command -v openssl > /dev/null 2>&1; then
    DIGEST=$(openssl dgst -sha256 -r "$SELF_PATH")
    DIGEST=${DIGEST%% *}
  else
    echo "ERROR: check-no-emdash - no sha256 tool is available (looked for sha256sum," >&2
    echo "       shasum and openssl), so this gate cannot say which bytes it is." >&2
    echo "       Install coreutils or openssl, then re-run --self-id." >&2
    exit 1
  fi
  case $DIGEST in
    *[!0-9a-f]* | '')
      echo "ERROR: check-no-emdash - the sha256 tool did not produce a digest:" >&2
      echo "       ${DIGEST}" >&2
      echo "       Refusing to report an identity this gate cannot vouch for." >&2
      exit 1
      ;;
  esac
  if [ "${#DIGEST}" -ne 64 ]; then
    echo "ERROR: check-no-emdash - the sha256 tool produced a ${#DIGEST}-character digest," >&2
    echo "       and a sha256 is 64. Refusing to report an identity this gate cannot" >&2
    echo "       vouch for." >&2
    exit 1
  fi
  printf '%s\n' "$DIGEST"
  exit 0
fi

# Anything the scanner writes to stderr means either that it did not read everything it
# was given, or that it matched inside input it classifies as binary. Neither may print
# OK, and exit status cannot carry either signal: grep exits 1 on "no match", which
# xargs in turn reports as 123, so "clean" and "died part way through the batch" are
# indistinguishable by code, while a binary match exits 0 with empty stdout.
ERRLOG=$(mktemp)
FILELIST=$(mktemp)
SCANLIST=$(mktemp)
PLAINLIST=$(mktemp)
STDINBUF=$(mktemp)
BINPROBE=$(mktemp)
PROBEERR=$(mktemp)
trap 'rm -f "$ERRLOG" "$FILELIST" "$SCANLIST" "$PLAINLIST" "$STDINBUF" "$BINPROBE" "$PROBEERR"' EXIT

if [ "$MODE" = files ] || [ "$MODE" = stdin ]; then
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
  PROBE_OUT=$(grep -H -nP -e "$PATTERN" -- "$BINPROBE" 2> "$PROBEERR" || true)
  PROBE_DIAG=$(cat "$PROBEERR" 2> /dev/null || true)
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
if [ "$MODE" = stdin ]; then
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
  HITS=$(grep -nP -e "$PATTERN" -- "$STDINBUF" 2>> "$ERRLOG" || true)
  refuse_if_incomplete
  [ -n "$HITS" ] && fail_with_hits "$LABEL" "$HITS"
  echo "check-no-emdash: OK (no em dashes in ${LABEL})"
  exit 0
fi

# ---- the two modes that enumerate tracked paths ----------------------------------
#
# `git ls-files` is relative to the working directory, so from a subdirectory it lists
# a subtree and the scan would report OK having skipped the rest of the repo. That
# matters more here than in a flat repo: config is a pnpm workspace and `pnpm -r` runs
# scripts from each package directory. Anchor at the top level, which also keeps the
# declaration's path and the self-exclusion's comparison below correct.
cd "$(git rev-parse --show-toplevel)"
ROOT=$(pwd -P)

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
#   THE `./` PREFIX IS FOR GREP AND NOT FOR THE REPORT. `--list-scanned` writes the
#   repo-root-relative path, so the loop builds BOTH spellings in one pass rather than
#   transforming one into the other afterwards: a second pass is a second place for the
#   reported set and the scanned set to disagree, and the whole value of that mode is
#   that they cannot.
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

TRACKED=()
while IFS= read -r -d '' f; do
  TRACKED+=("$f")
done < "$FILELIST"

is_tracked() {
  local needle="$1" t
  for t in "${TRACKED[@]}"; do
    if [ "$t" = "$needle" ]; then return 0; fi
  done
  return 1
}

# Does any tracked path answer to this entry? A prefix entry is answered by anything
# beneath it; any other entry only by itself. Both are LITERAL comparisons: `$entry` is
# quoted inside the pattern, so a glob character in a declared path is a character
# rather than a wildcard.
entry_matches_a_tracked_path() {
  local entry="$1" t
  case $entry in
    */)
      for t in "${TRACKED[@]}"; do
        case $t in
          "$entry"*) return 0 ;;
        esac
      done
      ;;
    *)
      for t in "${TRACKED[@]}"; do
        if [ "$t" = "$entry" ]; then return 0; fi
      done
      ;;
  esac
  return 1
}

# ---- the exclusion declaration ---------------------------------------------------
EXCLUDES=()
refuse_declaration() {
  local line="$1" entry="$2" what="$3"
  echo "ERROR: check-no-emdash - unusable entry in ${DECLARATION}, line ${line}: ${entry}" >&2
  echo "       ${what}" >&2
  echo "       Refusing to scan under a declaration this gate cannot honour." >&2
  exit 1
}

if is_tracked "$DECLARATION"; then
  if [ ! -r "$DECLARATION" ]; then
    echo "ERROR: check-no-emdash - the exclusion declaration is tracked but could not be" >&2
    echo "       read: ${DECLARATION}" >&2
    echo "       Refusing to scan without knowing what the declaration leaves out." >&2
    exit 1
  fi
  lineno=0
  line=''
  # `|| [ -n "$line" ]` so a final entry with no trailing newline is still read.
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    # Blank lines and comments are ignored, and the comment test is on the first
    # NON-SPACE character, so an indented comment is still a comment. `stripped` exists
    # only to answer those two questions; the ENTRY below is the line verbatim.
    stripped=${line#"${line%%[![:space:]]*}"}
    if [ -z "$stripped" ]; then continue; fi
    case $stripped in
      '#'*) continue ;;
    esac

    # The entry is the line VERBATIM. See the header: nothing is trimmed, because a path
    # is bytes. The anchor rules are the whole of what makes an entry usable on its face.
    entry=$line
    case $entry in
      /*)
        refuse_declaration "$lineno" "$entry" \
          "An entry is repo-root-relative, and this one is absolute. Drop the leading /."
        ;;
      ./*)
        refuse_declaration "$lineno" "$entry" \
          "An entry is anchored at the repository root, so it does not begin with ./."
        ;;
      *..*)
        refuse_declaration "$lineno" "$entry" \
          "An entry may not contain .., which would reach outside the repository."
        ;;
    esac

    if ! entry_matches_a_tracked_path "$entry"; then
      echo "ERROR: check-no-emdash - stale entry in ${DECLARATION}, line ${lineno}: ${entry}" >&2
      if [ "$entry" != "$stripped" ] || [ "$entry" != "${entry%[[:space:]]}" ]; then
        echo "       The entry carries leading or trailing whitespace (a stray space, or a" >&2
        echo "       trailing carriage return from a CRLF file), and that whitespace is part" >&2
        echo "       of the path this gate looked for. Remove it." >&2
      elif [ "${entry%/}" != "$entry" ]; then
        echo "       No tracked path lies beneath it. An exclusion that has outlived its" >&2
        echo "       subject is a hole nobody is looking at: delete the entry, or correct" >&2
        echo "       it to the directory it was meant to name." >&2
      else
        echo "       No tracked path is spelled that way. An exclusion that has outlived its" >&2
        echo "       subject is a hole nobody is looking at: delete the entry, or correct it" >&2
        echo "       to the path it was meant to name. A directory entry ends in /." >&2
      fi
      exit 1
    fi

    EXCLUDES+=("$entry")
  done < "$DECLARATION"
elif [ -e "$DECLARATION" ]; then
  echo "NOTE: check-no-emdash - ${DECLARATION} exists but is not tracked, so it is being" >&2
  echo "      IGNORED and nothing is excluded by it. What this gate scans is decided only" >&2
  echo "      by files that have been reviewed and committed. Track it, or delete it." >&2
fi

is_excluded() {
  local p="$1" e
  if [ "${#EXCLUDES[@]}" -eq 0 ]; then return 1; fi
  for e in "${EXCLUDES[@]}"; do
    case $e in
      */)
        case $p in
          "$e"*) return 0 ;;
        esac
        ;;
      *)
        if [ "$p" = "$e" ]; then return 0; fi
        ;;
    esac
  done
  return 1
}

# ---- the self-exclusion, resolved rather than named ------------------------------
#
# The implementation's path AS THIS REPO WOULD SPELL IT, which exists only when the
# file is inside this repo's tree at all. In a consuming repo it is under node_modules
# and SELF_REL is either empty or an untracked path, so nothing is excluded: the
# membership test below is against the tracked list, never against the filesystem.
SELF_REL=''
case $SELF_PATH in
  "$ROOT"/*) SELF_REL=${SELF_PATH#"$ROOT"/} ;;
esac

: > "$SCANLIST"
: > "$PLAINLIST"
gitlinks=0
scanned=0
self_excluded=0
declared_excluded=0
for f in "${TRACKED[@]}"; do
  # The implementation under scan, excluded only because it is tracked HERE. It has to
  # name the encodings it bans, and nothing checks the checker.
  if [ -n "$SELF_REL" ] && [ "$f" = "$SELF_REL" ]; then
    self_excluded=$((self_excluded + 1))
    continue
  fi

  # What the repo declared it leaves out. Checked before the entry is opened, because an
  # excluded path is not read and its type on disk is therefore not this gate's business.
  if is_excluded "$f"; then
    declared_excluded=$((declared_excluded + 1))
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
  printf '%s\0' "$f" >> "$PLAINLIST"
  scanned=$((scanned + 1))
done

if [ ! -s "$SCANLIST" ]; then
  echo "ERROR: check-no-emdash - no tracked files left to scan. Refusing to report" >&2
  echo "       green from a scan that read nothing." >&2
  exit 1
fi

# ---- --list-scanned: what the default scan reads ---------------------------------
#
# The same set the scan is about to read, off the same pass, so a consumer comparing
# coverage against a retired variant is comparing what this gate ACTUALLY opens rather
# than a description of it. NUL-separated and nothing else on stdout: every diagnostic
# above went to stderr, so this stream is safe to pipe into `sort`, `comm` or `xargs -0`.
if [ "$MODE" = list ]; then
  cat "$PLAINLIST"
  exit 0
fi

HITS=$(xargs -0 -r grep -H -nP -e "$PATTERN" -- < "$SCANLIST" 2>> "$ERRLOG" || true)

refuse_if_incomplete

[ -n "$HITS" ] && fail_with_hits "the tracked files listed above" "$HITS"

echo "check-no-emdash: OK (no em dashes in ${scanned} of ${#TRACKED[@]} tracked file(s);" \
  "${gitlinks} gitlink(s) skipped, ${self_excluded} excluded as the implementation under" \
  "scan, ${declared_excluded} excluded by ${DECLARATION})"
