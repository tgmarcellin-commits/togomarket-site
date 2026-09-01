---
name: Base dédiée et tests navigateur
description: Explique pourquoi les données injectées par les étapes DB génériques d'un test navigateur peuvent être invisibles pour TogoMarket.
---

Les fixtures d'un test navigateur TogoMarket doivent être préparées avec `@workspace/db`, pas avec les étapes DB génériques du testeur.

**Why:** L'application utilise une base dédiée distincte de la base PostgreSQL générique du workspace ; des lignes écrites dans cette dernière restent invisibles à l'API.

**How to apply:** Préparer et nettoyer les fixtures temporaires via le package DB du projet, puis laisser le testeur piloter uniquement le navigateur.