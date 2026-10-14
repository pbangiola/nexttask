#!/usr/bin/env bash
# Compatibility entrypoint; deleted feature refs are never cloned.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/qa-integrated-beta.sh" "$@"
