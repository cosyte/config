#!/usr/bin/env bash
# scripts/check-no-emdash.sh
# Brand rule (founder directive, 2026-07-24): we never use the em dash.
# The em dash (U+2014) reads as an AI tell, so it is banned outright across every
# Cosyte surface. The en dash (U+2013) is banned with it (operator decision,
# 2026-11-07), and this gate refuses both. Source of truth:
# `knowledgebase/06-brand/voice-and-tone.md`, which names COMMIT MESSAGES explicitly.
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
# The fix is never to re-encode the character: write a range with "to", and rewrite a
# pause with a period, a colon, a comma, or parentheses.
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
# THAT CLAIM IS ENFORCED RATHER THAN ASSERTED, because the tools this gate calls have
# codes of their own: `git` alone answers 128 for a repository it cannot read, and a
# status left to propagate is a third code arriving from a tool nobody specced. Every git
# call is tested and refused BY NAME, and the EXIT trap reduces any status that is neither
# 0 nor 1 to 1 and says which one it reduced.
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
#   * A BOUNDARY is the one entry that names part of a file rather than a whole one:
#
#       CHANGELOG.md em-only below ## Released before this file was generated
#       CHANGELOG.md unread below ## Released before this file was generated
#
#     It is for a changelog whose dated archive predates the generated part and is kept
#     verbatim. The path is ONE EXACT TRACKED PATH (no `/` prefix entry, no spaces), and
#     the text after `below ` is a WHOLE LINE of that file, matched exactly. From the
#     first line equal to it to the end of the file is the archive: `em-only` reads the
#     archive for the em dash alone, in every form, so an en dash in an old range passes
#     and an em dash still reds; `unread` does not read the archive at all. Everything
#     above the boundary line is read for both dashes like any other file, and the file's
#     NAME is scanned as always. A boundary line the file does not contain is a stale
#     entry and the run exits 1, so a lost heading fails closed instead of widening what
#     is left out. A path may carry one boundary, and a path the declaration also leaves
#     out whole is refused, since it cannot be both.
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
# EVERY MODE APPLIES IT, from one shared code path so no two can disagree. `--stdin` and
# `--self-id` subtract no path with it, so for them this is validation rather than
# filtering: an entry that names nothing tracked, or one that is not anchored, is a hole
# nobody is looking at, and which mode happens to be running is no reason to leave it
# standing. A directory that is not a git work tree tracks nothing, so it HAS no
# declaration: those two modes answer there as they always did, and the two that
# enumerate tracked paths refuse, having nothing to enumerate.
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
# Nothing checks the checker, so keep this file free of either literal character: it
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

# What counts as a dash, for U+2014 and U+2013 alike. Case never matters, so `&MDASH;`
# and `%e2%80%94` count too (D56: the forms the marketing and consulting scanner caught,
# which this gate now matches so those repos lose nothing by moving to it):
#
#   the characters                       U+2014 U+2013
#   HTML named entities, ; optional      &mdash; &ndash;
#   HTML decimal references              &#8212; &#8211;    leading zeros and a missing ; too
#   HTML hex references                  &#x2014; &#x2013;  leading zeros and a missing ; too
#   URL encoding of the UTF-8 bytes      %E2%80%94 %E2%80%93
#   backslash-u escapes (JS, JSON, Java, \u2014 \u{2014} \U00002014
#     C#, Python, Rust, Swift)
#   backslash-x escapes (PCRE, Perl)     \x{2014}
#   CSS escapes                          \2014 \002014
#   Unicode names (Python, Perl)         \N{EM DASH} \N{EN DASH}
#
# The lookaheads keep the near misses out: &#82120; and the CSS escape \20140 name other
# characters, and &mdashboard is not an entity. The escape forms are not theoretical: the
# parser-template manifest once carried a backslash-u em dash, and a literal-only sweep
# passed straight over it.
#
# A consumer may narrow WHAT IS SCANNED through the declaration above; nothing may narrow
# WHAT IS MATCHED, and widening it is a change every consuming repo inherits at once. The
# en dash's forms (operator decision, 2026-11-07) and these (D56) were such changes.
PATTERN='(?i)\x{2014}|\x{2013}|&[mn]dash(?![a-z])|&#0*821[12](?![0-9])|&#x0*201[34](?![0-9a-f])'
PATTERN+='|%E2%80%9[34]|\\u(?:0000)?201[34]|\\u\{0*201[34]\}|\\x\{0*201[34]\}'
PATTERN+='|\\0{0,2}201[34](?![0-9a-f])|\\N\{E[MN] DASH\}'

