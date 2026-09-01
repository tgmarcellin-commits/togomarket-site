---
name: Réactivité du flux de l’assistante IA
description: Contrainte de performance à préserver lors de l’ajout de contrôles de sécurité sur les réponses Gemini.
---

**Règle :** Les contrôles de sécurité de sortie ne doivent pas attendre toute la réponse IA avant le premier affichage. Utiliser une fenêtre de retenue courte, analyser le texte accumulé avant chaque émission et imposer un timeout au fournisseur.

**Why :** Un buffering complet a fait varier le délai visible de plusieurs secondes à près d’une minute, alors que les premiers segments Gemini étaient disponibles bien plus tôt.

**How to apply :** Conserver une petite portion non émise pour détecter les motifs qui traversent deux segments ; si un motif sensible apparaît, remplacer le contenu côté client par le refus neutre. Limiter aussi les tokens et terminer rapidement les appels fournisseur bloqués.