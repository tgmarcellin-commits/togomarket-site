---
name: CSRF sur clients intégrés
description: Pourquoi la protection CSRF ne doit pas dépendre d’un cookie dans les PWA, aperçus et navigateurs intégrés.
---

La protection des mutations doit combiner un jeton HMAC court et vérifié dans un en-tête non simple avec une validation stricte de l’origine. Le cookie CSRF peut être émis pour compatibilité, mais il ne doit pas être une condition nécessaire.

**Why:** Certains téléphones, PWA, iframes et navigateurs intégrés bloquent ou perdent les cookies tout en laissant le frontend lire le jeton signé. Exiger les deux a bloqué avant la base toutes les connexions, inscriptions et pièces jointes légitimes.

**How to apply:** Toute évolution de la sécurité HTTP doit être testée sans cookie, avec le jeton signé en en-tête, puis avec une origine hostile. Les uploads doivent conserver séparément leurs contrôles d’identité, d’état et d’expiration vendeur.