# The em dash's half of PATTERN, form for form, for the archive a declared `em-only`
# boundary reads. The self-test below holds it to matching the em dash and NOT the en
# dash, and test/check-no-emdash.test.ts holds every em form to it, so it cannot drift
# from PATTERN without a red.
EM_PATTERN='(?i)\x{2014}|&mdash(?![a-z])|&#0*8212(?![0-9])|&#x0*2014(?![0-9a-f])'
EM_PATTERN+='|%E2%80%94|\\u(?:0000)?2014|\\u\{0*2014\}|\\x\{0*2014\}'
EM_PATTERN+='|\\0{0,2}2014(?![0-9a-f])|\\N\{EM DASH\}'

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
  echo "       The modes are: (no argument) to scan every tracked file and its name;" >&2
  echo "       --stdin LABEL to scan the text arriving on stdin; --list-scanned to write the" >&2
  echo "       paths the default scan reads; --self-id to write the sha256 of the" >&2
  echo "       implementation that is executing; --help for this. Refusing to run rather" >&2
  echo "       than guess which was meant." >&2
  exit 1
}

# ONE LEADING `--` IS CONSUMED, and it is what makes the estate's own invocation work. Every
# consuming repo keeps a `check:no-emdash` package script and reaches this gate through
# `pnpm run check:no-emdash -- <flag>`; pnpm 10 forwards that separator VERBATIM, so without this
# the gate is handed `-- --stdin LABEL`. Measured, not assumed, and the old behaviour was the bad
# kind of wrong: `$1` was neither `--stdin` nor anything else the script tested, so the run fell
# through to the DEFAULT FILE SCAN and printed OK while the PR text it was asked about went unread.
# `--` is the POSIX end-of-options marker and consuming exactly one of them is what every utility
# that accepts it does; a SECOND one is an argument, and falls through to the refusal below.
if [ "$#" -gt 0 ] && [ "$1" = '--' ]; then
  shift
fi

usage() {
  cat << 'USAGE'
check-no-emdash: refuse the em dash (U+2014) and the en dash (U+2013), as the characters and
in every encoded form, in the tracked files of the repository it runs in and in their names.

  check-no-emdash.sh                 scan every tracked file and every tracked file name
  check-no-emdash.sh --stdin LABEL   scan the text on stdin (a PR title, body, commit message)
  check-no-emdash.sh --list-scanned  write the NUL-separated paths the default scan reads
  check-no-emdash.sh --self-id       write the sha256 of the implementation that is executing

A repository leaves paths out in scripts/check-no-emdash.exclude: one per line, an entry ending
in / covers everything beneath it, # starts a comment. A changelog archive is named by a boundary,
`PATH em-only below LINE` or `PATH unread below LINE`: from the first line of PATH equal to LINE to
the end, em-only reads for the em dash alone and unread reads nothing; above it, both dashes as
usual. Exit 0 means the mode completed and found nothing banned; exit 1 means anything else. Under
CI, --help exits 1: it checks nothing.
USAGE
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
  --help | -h)
    # Under CI the help is a refusal: it prints this text and checks nothing, so a CI step that
    # runs it must not pass. `CI` set to anything but empty, `false` or `0` is how GitHub Actions
    # and the other common runners announce themselves.
    if [ -n "${CI:-}" ] && [ "${CI}" != false ] && [ "${CI}" != 0 ]; then
      usage >&2
      echo "ERROR: check-no-emdash - refusing --help under CI (CI=${CI}). It prints this text and" >&2
      echo "       checks nothing, so a CI step that runs it must not pass. Run the gate without" >&2
      echo "       --help." >&2
      exit 1
    fi
    usage
    exit 0
    ;;
  *)
    refuse_arguments "unrecognised argument: ${1}"
    ;;
