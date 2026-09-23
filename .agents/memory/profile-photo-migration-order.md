---
name: Migration des photos vendeur
description: Ordre sûr entre migration des anciens formats de photo vendeur et filtrage des réponses API.
---

Avant de normaliser les anciennes photos vendeur en `null` dans les réponses API, migrer toutes les valeurs héritées vers Object Storage et vérifier que chaque objet est réellement lisible.

**Why:** Un filtrage strict appliqué avant la fin de la migration donne l’apparence d’une suppression alors que les octets sont encore présents en base. À l’inverse, un chemin Object Storage valide ne garantit pas que le fichier existe encore.

**How to apply:** Inventorier séparément les valeurs base64, les chemins Object Storage lisibles et les références cassées. Migrer les base64 avec mise à jour conditionnelle, vérifier chaque objet par lecture, puis seulement conserver le filtrage strict.