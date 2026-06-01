---
name: Image storage migration
description: Migration des images de base64 PostgreSQL vers Replit Object Storage (GCS)
---

## Règle
Les images sont désormais stockées dans Replit Object Storage. Les chemins en base ont la forme `/objects/uploads/<uuid>`.

**Why:** Base64 dans PostgreSQL = listings très lourds, lenteur des requêtes.

**How to apply:**
- Upload côté client : `resizeImageToBlob(file)` → `uploadImageFile(blob, name)` → objectPath stocké en DB.
- Affichage : `<img src={`/api/storage${objectPath}`}>` ou via le serving route `GET /api/storage/objects/<path>`.
- Ancien format (base64) peut encore exister si la migration script ne couvre pas tout — le code de suppression ignore les chemins non-`/objects/`.
- Script de migration : `pnpm --filter @workspace/scripts run migrate-images` — lit toutes les annonces avec base64, upload vers storage, met à jour la DB.
