---
name: Fusion sûre des conversations
description: Décision de sécurité pour regrouper les anciens fils acheteur-vendeur
---

La consolidation d’anciens fils doit reposer sur la possession et la validation de leurs jetons acheteur opaques. Le téléphone et le nom peuvent servir de contexte d’affichage, jamais de preuve d’identité ou de rapprochement.

**Why:** des numéros partagés, recyclés ou saisis par erreur peuvent appartenir à plusieurs personnes ; une fusion fondée uniquement sur le téléphone donnerait accès à l’historique, aux fichiers et aux notifications d’un autre acheteur.

**How to apply:** lorsqu’un navigateur présente plusieurs jetons valides du même vendeur, fusionner dans une transaction et conserver les anciens jetons comme alias. Refuser la fusion si plusieurs identités acheteur stables sont déjà établies.