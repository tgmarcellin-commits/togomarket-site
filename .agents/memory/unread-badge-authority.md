---
name: Autorité des badges non lus
description: Règles de cohérence pour les badges Messages sous activité Socket.io concurrente.
---

**Règle :** Le badge Messages global doit avoir un seul propriétaire côté client. Les rafraîchissements déclenchés par Socket.io doivent ignorer toute réponse plus ancienne qu’une requête déjà lancée, et les totaux affichés doivent être dérivés des messages réellement non lus plutôt que d’un compteur dénormalisé.

**Why:** Un envoi, une lecture et une reconnexion peuvent lancer plusieurs requêtes simultanées. Sans propriétaire unique ni ordre monotone, une ancienne réponse peut écraser le résultat récent ; une remise à zéro concurrente peut aussi masquer un message arrivé pendant la lecture.

**How to apply:** Toute nouvelle source de non-lus doit rejoindre l’agrégateur global existant au lieu d’écrire le badge depuis un composant enfant. Toute requête de synchronisation relancée par un événement doit appliquer uniquement sa réponse la plus récente. Pour un acheteur, attendre l’accusé d’adhésion aux salons Socket.io avant de lire les compteurs afin qu’aucun événement ne puisse tomber entre la lecture et l’abonnement.