esac

# Anything the scanner writes to stderr means either that it did not read everything it
# was given, or that it matched inside input it classifies as binary. Neither may print
# OK, and exit status cannot carry either signal: grep exits 1 on "no match", which
# xargs in turn reports as 123, so "clean" and "died part way through the batch" are
# indistinguishable by code, while a binary match exits 0 with empty stdout.
# They are created before any mode does its work, because every mode now asks git a
# question and a refusal quotes what git said.
ERRLOG=$(mktemp)
GITERR=$(mktemp)
FILELIST=$(mktemp)
SCANLIST=$(mktemp)
PLAINLIST=$(mktemp)
NAMELIST=$(mktemp)
STDINBUF=$(mktemp)
BINPROBE=$(mktemp)
PROBEERR=$(mktemp)

# THE BACKSTOP ON THE EXIT VOCABULARY. Every refusal in this file chooses 1 deliberately,
# but a status this script never chose can still arrive from a tool it calls or from a
# signal. Each git call below is checked so the known case never reaches here; this is
# what makes "there is no third code" a property of the file rather than a list of the
# codes someone thought to look for, and it reports the status it reduced so the cause is
# not lost with it.
close_exit_vocabulary() {
  local code=$?
  rm -f "$ERRLOG" "$GITERR" "$FILELIST" "$SCANLIST" "$PLAINLIST" "$NAMELIST" "$STDINBUF" \
    "$BINPROBE" "$PROBEERR"
  if [ "$code" -ne 0 ] && [ "$code" -ne 1 ]; then
    echo "ERROR: check-no-emdash - the run ended with status ${code}. This gate reports 0" >&2
    echo "       for a mode that completed clean and 1 for everything else, so it is" >&2
    echo "       reporting 1. Whatever is above this line is what actually failed." >&2
    exit 1
  fi
}
trap close_exit_vocabulary EXIT

# ---- the repository under scan ---------------------------------------------------
#
# EVERY MODE COMES THROUGH HERE, because the declaration below is validated in every mode
# and an entry can only be judged against the tracked list. `--stdin` and `--self-id`
# subtract no path with it; what they owe is the refusal, not the filtering.
#
# NO WORK TREE IS AN ANSWER. A GIT THAT FAILED IS NOT. Where there is no work tree nothing
# is tracked, so there is no declaration to honour and no tracked file to read: the two
# modes that need neither carry on, and the two that enumerate tracked paths refuse,
# having nothing to enumerate. A git call that fails with a work tree in hand (an
# unreadable or corrupt index) is an input this gate could not read, and every mode
# refuses on that. git's status is never passed out: 128 is not on this gate's surface.
#
# `git ls-files` is relative to the working directory, so from a subdirectory it lists
# a subtree and the scan would report OK having skipped the rest of the repo. That
# matters more here than in a flat repo: config is a pnpm workspace and `pnpm -r` runs
# scripts from each package directory. Anchor at the top level, which also keeps the
# declaration's path and the self-exclusion's comparison below correct.
refuse_git() {
  echo "ERROR: check-no-emdash - ${1} failed, so this gate could not read the repository" >&2
  echo "       it was asked about. What git reported follows." >&2
  cat "$GITERR" >&2
  echo "       Refusing to report on a repository this gate could not read. Run it from a" >&2
  echo "       readable checkout of the repository it is meant to scan." >&2
  exit 1
}

