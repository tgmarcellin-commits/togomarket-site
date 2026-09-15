---
name: Connexion DB de publication
description: Pourquoi la publication TogoMarket doit utiliser la connexion PostgreSQL gérée par Replit.
---

En production, TogoMarket doit privilégier `DATABASE_URL`, car la base de production Replit contient les données historiques. `TOGOMARKET_DATABASE_URL` est conservée uniquement comme compatibilité de développement ou de migration ; elle peut contenir une ancienne connexion PostgreSQL dont le mot de passe n'est plus accepté.

**Why:** La base de production et la base de développement sont séparées, et l'ancienne connexion personnalisée refusait l'authentification alors que la base de production restait accessible en lecture seule.

**How to apply:** Toute modification de la sélection de connexion doit conserver `DATABASE_URL` en priorité quand `NODE_ENV=production` et ne jamais remplacer la base de production par une base de développement vide.