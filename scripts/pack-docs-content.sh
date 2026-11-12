#!/usr/bin/env bash
# scripts/pack-docs-content.sh <output file>
#
# Packs docs-content/ into the archive docs.cosyte.com reads from a GitHub release,
# `docs-content.tar.gz`: every file of the folder at the archive's root, as `cosyte-process
# pack-docs` lays it out for a library. That command cannot be used here: it also packs `src/` and
# `tsconfig.json` for the API reference, and this repository has neither at its root, so the site
# would list it as narrative only.
#
# The archive holds regular files only (no directory, link or device entry), in byte order of their
# paths, owned by 0:0 with a zero time, so the same tree always packs to the same bytes. It refuses,
# before writing anything, when the folder lacks `intro.md` or `sidebars.json` (the two files the
# site requires) or holds anything but regular files and directories.
#
# Exit 0 packed, 1 the folder is not fit to pack, 2 bad usage.

set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: scripts/pack-docs-content.sh <output file>" >&2
  exit 2
fi
out="$1"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docs="${root}/docs-content"

for required in intro.md sidebars.json; do
  if [ ! -f "${docs}/${required}" ]; then
    echo "pack-docs-content: docs-content/${required} is missing; docs.cosyte.com requires it" >&2
    exit 1
  fi
done

odd="$(cd "${docs}" && find . ! -type f ! -type d -printf '%P\n')"
if [ -n "${odd}" ]; then
  echo "pack-docs-content: docs-content/ holds entries that are not regular files:" >&2
  printf '%s\n' "${odd}" | sed 's/^/  /' >&2
  exit 1
fi

(cd "${docs}" && find . -type f -printf '%P\0' | LC_ALL=C sort -z) |
  tar --create --file - --directory "${docs}" \
    --owner=0 --group=0 --numeric-owner --mtime='@0' --mode='u+rw,go+r,go-w' \
    --no-recursion --null --files-from - |
  gzip -n -9 >"${out}"
echo "pack-docs-content: wrote ${out} ($(tar --list --gzip --file "${out}" | wc -l) files)"
