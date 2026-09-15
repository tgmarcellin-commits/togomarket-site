---
name: Dérive du schéma production
description: Gestion des colonnes présentes dans le code mais encore absentes de la base TogoMarket publiée.
---

La base PostgreSQL de production peut avoir un schéma plus ancien que le code déployé. Une requête Drizzle qui sélectionne toutes les colonnes échoue alors entièrement, même si la fonction demandée utilise seulement des colonnes existantes. Pour un `insert`, omettre le champ dans `.values()` ne suffit pas : Drizzle peut encore mentionner toutes les colonnes du modèle avec `default`.

**Why:** Des colonnes absentes ont bloqué les paramètres, puis la lecture et l'envoi des messages. Les envois de fichiers échouaient encore après avoir retiré les valeurs car le modèle d'insertion complet continuait de générer les colonnes absentes.

**How to apply:** Pour un correctif immédiat, sélectionner explicitement les colonnes disponibles et fournir une valeur par défaut pour les champs absents. Pour les insertions, utiliser un modèle de table de compatibilité limité aux colonnes présentes, pas seulement un objet de valeurs réduit. Pour restaurer complètement la fonctionnalité absente, appliquer ensuite l'évolution du schéma via le flux de publication Replit, jamais par une écriture directe non contrôlée en production.