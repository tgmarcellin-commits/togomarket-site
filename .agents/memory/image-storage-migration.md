---
name: Ancien stockage Google
description: Décision de retrait total de Google Storage et conséquence pour les anciens fichiers.
---

Les nouveaux médias passent exclusivement par Cloudinary. Les anciens chemins `/objects/uploads/...` peuvent rester dans PostgreSQL, mais leur contenu n'est plus servi : les routes historiques répondent 410. Ne pas réintroduire Google Storage pour les lire sans demande explicite.

**Why:** L'utilisateur a explicitement choisi de retirer totalement Google Storage, y compris l'accès aux anciens fichiers, pour supprimer la dépendance au serveur de métadonnées local qui provoquait ECONNREFUSED sur Render.

**How to apply:** Lorsqu'un ancien média manque à l'écran, ne pas supposer une panne du nouvel upload. Une migration des anciens fichiers nécessiterait une source de leurs octets et un accord distinct ; ne pas prétendre qu'ils ont été migrés.
