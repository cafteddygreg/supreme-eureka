# CHANGELOG

## 2026-10-03 — Système de Partage Communautaire Complet & Icônes Pompe à Essence
- **Système de partage complet (`/partager` & `/share`)** :
  - Interface dédiée mobile-first articulée autour du message central **« Tu cherches. Tu observes. Tu aides. »** ciblant simultanément les personnes qui cherchent du carburant, celles qui viennent d'observer une situation, et celles qui diffusent l'outil.
  - Prise en charge de 8 canaux et sous-modes : **Partager partout** (Web Share natif), **WhatsApp** (Discussion/Groupe & Statut Story 9:16), **Instagram** (Story 9:16), **Facebook** (Publication 1:1 & Story 9:16), **X**, **SMS / Messages**, **E-mail**, et **Autres applications**.
  - Générateur contextuel (`static/js/share.js` & `GET /api/share/context`) prenant en charge le partage général, le partage d'une station précise (`?station_id=...`, sans jamais promettre de stock garanti) et le partage d'un quartier (`?zone=...`), avec 3 styles (`Standard`, `Communauté`, `Information`), message éditable et signature facultative.
  - Générateur de visuels sociaux sur `<canvas>` haute résolution : format **Story 9:16 (`1080×1920`)** et format **Publication carrée 1:1 (`1080×1080`)** intégrant un **QR Code ISO/IEC 18004 autonome** pointant vers l'URL publique (sans jamais pointer vers `localhost` ou `127.0.0.1`).
  - Intégration Web Share API (`navigator.share` + `navigator.canShare({ files })`) avec fallbacks honnêtes (téléchargement du visuel PNG, copie du message, copie du lien, ouverture des intents officiels).
  - Métadonnées Open Graph (`og:title`, `og:description`, `og:image` `1200×630`), Twitter/X Cards et Schema.org JSON-LD.
  - Nouvelles icônes d'écran d'accueil de pompe à essence (`icon-180.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `icon.svg`).

## 2026-10-03 — Finalisation, Audit et Mise en Conformité Complète
- **Audit général et correction de bugs** :
  - Correction de l'incrémentation des ID de stations (`nextStationId = 29`).
  - Suppression totale de toute balise `<input type="file">` et flux caméra en direct exclusif (`MediaDevices.getUserMedia`) avec filigrane d'horodatage indélébile.
- **Formulaire de signalement enrichi, Revendication de stations, Tableau de bord Admin (`/admin`) et Notifications groupées**.

## 2026-10-02
- Scaffold initial Igitoro Live.
