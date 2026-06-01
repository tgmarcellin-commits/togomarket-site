---
name: Scripts package DB access
description: Dépendances nécessaires pour accéder à la base de données depuis le package scripts
---

## Règle
Le package `@workspace/scripts` doit déclarer explicitement `drizzle-orm` dans ses propres `dependencies` (en plus de `@workspace/db`) pour que tsx puisse résoudre les imports transitifs.

**Why:** Node ESM ne remonte pas les dépendances transitives ; `drizzle-orm` est une peer dep de `@workspace/db` et n'est pas auto-hoistée vers scripts.

**How to apply:**
- `"drizzle-orm": "catalog:"` dans `scripts/package.json` > `dependencies`
- `"@workspace/db": "workspace:*"` idem
- Lancer `pnpm install` après modification de package.json
