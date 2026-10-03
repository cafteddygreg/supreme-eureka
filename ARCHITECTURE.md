# ARCHITECTURE.md

## Architecture d'exécution
Navigateur (Mobile-First EJS + CSS fluide + Vanilla JS / Canvas) -> Serveur Express (`server.js`) -> Services métier (Agrégation temporelle, Authentification OIDC `google-auth-library`, Générateur de partage contextuel, Rate Limiting).

## Entités principales
`users`, `stations`, `reports`, `confirmations`, `abuse_reports`, `station_claims`, `zone_subscriptions`, `action_logs`, `shareMetrics`.

## Système de partage communautaire
- **Routes Web & API** :
  - `GET /partager` et `GET /share` : Interface complète de partage (`views/share.ejs`).
  - `GET /api/share/context` : Résolution et validation des métadonnées contextuelles (général, station publique, quartier).
  - `POST /api/share/event` : Compteurs agrégés sobres et sans données personnelles (`share_opened`, `share_channel_selected`, `share_generated`, `share_native_started`, `share_fallback_used`).
- **Moteur client/universel (`static/js/share.js`)** :
  - Génération de messages adaptés par canal (WhatsApp Discussion/Status, Instagram Story, Facebook Post/Story, X, SMS, E-mail, Autres apps).
  - Rendu Canvas haute résolution (`1080×1920` Story 9:16 et `1080×1080` Carré 1:1) avec encodeur QR Code ISO/IEC 18004 autonome.
  - Détection Web Share API (`navigator.share`, `navigator.canShare({ files })`) et fallbacks honnêtes.
