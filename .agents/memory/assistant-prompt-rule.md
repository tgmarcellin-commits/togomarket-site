---
name: Mise à jour automatique du prompt de l'assistante IA
description: Règle utilisateur — mettre à jour le prompt de l'assistante à chaque nouvelle feature TogoMarket.
---

# Règle : Mise à jour automatique du prompt assistante

**Règle :** À chaque fois qu'une nouvelle fonctionnalité est ajoutée ou modifiée sur TogoMarket, mettre à jour le fichier `artifacts/api-server/src/lib/assistant-prompt.ts` pour que l'assistante virtuelle soit immédiatement au courant.

**Why :** L'utilisateur ne veut pas avoir à penser à mettre à jour manuellement l'assistante — c'est la responsabilité de l'agent à chaque mise à jour.

**How to apply :**
- Après avoir implémenté n'importe quelle nouvelle feature (nouvelle section, tarif, fonctionnement, règle, onglet nav…), ouvrir `artifacts/api-server/src/lib/assistant-prompt.ts` et ajouter ou modifier la section correspondante dans le prompt système.
- Le fichier est organisé par sections clairement commentées — ajouter la nouvelle feature dans la section la plus appropriée ou créer une nouvelle section.
- Ne jamais livrer une feature sans avoir vérifié que le prompt reflète le changement.
