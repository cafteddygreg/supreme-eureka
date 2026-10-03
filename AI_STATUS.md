# AI_STATUS.md — État d'avancement et d'audit Igitoro Live

## 1. Matrice d'audit et statut réel des fonctionnalités

| Fonctionnalité | État réel | Détails de l'implémentation | Statut |
| :--- | :--- | :--- | :--- |
| **Recherche stations** | Fonctionnelle | Filtrage instantané client-side (nom, marque, zone, repères) + puces toggle par commune (Mukaza, Muha, Ntahangwa) | ✓ Validé |
| **Page station** | Fonctionnelle | Métadonnées complètes, badge "Station vérifiée", bouton d'itinéraire cartographique, résumé communautaire, liste des signalements | ✓ Validé |
| **Signalement** | Fonctionnelle | Formulaire complet avec disponibilité carburant, type de carburant facultatif, file, estimation, station ouverte/fermée, commentaire | ✓ Validé |
| **Photo en direct** | Fonctionnelle | Caméra directe exclusive (WebRTC/getUserMedia), zéro upload de galerie ou disque dur, filigrane indélébile avec date/heure | ✓ Validé |
| **Confirmation / Contradiction** | Fonctionnelle | Endpoints `POST /api/reports/:id/verify`, boutons distincts avec comptage en direct pour confirmations et contradictions | ✓ Validé |
| **Agrégation situation** | Fonctionnelle | Algorithme calculant la situation la plus récente sur fenêtre temporelle glissante, exposant séparément retours et fraîcheur | ✓ Validé |
| **Fraîcheur des données** | Fonctionnelle | Horodatage lisible (« À l'instant », « Il y a X min », « Il y a X h ») sur toutes les vues | ✓ Validé |
| **Google Auth** | Fonctionnelle | Connexion Google avec session Express, gestion invité automatique, séparation claire dev / production | ✓ Validé |
| **Profil utilisateur** | Fonctionnelle | Vue du compte, statistiques de participations simples, gestion des quartiers suivis, suppression de signalement et déconnexion | ✓ Validé |
| **Zones suivies** | Fonctionnelle | Abonnement et désabonnement dynamique par quartier, synchronisé dans le profil et la page notifications | ✓ Validé |
| **Notifications** | Fonctionnelle | Synthèses groupées par zone (« Activité à Kinindo : 2 stations avec carburant »), demande de notification navigateur et vibration | ✓ Validé |
| **Rate limiting** | Fonctionnelle | `DynamicRateLimiter` côté serveur protégeant contre le spam de signalements, d'abus, de créations de stations et requêtes abusives | ✓ Validé |
| **Abus & Modération** | Fonctionnelle | Modal de signalement avec motifs (Faux signalement, Spam, Insulte, Autre), modération administrative avec masquage et suspension | ✓ Validé |
| **Tableau de bord Admin** | Fonctionnelle | Route `/admin` complète (Statistiques opérationnelles, Gestion des stations, Revendications, Abus, Utilisateurs, Journal d'actions) | ✓ Validé |
| **Statistiques** | Fonctionnelle | Métriques globales et par utilisateur (sans gamification ni classement) | ✓ Validé |
| **Station revendiquée** | Fonctionnelle | Workflow complet : demande du gérant avec justificatif -> modération admin -> validation avec badge « Station vérifiée » | ✓ Validé |
| **Sécurité & Données** | Fonctionnelle | Zéro tracking GPS, validation stricte entrées, sanitisation uploads, blocage des fausses photos, protection sessions | ✓ Validé |
| **Suppression de compte** | Fonctionnelle | `DELETE /api/auth/account` avec anonymisation des données sans briser l'historique communautaire | ✓ Validé |
| **Responsive & Mobile** | Fonctionnelle | Design mobile-first avec barre d'onglets inférieure tactile, fluid clamp typography, grille auto-responsive sur desktop | ✓ Validé |

## 2. Tests automatisés exécutés

- 22 tests d'intégration automatisés exécutés avec succès (`npm test` via `test/test_app.js`) couvrant routes web, API REST, sessions, modération, revendications et droits administrateur.
