---
name: Admin password secrets
description: ADMIN_PASSWORD and SUB_ADMIN_PASSWORD default values live only in Replit Secrets, not in source code.
---

`ADMIN_PASSWORD` and `SUB_ADMIN_PASSWORD` are required env secrets with no hardcoded fallback in source. They are read once in `artifacts/api-server/src/lib/admin-auth.ts`, which throws at startup if either is missing.

**Why:** a security scan found the default admin/sub-admin passwords ("17210" / "0101") duplicated as literal fallback strings (`process.env.ADMIN_PASSWORD ?? "17210"`) across ~8 route files. The user wanted the same default values preserved for behavior continuity, but removed from source as literals.

**How to apply:** any new route needing admin/sub-admin password comparison should import `ADMIN_PASSWORD` / `SUB_ADMIN_PASSWORD_DEFAULT` from `../lib/admin-auth` rather than reading `process.env.ADMIN_PASSWORD` directly or reintroducing a literal fallback.
