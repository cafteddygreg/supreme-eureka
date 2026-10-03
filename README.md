# Igitoro Live ⛽🇧🇮

**Tu cherches. Tu observes. Tu aides.**

Plateforme communautaire en temps réel permettant aux citoyens de Bujumbura de consulter, signaler et confirmer les observations sur les stations-service (disponibilité essence/mazout, files d'attente, ouverture).

## Fonctionnalités principales

1. **Suivi des stations-service à Bujumbura** : Recherche instantanée et filtrage par commune (`Mukaza`, `Muha`, `Ntahangwa`) et par quartier.
2. **Signalements & Confirmations communautaires** : Publication d'observations vérifiées avec prise de photo en direct uniquement (caméra WebRTC avec filigrane horodaté) et confirmations/contradictions en un clic.
3. **Authentification Google OAuth 2.0 / OpenID Connect** : Vérification cryptographique côté serveur (`google-auth-library`) basée sur l'identifiant Google immuable `sub`.
4. **Système de partage communautaire complet (`/partager` ou `/share`)** :
   - Prépare des messages sur mesure pour **WhatsApp** (Discussion & Statut), **Instagram** (Story), **Facebook** (Publication & Story), **X**, **SMS / Messages**, **E-mail**, **Autres applications** et **Partager partout**.
   - Génère automatiquement des visuels haute résolution **Story 9:16 (`1080×1920`)** et **Publication carrée 1:1 (`1080×1080`)** avec **QR Code scannable** intégré.
   - Utilise l'API native **Web Share (`navigator.share` / `navigator.canShare`)** lorsqu'elle est supportée par l'appareil et propose des solutions de secours honnêtes (téléchargement du visuel en 1 clic, copie du texte et du lien, ouverture des canaux) lorsque la plateforme ne permet pas de publier directement depuis un navigateur web.

## Commandes

- Démarrer le serveur : `npm start`
- Exécuter la suite de tests automatisés (40 tests) : `npm test`
- Régénérer les icônes PWA et la bannière Open Graph : `node scripts/generate_icons.js`
