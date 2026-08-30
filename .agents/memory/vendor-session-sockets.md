---
name: Sessions vendeur et sockets
description: Règles de sécurité pour garder une session vendeur persistante et une identité Socket.io cohérente.
---

Les sessions vendeur sont des jetons opaques en cookie HttpOnly ; seule leur empreinte est persistée. Une session cookie valide est l’identité autoritaire et ne doit jamais être combinée avec une autre identité issue d’identifiants hérités.

**Why:** Une authentification cookie et une authentification héritée lancées en parallèle peuvent inscrire le même socket dans deux salles vendeur. De plus, le signal `connect` côté client précède parfois la fin de l’authentification serveur.

**How to apply:** Révoquer les sessions et déconnecter les sockets associés lors d’une déconnexion ou rotation sensible. Côté client, utiliser l’événement serveur `auth_ok`, émis après l’entrée dans la salle vendeur, pour resynchroniser les données persistées et couvrir les messages arrivés pendant une reconnexion.

Les rappels d’activation push doivent être réclamés atomiquement avec un marqueur durable de 24 heures, indépendamment de leur état lu/non lu.

**Why:** Un simple « select puis insert » peut créer des doublons sous concurrence, et marquer un rappel comme lu ne doit pas autoriser immédiatement un nouveau rappel.

**How to apply:** Mettre à jour le marqueur vendeur et créer la notification dans la même transaction ; n’envoyer les autres canaux de rappel que si cette réclamation réussit.

Un abonnement push présent dans le navigateur ne suffit pas à déclarer les notifications actives : le serveur doit confirmer que son endpoint appartient au vendeur connecté. Si ce lien manque, recréer puis réinscrire automatiquement l’abonnement avant de masquer les rappels.

**Why:** Sur un appareil partagé ou après la suppression serveur d’un endpoint invalide, le navigateur peut conserver une souscription locale qui ne livre plus aucune notification à ce vendeur.

**How to apply:** Faire vérifier l’endpoint local avec la session vendeur ; ne masquer la bannière et les nudges qu’après confirmation ou réinscription réussie.