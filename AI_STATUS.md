# AI_STATUS.md — État d'avancement et d'audit Igitoro Live

## 1. Matrice d'audit et statut réel des fonctionnalités

| Fonctionnalité | État réel | Détails de l'implémentation | Statut |
| :--- | :--- | :--- | :--- |
| **Recherche stations** | Fonctionnelle | Filtrage instantané client-side (nom, marque, zone, repères) + puces toggle par commune (Mukaza, Muha, Ntahangwa) | ✓ Validé |
| **Page station** | Fonctionnelle | Métadonnées complètes, badge "Station vérifiée", bouton d'itinéraire cartographique, bouton de partage contextuel, résumé communautaire, liste des signalements | ✓ Validé |
| **Signalement** | Fonctionnelle | Formulaire complet réservé aux utilisateurs authentifiés (disponibilité carburant, type de carburant facultatif, file, estimation, station ouverte/fermée, commentaire) | ✓ Validé |
| **Photo en direct** | Fonctionnelle | Caméra directe exclusive (WebRTC/getUserMedia), zéro upload de galerie ou disque dur, filigrane indélébile avec date/heure | ✓ Validé |
| **Confirmation / Contradiction** | Fonctionnelle | Endpoints `POST /api/reports/:id/verify`, boutons distincts avec comptage en direct pour confirmations et contradictions | ✓ Validé |
| **Agrégation situation** | Fonctionnelle | Algorithme calculant la situation la plus récente sur fenêtre temporelle glissante, exposant séparément retours et fraîcheur | ✓ Validé |
| **Fraîcheur des données** | Fonctionnelle | Horodatage lisible (« À l'instant », « Il y a X min », « Il y a X h ») sur toutes les vues | ✓ Validé |
| **Google Auth (OAuth 2.0 / OIDC)** | Fonctionnelle | Vérification cryptographique côté serveur via `google-auth-library` (`OAuth2Client.verifyIdToken` + flux `/api/auth/google/url` & `/auth/callback` supportant `id_token` sans exiger de secret ou `code` avec secret), utilisation du `sub` Google immuable comme clé de compte | ✓ Validé |
| **Système de Partage Complet** | Fonctionnelle | Interface dédiée `/partager` (`/share`), concept « Tu cherches. Tu observes. Tu aides. », 8 canaux (WhatsApp Discussion & Status, Instagram Story, Facebook Post & Story, X, SMS, E-mail, Autres apps, Partager partout), visuels Canvas haute résolution (`1080×1920` Story 9:16 et `1080×1080` Carré 1:1) avec QR Code ISO/IEC 18004 autonome, Web Share API (`navigator.canShare`) + fallbacks honnêtes | ✓ Validé |
| **Métadonnées Sociales & Icônes** | Fonctionnelle | Balises Open Graph (`og:title`, `og:description`, `og:image` `1200×630`), Twitter Cards, URL canonique, icônes d'écran d'accueil Pompe à essence (`180×180`, `192×192`, `512×512`, `maskable`, SVG) | ✓ Validé |
| **Profil utilisateur** | Fonctionnelle | Vue du compte, statistiques de participations simples, gestion des quartiers suivis, suppression de signalement et déconnexion | ✓ Validé |
| **Zones suivies** | Fonctionnelle | Abonnement et désabonnement dynamique par quartier, synchronisé dans le profil et la page notifications | ✓ Validé |
| **Notifications** | Fonctionnelle | Synthèses groupées par zone (« Activité à Kinindo : 2 stations avec carburant »), partage contextuel par zone, demande de notification navigateur et vibration | ✓ Validé |
| **Rate limiting** | Fonctionnelle | `DynamicRateLimiter` côté serveur protégeant contre le spam de signalements, d'abus, de créations de stations et requêtes abusives | ✓ Validé |
| **Abus & Modération** | Fonctionnelle | Modal de signalement avec motifs (Faux signalement, Spam, Insulte, Autre), modération administrative avec masquage et suspension | ✓ Validé |
| **Tableau de bord Admin** | Fonctionnelle | Route `/admin` complète (Statistiques opérationnelles, Gestion des stations, Revendications, Abus, Utilisateurs, Journal d'actions) | ✓ Validé |
| **Suppression de compte** | Fonctionnelle | `DELETE /api/auth/account` avec anonymisation des données sans briser l'historique communautaire | ✓ Validé |
| **Responsive & Mobile** | Fonctionnelle | Design mobile-first avec barre d'onglets inférieure tactile, fluid clamp typography, grille auto-responsive sur desktop | ✓ Validé |

## 2. Tests automatisés exécutés

- **40 tests d'intégration et unitaires automatisés** exécutés avec succès (`npm test` via `test/test_app.js`) couvrant :
  - Routes web, PWA manifest, icônes pompe à essence et bannière Open Graph (`og-share.png`)
  - Authentification Google OAuth 2.0 / OpenID Connect (rejet des fausses entrées, vérification cryptographique RS256, cycle complet connexion/déconnexion/reconnexion)
  - Système de partage complet (`/partager`, `/share`, `/api/share/context`, `/api/share/event`, génération multi-canaux, génération visuels Canvas Story `1080×1920` et Carré `1080×1080`, QR Code ISO/IEC 18004, Web Share API avec fichier/texte/annulation/fallback, sécurité anti-XSS et anti-redirection externe)
  - Signalements, confirmations, contradictions, abus, revendications, administration et suppression de compte.
