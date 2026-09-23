---
name: Format des numéros béninois
description: Règle de normalisation des téléphones Bénin (préfixe 01) et pièges du 0 initial
---

Le Bénin utilise le format `229 01 XXXXXXXX` (13 chiffres). Le `0` de `01` fait partie du numéro et ne doit JAMAIS être retiré.

**Why:** le formulaire d'inscription retirait tous les zéros de tête, produisant des numéros stockés cassés `2291XXXXXXXX` (12 chiffres) — liens FedaPay et WhatsApp inutilisables (ex. constaté sur une boutique en production).

**How to apply:**
- Toute saisie/normalisation de téléphone passe par `normalizePhone`/`phoneEq` (api-server `lib/phone.ts`), qui canonicalisent aussi les formats cassés `2291\d{8}` et l'ancien format `229 + 8 chiffres` vers `22901…`.
- Ne pas retirer les zéros de tête côté frontend quand l'indicatif est +229 et que le numéro commence par `01`.
- Les envois WhatsApp/wa.me construits depuis un numéro stocké doivent le normaliser d'abord (des numéros cassés peuvent subsister en base tant que la tâche de nettoyage n'est pas faite).
