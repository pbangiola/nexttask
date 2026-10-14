#!/usr/bin/env bash
# Compatibility entrypoint; all current QA uses one runner.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/qa-integrated-beta.sh" "$@"
