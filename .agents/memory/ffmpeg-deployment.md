---
name: FFmpeg en publication
description: Dépendance de publication requise pour le transcodage vidéo côté serveur.
---

Le transcodage vidéo côté serveur doit déclarer FFmpeg comme dépendance système Nix de l’environnement publié.

**Why:** FFmpeg peut être présent dans le workspace de développement mais absent de l’image Autoscale, où `spawn ffmpeg` échoue alors avec `ENOENT` pour tous les formats vidéo.

**How to apply:** Après tout changement de configuration de publication, vérifier le flux complet avec une vraie vidéo et confirmer dans les journaux publiés que le binaire démarre.