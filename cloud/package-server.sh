#!/bin/sh
# Create a fresh private allowlisted source tarball from the full project.
set -eu
umask 077
case "${1-}" in disk|cos) ;; *) echo "Usage: package-server.sh disk|cos /path/to/new-package.tar.gz" >&2; exit 2 ;; esac
test "$#" -eq 2
case "$2" in /*) output="$2" ;; *) output="$PWD/$2" ;; esac
source_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/cloud/deploy" "$stage/src" "$stage/services"
for name in cloud/server.mjs cloud/storage.mjs cloud/deploy/manxu-cloud.service cloud/deploy/manxu-caddy.snippet cloud/deploy/manxu-nginx.location.conf src/portable.js services/api.cjs; do
    test -f "$source_root/$name" && test ! -L "$source_root/$name"
    cp "$source_root/$name" "$stage/$name"
done
if [ "$1" = cos ]; then
    cp "$source_root/cloud/package.json" "$source_root/cloud/package-lock.json" "$stage/cloud/"
fi
printf '%s\n' '{"private":true,"type":"module"}' > "$stage/package.json"
# Construct before publishing and refuse to replace an existing file.
artifact=$(mktemp "$(dirname -- "$output")/.manxu-build.XXXXXXXX")
trap 'rm -rf "$stage"; rm -f "$artifact"' EXIT
(cd "$stage" && COPYFILE_DISABLE=1 tar -czf "$artifact" package.json cloud services src)
ln "$artifact" "$output"
printf '%s\n' "$output"
