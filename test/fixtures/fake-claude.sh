#!/bin/bash
# Stands in for the Claude Desktop executable in tests: a headless Chromium showing a fixture.
# Stays in the foreground (not exec) so it can be found by path and stopped with SIGTERM.
DIR=$(mktemp -d)
"$CHROMIUM" --headless=new --no-sandbox --no-first-run --no-default-browser-check \
  --user-data-dir="$DIR" --window-size=1280,800 "$@" "$FIXTURE_URL" >/dev/null 2>&1 &
CHILD=$!
trap 'kill $CHILD 2>/dev/null; wait $CHILD; rm -rf "$DIR"; exit 0' TERM INT
wait $CHILD
rm -rf "$DIR"