# The choices below each close a route by which the scan could report green without
# having actually read its input, because a gate that prints OK when it did not read
# its input is worse than no gate at all.
#
# This list is NOT a claim of exhaustiveness. The bare `-` operand route was found by a
# refuter against a copy whose own comment implied it was already closed. Treat this as
# the routes that are known and closed, not as proof that no other exists.
#
#   the file list is built as its own command, not as the head of the pipeline, so a
#   `git ls-files` that fails (an unreadable or corrupt index) stops the run, and is
#   REFUSED BY NAME rather than left to carry git's own 128 out as this gate's exit
#   code. Piped, its status is erased by the `|| true` the no-match case needs, and the
#   scan would report OK over an empty list. An empty list is refused for the same
#   reason.
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
#   louder still. The one entry that loop skips is a gitlink, and it reads that off the
#   INDEX MODE rather than off the type ON DISK: every test of the type on disk reopens
#   the same hole from the other side, a symlink to a directory and a tracked blob
#   shadowed by a directory both testing as directories.
#
#   no -I, and no binary partition: see BINARY POSTURE in the header.
#
#   stderr is captured and any of it fails the run (see refuse_if_incomplete above).
enumerate_tracked() {
  local record tab
  git ls-files -s -z > "$FILELIST" 2> "$GITERR" || refuse_git "git ls-files -s -z"

  # `-s` carries the INDEX MODE, which is the only thing that can say an entry is a
  # gitlink. Each record is `<mode> <sha> <stage>`, a TAB, then the path; the metadata
  # holds no tab, so the first one separates the two however the path is spelled.
  tab=$'\t'
  while IFS= read -r -d '' record; do
    TRACKED_MODE+=("${record%% *}")
    TRACKED+=("${record#*"$tab"}")
  done < "$FILELIST"

  # Scoped to the two modes that read tracked files. `--stdin` scans text that is not a
  # file and `--self-id` opens only this one, so neither would be reporting green from a
  # scan that read nothing, and refusing them here would red a consumer's pull-request
  # text step over a property of a tree that step never looked at.
  if [ "${#TRACKED[@]}" -eq 0 ] && { [ "$MODE" = files ] || [ "$MODE" = list ]; }; then
    echo "ERROR: check-no-emdash - no tracked files to scan. Refusing to report green" >&2
    echo "       from a scan that read nothing." >&2
    exit 1
  fi
}

# git answers 128 for a missing repository and for most other fatals alike, so its status
# cannot tell those apart. What it can say is whether a work tree is in hand, which is the
# question every mode below needs answered.
INSIDE_WORK_TREE=$(git rev-parse --is-inside-work-tree 2> "$GITERR" || true)

TRACKED=()
TRACKED_MODE=()
ROOT=''
if [ "$INSIDE_WORK_TREE" = true ]; then
  ROOT=$(git rev-parse --show-toplevel 2> "$GITERR") || refuse_git "git rev-parse --show-toplevel"
  cd "$ROOT"
  ROOT=$(pwd -P)
  enumerate_tracked
elif [ "$MODE" = files ] || [ "$MODE" = list ]; then
  echo "ERROR: check-no-emdash - this is not a git work tree, so there is no tracked file" >&2
  echo "       list to read: $(pwd)" >&2
  cat "$GITERR" >&2
  echo "       Refusing to report on a repository this gate could not read. Run it from a" >&2
  echo "       readable checkout of the repository it is meant to scan." >&2
  exit 1
fi

