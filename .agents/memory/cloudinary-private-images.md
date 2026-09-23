---
name: Images privées Cloudinary
description: Confidentialité des URL d'images de conversation sous Cloudinary.
---

Pour une image Cloudinary de type `authenticated`, la `secure_url` renvoyée à l'upload peut contenir une signature de livraison permanente. Il faut enregistrer l'URL HTTPS sans cette signature, puis générer un lien de téléchargement court seulement après le contrôle d'accès aux messages.

**Why:** Un test réel a montré que l'URL `secure_url` signée répondait 200 directement, alors que l'URL sans signature répondait 401 et le lien de téléchargement temporaire répondait 200. Enregistrer la première reviendrait à perdre la confidentialité prévue pour les conversations.

**How to apply:** À tout nouvel upload ou changement de fournisseur pour les pièces jointes privées, vérifier par une requête réelle que l'URL persistée ne sert pas l'image sans autorisation et que l'accès temporaire continue de fonctionner.