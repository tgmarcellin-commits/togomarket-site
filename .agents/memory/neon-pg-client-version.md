---
name: Neon PostgreSQL client version
description: PostgreSQL client compatibility when backing up newer Neon targets in this workspace
---

Use a `pg_dump` major version at least as new as the server being backed up, even if the data being migrated originates on an older PostgreSQL server. Keep pre-migration backups outside version control with restrictive permissions.

**Why:** The default workspace client was older than a Neon target; the pinned package index did not offer a matching client, so a newer Nix package source was needed before the target could be backed up safely.

**How to apply:** Before any future database copy, compare client and both server versions; obtain a suitable client without exposing database URLs in shell arguments, back up the target first, and verify the backup before replacing anything.