is_tracked() {
  local needle="$1" t
  if [ "${#TRACKED[@]}" -eq 0 ]; then return 1; fi
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
  if [ "${#TRACKED[@]}" -eq 0 ]; then return 1; fi
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
# A declared boundary, one index per entry: the path, `em-only` or `unread`, the boundary
# line as written, and the number of the first line of the file equal to it.
BOUND_PATH=()
BOUND_MODE=()
BOUND_TEXT=()
BOUND_LINE=()
BOUNDARY_SHAPE='^([^ ]+) (em-only|unread) below (.+)$'
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

    # A BOUNDARY names part of one file. It is recognised by its shape and validated on its
    # own terms, so nothing below it can mistake it for a path with spaces in it.
    if [[ $entry =~ $BOUNDARY_SHAPE ]]; then
      b_path=${BASH_REMATCH[1]}
      b_mode=${BASH_REMATCH[2]}
      b_text=${BASH_REMATCH[3]}
      case $b_path in
        /* | ./* | *..* | */)
          refuse_declaration "$lineno" "$entry" \
            "A boundary names ONE tracked file, anchored at the repository root: not absolute, not ./, no .., and not a directory."
          ;;
      esac
      if ! is_tracked "$b_path"; then
        refuse_declaration "$lineno" "$entry" \
          "No tracked file is spelled ${b_path}. A boundary that has outlived its file is a hole nobody is looking at."
      fi
      for i in "${!BOUND_PATH[@]}"; do
        if [ "${BOUND_PATH[$i]}" = "$b_path" ]; then
          refuse_declaration "$lineno" "$entry" \
            "${b_path} already carries a boundary. A file has one archive, so it has one boundary."
        fi
      done
      if [ ! -f "$b_path" ] || [ ! -r "$b_path" ]; then
        refuse_declaration "$lineno" "$entry" \
          "${b_path} is not a readable regular file, so its boundary line cannot be looked for."
      fi
      b_line=$(grep -n -m1 -xF -e "$b_text" -- "$b_path" 2> /dev/null || true)
      b_line=${b_line%%:*}
      if [ -z "$b_line" ]; then
        refuse_declaration "$lineno" "$entry" \
          "${b_path} has no line that is exactly: ${b_text}. A lost boundary fails closed rather than leaving out more than was declared: restore the line, or correct or delete the entry."
      fi
      BOUND_PATH+=("$b_path")
      BOUND_MODE+=("$b_mode")
      BOUND_TEXT+=("$b_text")
      BOUND_LINE+=("$b_line")
      continue
    fi
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

# A path is either left out whole or read up to its boundary. Both at once would leave the
# reader unable to say which one the gate honoured, so it is refused, whichever line came
# first.
for i in "${!BOUND_PATH[@]}"; do
  if is_excluded "${BOUND_PATH[$i]}"; then
    echo "ERROR: check-no-emdash - ${DECLARATION} both leaves out ${BOUND_PATH[$i]} and" >&2
    echo "       declares a boundary in it. A file is either left out whole or read up to its" >&2
    echo "       boundary; delete one of the two entries." >&2
    exit 1
  fi
done

# The index of the boundary declared for a path, or nothing.
boundary_index() {
  local p="$1" i
  for i in "${!BOUND_PATH[@]}"; do
    if [ "${BOUND_PATH[$i]}" = "$p" ]; then
      printf '%s' "$i"
      return 0
    fi
  done
  return 1
}

# ---- --self-id: which bytes am I ------------------------------------------------
#
# Answered before the scanner assertions, because this mode reads no scanned content and
# reports nothing about a tree: a grep that cannot see leaves the answer no less true. It
# is what a consuming repo runs to prove it is executing the canonical rather than a
# drifted copy, and that question is worth answering precisely when something else about
# the environment is wrong, which is why it needs no work tree either.
#
# It comes AFTER the declaration for the one reason the criterion gives: an unusable
# declaration is refused in every mode, and a digest handed back over one would be an
# answer nobody asked for standing beside a hole nobody is looking at.
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

