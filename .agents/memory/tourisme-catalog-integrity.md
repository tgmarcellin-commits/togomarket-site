---
name: Intégrité des catalogues Tourisme
description: Règles de compatibilité et de propriété des médias pour les catalogues Tourisme.
---

Un catalogue Tourisme historique peut être réparti sur plusieurs enregistrements portant le même vendeur et le même nom normalisé. Toute mutation vendeur doit agir sur ce groupe logique puis le consolider, plutôt que modifier une seule ligne.

**Why:** Une mutation ligne par ligne scinde visuellement le catalogue public ou laisse une partie du catalogue visible après suppression.

**How to apply:** Pour l’édition et la suppression, résoudre le groupe complet à partir d’un enregistrement détenu par le vendeur. Préserver les médias du groupe et consolider vers un seul enregistrement lorsque le catalogue est modifié.

Tout nouvel upload persistant doit porter une propriété liée au vendeur authentifié. Un média déjà présent dans un catalogue historique peut être conservé, mais un nouveau chemin ne doit jamais être accepté sans preuve de propriété.

**Why:** Les chemins Object Storage sont visibles dans les réponses publiques ; accepter un chemin arbitraire permettrait à un vendeur de référencer puis supprimer le fichier d’un autre.

**How to apply:** Attribuer les uploads au vendeur côté serveur, vérifier cette propriété avant toute nouvelle référence, et ne supprimer un objet que lorsqu’aucune autre donnée ne le référence.