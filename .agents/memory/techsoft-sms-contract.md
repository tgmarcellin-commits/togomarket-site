---
name: Techsoft SMS contract
description: Required payload fields for the configured Techsoft SMS endpoint.
---

When sending an OTP through Techsoft, include the recipient phone number in the `recipient` field (normalised to international digits), in addition to any compatibility aliases.

**Why:** The configured Techsoft endpoint returns HTTP 422 and refuses delivery when `recipient` is absent, even if `to` or `phone` are supplied.

**How to apply:** Preserve `recipient` whenever the Techsoft OTP request payload is changed or refactored; do not infer a successful SMS delivery solely from stored provider credentials.