if [ "$MODE" = files ] || [ "$MODE" = stdin ]; then
  # SELF-TEST: prove the scanner can still MATCH what it is meant to catch before any
  # clean result is believed, and that it leaves alone what the rule allows. `printf`
  # emits U+2014, U+2013 and U+2212 as their UTF-8 bytes, so this file still never
  # contains any of those characters. Scope the claim honestly: this proves the PATTERN
  # compiles and matches, not that the scan reached every tracked file. The probe below
  # and the refusals further down cover the second half.
  if ! printf 'a\xe2\x80\x94b\n' | grep -qP "$PATTERN"; then
    echo "ERROR: check-no-emdash - the scanner cannot match a known em dash." >&2
    echo "       grep -P is unavailable, not in UTF-8 mode (LC_ALL=${LC_ALL}), or has" >&2
    echo "       been forced to basic regular expressions, under which the alternations" >&2
    echo "       in PATTERN are literals and match nothing." >&2
    echo "       Refusing to report a clean tree on a scanner that cannot see." >&2
    exit 1
  fi
  if ! printf 'a\xe2\x80\x93b\n' | grep -qP "$PATTERN"; then
    echo "ERROR: check-no-emdash - the scanner cannot match a known en dash." >&2
    echo "       grep -P is unavailable, not in UTF-8 mode (LC_ALL=${LC_ALL}), or has" >&2
    echo "       been forced to basic regular expressions, under which the alternations" >&2
    echo "       in PATTERN are literals and match nothing." >&2
    echo "       Refusing to report a clean tree on a scanner that cannot see." >&2
    exit 1
  fi
  # The clean fixture: hyphens, a range written with "to", and the minus sign (U+2212),
  # none of which the rule bans. A scanner that matched it would fail every tree, so its
  # findings could not be told from noise.
  if printf 'a-b, 2 to 3 tiers, \xe2\x88\x921\n' | grep -qP "$PATTERN"; then
    echo "ERROR: check-no-emdash - the scanner matched clean text (hyphens and a minus sign)." >&2
    echo "       Refusing to report findings from a scanner that flags what the rule allows." >&2
    exit 1
  fi
  # The archive reading a declared `em-only` boundary uses: it must still see the em dash,
  # and it must NOT see the en dash, or `em-only` would mean something other than it says.
  if [ "${#BOUND_PATH[@]}" -gt 0 ]; then
    if ! printf 'a\xe2\x80\x94b\n' | grep -qP "$EM_PATTERN"; then
      echo "ERROR: check-no-emdash - the archive scanner cannot match a known em dash." >&2
      echo "       Refusing to read a declared boundary's archive with a scanner that cannot see." >&2
      exit 1
    fi
    if printf 'a\xe2\x80\x93b\n' | grep -qP "$EM_PATTERN"; then
      echo "ERROR: check-no-emdash - the archive scanner matched an en dash, so it is not reading" >&2
      echo "       for the em dash alone. Refusing to report what an em-only boundary allows." >&2
      exit 1
    fi
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
    echo "       The known cause is a \`grep\` interposed with -I forced (the Cosyte dev" >&2
    echo "       container ships one as a shell function; \`export -f grep\` reaches a child" >&2
    echo "       script). Run this gate with a real GNU grep." >&2
    exit 1
  fi
fi

