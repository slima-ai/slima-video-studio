# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem or a leaked key.

Use **Report a vulnerability** on this repository's **Security** tab
([direct link](https://github.com/slima-ai/slima-video-studio/security/advisories/new)) to report it privately.
Only the maintainers can see the report.

Please include:

- what you found and why it matters,
- the steps to reproduce it (or a proof of concept),
- the app version and your operating system.

Do not put API keys, tokens or other secrets in the report. If you found a leaked key, tell us where it is
and we will take it from there; revoke the key with its provider as well.

This is an early-stage project run by a small team. We read every report and will reply as soon as we can.
We cannot promise a fixed response time or a bounty.

## Supported versions

Only the latest release gets security fixes.

## What is in scope

- The desktop app and the scripts in this repository (for example, a way to read a stored API key, to make the app
  run code it should not, or to reach files outside the project folders).
- The release files published on the Releases page.

Problems in services the app talks to (OpenRouter, fal.ai, Slima) or in third-party dependencies should be reported to
those projects; if a dependency problem affects this app in a way we can fix, we are glad to hear about it.
