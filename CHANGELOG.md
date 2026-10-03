# CHANGELOG

## 2026-10-03 — Finalisation, Audit et Mise en Conformité Complète
- **Audit général et correction de bugs** :
  - Correction de l'incrémentation des ID de stations (`nextStationId = 29` au lieu de 13 pour éviter les collisions avec les 28 stations répertoriées).
  - Suppression totale de toute balise `<input type="file">` et verrouillage strict contre le téléversement de fichiers de galerie ou disque dur pour les signalements.
  - Intégration d'un flux caméra en direct exclusif (`MediaDevices.getUserMedia`) avec filigrane d'horodatage indélébile.
- **Formulaire de signalement enrichi** :
  - Sélection facultative du type de carburant (`Essence`, `Mazout`, `Les deux`, `Non précisé`).
  - Sélection de l'état de la file (`Pas de file`, `Courte`, `Moyenne`, `Longue`, `Je ne sais pas`).
  - Estimation communautaire approximative (`1-10`, `10-30`, `30-60`, `60-100`, `100+`, `Je ne sais pas`).
  - Statut d'ouverture de la station (`Ouverte`, `Fermée`, `Je ne sais pas`).
- **Système de Revendication de Stations** :
  - Modal et endpoint de revendication pour les représentants officiels (`POST /api/stations/:id/claim`).
  - Modération administrative des demandes avec attribution du badge « Station vérifiée ».
- **Tableau de bord Administrateur complet (`/admin`)** :
  - Interface dédiée avec statistiques opérationnelles (stations, signalements, confirmations, abus, revendications).
  - Gestion des stations (ajout officiel, activation/désactivation).
  - Modération des signalements abusifs et gestion des suspensions d'utilisateurs.
  - Journal d'audit chronologique de toutes les actions administratives.
- **Alertes et Notifications groupées** :
  - Synthèses d'activité groupées par quartier à Bujumbura.
  - Gestion dynamique des quartiers suivis et déclencheur de permissions de notification et vibration.
- **Suite de tests automatisée** :
  - Ajout de 22 tests d'intégration automatisés (`npm test`) validant l'ensemble du flux applicatif.

## 2026-10-02
- Scaffold initial Igitoro Live.