fail_with_hits() {
  local what="$1" hits="$2"
  echo "$hits" >&2
  echo "" >&2
  echo "ERROR: check-no-emdash - em or en dash (U+2014 or U+2013, or an encoded form) found in ${what}." >&2
  echo "       We never use em or en dashes (founder directive; 06-brand/voice-and-tone.md)." >&2
  echo "       Write a range with \"to\"; rewrite a pause with a period, colon, comma, or" >&2
  echo "       parentheses. Never re-encode it." >&2
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
    echo "       number. Treat it as a real em or en dash." >&2
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
    echo "       We never use em or en dashes (founder directive; 06-brand/voice-and-tone.md)." >&2
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
  echo "check-no-emdash: OK (no em or en dashes in ${LABEL})"
  exit 0
fi

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
: > "$NAMELIST"
gitlinks=0
scanned=0
self_excluded=0
declared_excluded=0
for i in "${!TRACKED[@]}"; do
  f=${TRACKED[$i]}
  # The implementation under scan, excluded only because it is tracked HERE. It has to
  # name the encodings it bans, and nothing checks the checker.
  if [ -n "$SELF_REL" ] && [ "$f" = "$SELF_REL" ]; then
    self_excluded=$((self_excluded + 1))
    continue
  fi

  # What the repo declared it leaves out. Checked before the entry is opened, because an
  # excluded path is not read and its type on disk is therefore not this gate's business.
  # It is not scanned at all, so its NAME is left out with its content.
  if is_excluded "$f"; then
    declared_excluded=$((declared_excluded + 1))
    continue
  fi

  # A NAME IS COPY TOO (D56): every tracked path the declaration does not leave out has its
  # name scanned, a gitlink's included, before any test of what is on disk.
  printf '%s\0' "$f" >> "$NAMELIST"

  # `git ls-files` lists a submodule as a gitlink, which on disk is a REAL directory.
  # config has none today (checked: `git ls-files -s` lists no mode 160000 entry). The
  # skip is keyed on the INDEX MODE and never on the type on disk, because the two
  # disagree in the case that costs the most: a tracked regular file shadowed on disk by
  # a directory tests as a directory, so a type-keyed skip reads none of its indexed
  # content, counts it as a gitlink it is not, and prints OK over it. Keyed on 160000 it
  # falls through to the not-a-regular-file refusal below and is named.
  if [ "${TRACKED_MODE[$i]}" = 160000 ]; then
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

  # A file with a declared boundary is read on its own below, in two halves. It is still
  # READ, so it is listed for --list-scanned and counted as scanned.
  if boundary_index "$f" > /dev/null; then
    printf '%s\0' "$f" >> "$PLAINLIST"
    scanned=$((scanned + 1))
    continue
  fi

  printf './%s\0' "$f" >> "$SCANLIST"
  printf '%s\0' "$f" >> "$PLAINLIST"
  scanned=$((scanned + 1))
done

if [ ! -s "$SCANLIST" ] && [ "${#BOUND_PATH[@]}" -eq 0 ]; then
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

# File names first: NUL-separated in, one per line out. `-a` because a name is text whatever
# bytes it holds, and the stderr capture refuses a name scan that could not complete.
NAME_HITS=$(grep -z -a -P -e "$PATTERN" < "$NAMELIST" 2>> "$ERRLOG" | tr '\0' '\n' || true)
refuse_if_incomplete

HITS=$(xargs -0 -r grep -H -nP -e "$PATTERN" -- < "$SCANLIST" 2>> "$ERRLOG" || true)

refuse_if_incomplete

# The files with a declared boundary. Every hit is found with the full pattern first, so
# the line numbers are the file's own; a hit above the boundary line stands, and a hit at
# or below it stands only for `em-only` and only when the line holds an em dash.
bounded_note=''
for i in "${!BOUND_PATH[@]}"; do
  b_path=${BOUND_PATH[$i]}
  b_line=${BOUND_LINE[$i]}
  b_mode=${BOUND_MODE[$i]}
  b_hits=$(grep -H -nP -e "$PATTERN" -- "./${b_path}" 2>> "$ERRLOG" || true)
  refuse_if_incomplete
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    n=${hit#"./${b_path}:"}
    n=${n%%:*}
    keep=0
    if [ "$n" -lt "$b_line" ]; then
      keep=1
    elif [ "$b_mode" = em-only ] && printf '%s\n' "${hit#"./${b_path}:${n}:"}" | grep -qP -e "$EM_PATTERN"; then
      keep=1
    fi
    if [ "$keep" -eq 1 ]; then
      HITS="${HITS:+${HITS}
}${hit}"
    fi
  done <<< "$b_hits"
  if [ "$b_mode" = em-only ]; then
    bounded_note="${bounded_note}, ${b_path} from line ${b_line} read for the em dash only"
  else
    bounded_note="${bounded_note}, ${b_path} from line ${b_line} not read"
  fi
done

if [ -n "$NAME_HITS" ] && [ -n "$HITS" ]; then
  fail_with_hits "the tracked file names and the tracked files listed above" \
    "$NAME_HITS"$'\n'"$HITS"
fi
[ -n "$NAME_HITS" ] && fail_with_hits "the tracked file names listed above" "$NAME_HITS"
[ -n "$HITS" ] && fail_with_hits "the tracked files listed above" "$HITS"

echo "check-no-emdash: OK (no em or en dashes in ${scanned} of ${#TRACKED[@]} tracked file(s)" \
  "or their names; ${gitlinks} gitlink(s) skipped, ${self_excluded} excluded as the" \
  "implementation under scan, ${declared_excluded} excluded by ${DECLARATION}${bounded_note})"
