---
name: relay-status
description: Show every feature under .relay/ and its next step
---

Show relay status from disk. Do not read `.relay/` yourself and do not summarize.

1. Find the relay plugin root: the directory whose `.cursor-plugin/plugin.json` has `"name": "relay"` and that contains `scripts/relay.ts`. Look in `~/.cursor/plugins/local/relay`, under `~/.cursor/plugins/cache`, and in the current workspace when that workspace is this plugin.
2. Run `node <plugin-root>/scripts/relay.ts status`.
3. Print stdout unchanged. If the script is missing, say so and stop.
