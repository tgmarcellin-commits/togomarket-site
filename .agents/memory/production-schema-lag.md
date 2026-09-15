---
name: Dérive du schéma production
description: Gestion des colonnes présentes dans le code mais encore absentes de la base TogoMarket publiée.
---

La base PostgreSQL de production peut avoir un schéma plus ancien que le code déployé. Une requête Drizzle qui sélectionne toutes les colonnes échoue alors entièrement, même si la fonction demandée utilise seulement des colonnes existantes.

**Why:** La production contenait les données historiques mais manquait `ad_video_playback_mode`, ce qui bloquait toute la lecture et la sauvegarde des paramètres, y compris le fournisseur OTP `MANUAL`.

**How to apply:** Pour un correctif immédiat, sélectionner explicitement les colonnes disponibles et fournir une valeur par défaut pour les champs absents. Pour restaurer complètement la fonctionnalité absente, appliquer ensuite l'évolution du schéma via le flux de publication Replit, jamais par une écriture directe non contrôlée en production.