---
name: Conservation des publications
description: Règle de conservation des annonces TogoMarket et distinction entre expiration et suppression.
---

Les publications ne doivent jamais être supprimées automatiquement en fonction de leur ancienneté. L’expiration d’un abonnement vendeur peut masquer temporairement ses publications, mais les enregistrements doivent rester en base afin de réapparaître après renouvellement.

**Why:** Un nettoyage lancé au démarrage supprimait définitivement les publications approuvées de plus de 60 jours. Le total de production est passé de 301 à 292 et l’utilisateur a signalé des publications disparues.

**How to apply:** Garder désactivé tout cron de suppression par âge. Pour les abonnements expirés, appliquer uniquement des filtres de visibilité réversibles. Toute suppression définitive doit venir d’une action explicite du vendeur ou d’un administrateur.