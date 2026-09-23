# TogoMarket Site

Ce dépôt contient le frontend et l’API TypeScript de TogoMarket.

## Variables Render

Les clés/secrets de production sont **déjà configurés** côté Render.  
Ne jamais hardcoder ces valeurs et ne jamais les exposer au frontend.

Variables attendues côté backend :

- `DATABASE_URL` / `TOGOMARKET_DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_PASSWORD`, `SUB_ADMIN_PASSWORD`
- `ORS_API_KEY`
- `FEDAPAY_SECRET_KEY`, `FEDAPAY_PUBLIC_KEY`, `FEDAPAY_WEBHOOK_SECRET` (compte abonnements/services)
- `FEDAPAY_MARKETPLACE_SECRET_KEY`, `FEDAPAY_MARKETPLACE_PUBLIC_KEY`, `FEDAPAY_DRIVER_WEBHOOK_SECRET` (compte marketplace livraison)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TEMPLATE_OTP`, `WHATSAPP_TEMPLATE_NOTIF_NUDGE`, `WHATSAPP_UTILITY_TEMPLATE_NAME`

Variables attendues côté frontend build :

- `PORT`
- `BASE_PATH` (mettre `/` en production Render si l’application est servie à la racine)

## Portail livreur et espace Livraisons

- Le portail livreur public est disponible sur `/driver-connexion`.
- Le livreur reçoit un OTP sur WhatsApp, ouvre sa session, retrouve ses affectations, répond aux missions et met à jour sa disponibilité depuis cette page.
- L’onglet **Livraisons** du dashboard admin permet de consulter les commandes récentes, voir l’état d’affectation, le livreur courant, la distance/frais verrouillés, puis affecter ou réaffecter un livreur.

Voir aussi `.env.example` (sans valeurs réelles).
