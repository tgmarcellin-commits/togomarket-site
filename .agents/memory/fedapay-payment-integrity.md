---
name: Intégrité des paiements FedaPay
description: Règles non négociables pour lier les paiements et sécuriser les liens de renouvellement.
---

Toute activation payante doit vérifier auprès de FedaPay le statut, le montant, la devise et l’identité, puis exiger que l’identifiant de transaction corresponde exactement à celui persisté sur l’entité ciblée. Un lien de rappel adressant une entité par son identifiant doit porter un jeton HMAC lié à cette entité et limité dans le temps.

**Why:** Un endpoint de renouvellement public et prévisible permettait de créer ou de réaffecter des transactions pour des entités arbitraires, même si le paiement lui-même restait nécessaire.

**How to apply:** Toute nouvelle route de paiement, callback, webhook ou rappel doit utiliser le même principe de liaison préalable et ne jamais faire confiance aux seules métadonnées reçues dans le callback.