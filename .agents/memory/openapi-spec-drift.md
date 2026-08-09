---
name: Dérive spec OpenAPI vs types générés
description: Risque de casse à chaque codegen orval — le code s'appuyait sur des champs absents du spec
---

Règle : avant de lancer `pnpm --filter @workspace/api-spec codegen`, s'attendre à ce que des erreurs TypeScript « nouvelles » apparaissent dans du code non touché.

**Why:** le code (api-server et frontend) s'est appuyé sur des champs présents dans les fichiers générés mais absents de `lib/api-spec/openapi.yaml` (ex. profilePhoto/wantsNotifications sur VendorRegisterInput, vendorId sur Listing). Le spec avait été modifié sans regénérer, ou les fichiers générés édités à la main. Chaque codegen resynchronise et fait ressortir ces dérives.

**How to apply:** si une erreur TS surgit après codegen sur un champ utilisé de longue date, la solution est d'ajouter le champ manquant au spec YAML puis regénérer — pas de modifier le code appelant. Penser aussi que toute réponse validée par un schéma zod généré (ex. VendorGetListingsResponse = Listing[]) doit être mise à jour côté route quand le schéma Listing gagne des champs requis.
