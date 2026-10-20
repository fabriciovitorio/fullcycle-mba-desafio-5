#!/bin/sh
set -eu
umask 077
: "${STORAGE_BUCKET:?STORAGE_BUCKET is required}"
: "${STORAGE_ACCESS_KEY:?STORAGE_ACCESS_KEY is required}"
: "${STORAGE_SECRET_KEY:?STORAGE_SECRET_KEY is required}"
# Never enable shell tracing or print credentials / signed URLs.
mc alias set local http://minio:9000 "$STORAGE_ACCESS_KEY" "$STORAGE_SECRET_KEY" >/dev/null
mc mb --ignore-existing "local/$STORAGE_BUCKET"
mc anonymous set none "local/$STORAGE_BUCKET"
echo 'Private storage bucket initialized.'
