---
name: relay-done
description: Mark a feature shipped once its merge request is merged
---

Mark a relay feature shipped by writing `status: shipped` into its `plan.md`. Do not edit the plan yourself.

1. Find the relay plugin root: the directory whose `.cursor-plugin/plugin.json` has `"name": "relay"` and that contains `scripts/relay.ts`. Look in `~/.cursor/plugins/local/relay`, under `~/.cursor/plugins/cache`, and in the current workspace when that workspace is this plugin.
2. Run `node <plugin-root>/scripts/relay.ts done -- <argument>`, where `<argument>` is the text the user typed after this command (empty when they passed none).
3. Print stdout unchanged.
4. Exit code 2 means the plan is not `in-review`. Ask the user the question the script printed. Run the same command again with `--yes` added only after they agree. Any other non-zero exit stops there.
