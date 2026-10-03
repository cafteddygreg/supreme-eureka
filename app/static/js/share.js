/**
 * Système complet de partage communautaire d'Igitoro Live
 * Concept central : « Tu cherches. Tu observes. Tu aides. »
 */
(function (root) {
  'use strict';

  const DEFAULT_PUBLIC_ORIGIN = 'https://igitorolive.up.railway.app';

  // ============================================================================
  // 1. SÉCURITÉ, VALIDATION ET RÉSOLUTION D'URL PUBLIQUE
  // ============================================================================

  function sanitizeText(input, maxLen = 300) {
    if (!input || typeof input !== 'string') return '';
    return input
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .replace(/data:/gi, '')
      .replace(/vbscript:/gi, '')
      .trim()
      .slice(0, maxLen);
  }

  function resolvePublicShareOrigin(configuredOrigin, currentOrigin) {
    const candidate = (configuredOrigin || currentOrigin || '').trim().replace(/\/$/, '');
    if (!candidate) return DEFAULT_PUBLIC_ORIGIN;
    try {
      const u = new URL(candidate);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return DEFAULT_PUBLIC_ORIGIN;
      }
      // Ne jamais utiliser localhost ou 127.0.0.1 pour les QR codes et liens partagés
      if (
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1' ||
        u.hostname === '0.0.0.0' ||
        u.hostname.startsWith('192.168.') ||
        u.hostname.startsWith('10.')
      ) {
        return DEFAULT_PUBLIC_ORIGIN;
      }
      return `${u.protocol}//${u.host}`;
    } catch (_) {
      return DEFAULT_PUBLIC_ORIGIN;
    }
  }

  function sanitizeShareUrl(rawUrl, publicOrigin) {
    const safeOrigin = resolvePublicShareOrigin(publicOrigin);
    if (!rawUrl || typeof rawUrl !== 'string') return `${safeOrigin}/`;
    const trimmed = rawUrl.trim();

    if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
      return `${safeOrigin}/`;
    }

    try {
      if (trimmed.startsWith('/')) {
        const u = new URL(trimmed, safeOrigin);
        return `${safeOrigin}${u.pathname}${u.search}`;
      }
      const parsed = new URL(trimmed);
      const allowedHost = new URL(safeOrigin).host;
      if (parsed.host !== allowedHost) {
        return `${safeOrigin}/`;
      }
      return `${safeOrigin}${parsed.pathname}${parsed.search}`;
    } catch (_) {
      return `${safeOrigin}/`;
    }
  }

  // ============================================================================
  // 2. GÉNÉRATEUR DE QR CODE AUTONOME (ISO/IEC 18004 - MODE OCTET, ECC NIVEAU L)
  // ============================================================================

  // Tables des versions 1 à 5 en niveau de correction L (capacité jusqu'à 106 octets)
  const QR_VERSIONS = [
    null,
    { version: 1, size: 21, totalCodewords: 26, ecCodewords: 7, dataBytes: 17, align: [] },
    { version: 2, size: 25, totalCodewords: 44, ecCodewords: 10, dataBytes: 32, align: [6, 18] },
    { version: 3, size: 29, totalCodewords: 70, ecCodewords: 15, dataBytes: 53, align: [6, 22] },
    { version: 4, size: 33, totalCodewords: 100, ecCodewords: 20, dataBytes: 78, align: [6, 26] },
    { version: 5, size: 37, totalCodewords: 134, ecCodewords: 26, dataBytes: 106, align: [6, 30] }
  ];

  const GF_EXP = new Uint8Array(512);
  const GF_LOG = new Uint8Array(256);
  (function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      GF_EXP[i] = GF_EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const root = GF_EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], root);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const msg = new Uint8Array(data.length + ecLen);
    msg.set(data, 0);
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return msg.slice(data.length);
  }

  function generateQrMatrix(text) {
    const cleanText = String(text || DEFAULT_PUBLIC_ORIGIN).trim();
    const utf8Bytes = typeof TextEncoder !== 'undefined'
      ? Array.from(new TextEncoder().encode(cleanText))
      : Array.from(cleanText).map(c => c.charCodeAt(0) & 0xff);

    let vInfo = QR_VERSIONS[5];
    for (let v = 1; v <= 5; v++) {
      if (utf8Bytes.length <= QR_VERSIONS[v].dataBytes) {
        vInfo = QR_VERSIONS[v];
        break;
      }
    }
    const payloadBytes = utf8Bytes.slice(0, vInfo.dataBytes);
    const dataCodewords = vInfo.totalCodewords - vInfo.ecCodewords;

    // Construction du flux binaire (Mode 0100 = Byte, longueur sur 8 bits)
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    pushBits(0b0100, 4);
    pushBits(payloadBytes.length, 8);
    for (const b of payloadBytes) pushBits(b, 8);

    const maxBits = dataCodewords * 8;
    const terminator = Math.min(4, maxBits - bits.length);
    pushBits(0, terminator);
    while (bits.length % 8 !== 0) bits.push(0);

    const data = new Uint8Array(dataCodewords);
    for (let i = 0; i < bits.length / 8; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
      data[i] = byte;
    }
    let padIdx = bits.length / 8;
    let toggle = true;
    while (padIdx < dataCodewords) {
      data[padIdx++] = toggle ? 0xec : 0x11;
      toggle = !toggle;
    }

    const ec = rsEncode(data, vInfo.ecCodewords);
    const allCodewords = new Uint8Array(vInfo.totalCodewords);
    allCodewords.set(data, 0);
    allCodewords.set(ec, data.length);

    const size = vInfo.size;
    const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    function setFinder(row, col) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = row + r;
          const cc = col + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
          const inRing = r === 0 || r === 6 || c === 0 || c === 6;
          const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          matrix[rr][cc] = inOuter && (inRing || inCore);
          reserved[rr][cc] = true;
        }
      }
    }

    setFinder(0, 0);
    setFinder(0, size - 7);
    setFinder(size - 7, 0);

    // Alignement
    if (vInfo.align.length > 0) {
      const [a0, a1] = vInfo.align;
      const centers = [
        [a0, a0],
        [a0, a1],
        [a1, a0],
        [a1, a1]
      ];
      for (const [cr, cc] of centers) {
        if (reserved[cr][cc]) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const isDark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
            matrix[cr + r][cc + c] = isDark;
            reserved[cr + r][cc + c] = true;
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (!reserved[6][i]) {
        matrix[6][i] = i % 2 === 0;
        reserved[6][i] = true;
      }
      if (!reserved[i][6]) {
        matrix[i][6] = i % 2 === 0;
        reserved[i][6] = true;
      }
    }

    // Module sombre fixe et réservation des zones de format
    matrix[size - 8][8] = true;
    reserved[size - 8][8] = true;
    for (let i = 0; i < 9; i++) {
      if (i < size) {
        reserved[8][i] = true;
        reserved[i][8] = true;
      }
    }
    for (let i = 0; i < 8; i++) {
      reserved[8][size - 1 - i] = true;
      reserved[size - 1 - i][8] = true;
    }

    // Placement des bits de données en zigzag
    let bitIdx = 0;
    const totalBits = allCodewords.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!reserved[r][c]) {
            let dark = false;
            if (bitIdx < totalBits) {
              const byte = allCodewords[bitIdx >>> 3];
              dark = ((byte >>> (7 - (bitIdx & 7))) & 1) === 1;
              bitIdx++;
            }
            // Masque 0 : (r + c) % 2 === 0
            if ((r + c) % 2 === 0) dark = !dark;
            matrix[r][c] = dark;
          }
        }
      }
      upward = !upward;
    }

    // Bits de format pour Niveau L (01) + Masque 0 (000) -> 0x77c4
    const formatBits = 0x77c4;
    const fCoords1 = [
      [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
      [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    const fCoords2 = [
      [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
      [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
    ];
    for (let i = 0; i < 15; i++) {
      const bit = ((formatBits >>> i) & 1) === 1;
      const [r1, c1] = fCoords1[i];
      const [r2, c2] = fCoords2[i];
      matrix[r1][c1] = bit;
      matrix[r2][c2] = bit;
    }

    return matrix;
  }

  // ============================================================================
  // 3. MÉTADONNÉES DES CANAUX ET GÉNÉRATEUR DE CONTENU CONTEXTUEL
  // ============================================================================

  const CHANNEL_META = {
    everywhere: {
      id: 'everywhere',
      label: 'Partager partout',
      platformName: 'Partage natif multi-applications',
      shareTypeLabel: 'Visuel + Texte + Lien',
      visualFormat: 'square',
      supportsNativeIntent: true,
      directUploadSupported: true,
      honestNote: 'Utilise le menu de partage natif de votre appareil (image, message et lien) ou vous propose les actions directes si votre navigateur ne le prend pas en charge.'
    },
    whatsapp_chat: {
      id: 'whatsapp_chat',
      label: 'WhatsApp — Discussion',
      platformName: 'WhatsApp',
      shareTypeLabel: 'Message de discussion / groupe',
      visualFormat: 'square',
      supportsNativeIntent: true,
      directUploadSupported: false,
      honestNote: 'Ouvre WhatsApp avec le message prêt à envoyer à un proche ou dans un groupe. Sur mobile compatible, vous pouvez aussi joindre le visuel via « Partager avec le visuel ».'
    },
    whatsapp_status: {
      id: 'whatsapp_status',
      label: 'WhatsApp — Statut',
      platformName: 'WhatsApp Status',
      shareTypeLabel: 'Visuel Story 9:16 + Légende',
      visualFormat: 'story',
      supportsNativeIntent: false,
      directUploadSupported: false,
      honestNote: 'Visuel vertical 9:16 prêt ✅ · Légende prête ✅. Partagez via le menu natif de votre téléphone ou enregistrez l’image puis ouvrez WhatsApp → Statut.'
    },
    instagram_story: {
      id: 'instagram_story',
      label: 'Instagram — Story',
      platformName: 'Instagram',
      shareTypeLabel: 'Visuel Story 9:16 haute résolution',
      visualFormat: 'story',
      supportsNativeIntent: false,
      directUploadSupported: false,
      honestNote: 'Un site web ne peut pas publier directement une Story Instagram sans votre validation dans l’application. Visuel Story 9:16 prêt ✅ : partagez-le via votre téléphone ou téléchargez-le puis ouvrez Instagram → Story.'
    },
    facebook_post: {
      id: 'facebook_post',
      label: 'Facebook — Publication',
      platformName: 'Facebook',
      shareTypeLabel: 'Publication + Visuel carré + Lien',
      visualFormat: 'square',
      supportsNativeIntent: true,
      directUploadSupported: false,
      honestNote: 'Prépare un message explicatif et un visuel carré. Le texte est copié automatiquement avant d’ouvrir Facebook pour que vous puissiez le coller en un geste.'
    },
    facebook_story: {
      id: 'facebook_story',
      label: 'Facebook — Story',
      platformName: 'Facebook Story',
      shareTypeLabel: 'Visuel Story 9:16 dédié',
      visualFormat: 'story',
      supportsNativeIntent: false,
      directUploadSupported: false,
      honestNote: 'Visuel vertical 9:16 prêt ✅. Utilisez le partage natif de votre téléphone ou téléchargez l’image puis ouvrez Facebook → Créer une Story.'
    },
    x: {
      id: 'x',
      label: 'X (Twitter)',
      platformName: 'X',
      shareTypeLabel: 'Post concis + Lien + Visuel',
      visualFormat: 'square',
      supportsNativeIntent: true,
      directUploadSupported: false,
      honestNote: 'L’ouverture directe de X pré-remplit le texte et le lien. Pour inclure l’affiche, téléchargez le visuel (ou utilisez le partage natif sur mobile) et joignez-le à votre post.'
    },
    sms: {
      id: 'sms',
      label: 'SMS / Messages',
      platformName: 'SMS / Messages',
      shareTypeLabel: 'Message court direct',
      visualFormat: 'square',
      supportsNativeIntent: true,
      directUploadSupported: false,
      honestNote: 'Prépare un message court dans votre application SMS habituelle. Aucun SMS n’est envoyé sans votre validation finale.'
    },
    email: {
      id: 'email',
      label: 'E-mail',
      platformName: 'Messagerie E-mail',
      shareTypeLabel: 'Objet + Message complet',
      visualFormat: 'square',
      supportsNativeIntent: true,
      directUploadSupported: false,
      honestNote: 'Ouvre votre application d’e-mail avec l’objet et le message explicatif prêts à être envoyés à vos collègues, amis ou proches.'
    },
    other_apps: {
      id: 'other_apps',
      label: 'Autres applications',
      platformName: 'Telegram, Signal, Messenger…',
      shareTypeLabel: 'Partage universel personnalisable',
      visualFormat: 'square',
      supportsNativeIntent: true,
      directUploadSupported: false,
      honestNote: 'Compatible avec Telegram, Signal, Messenger ou toute autre application installée sur votre téléphone ou ordinateur.'
    }
  };

  /**
   * Génère un package complet de partage adapté au canal, au contexte et au style
   */
  function generateSharePackage(options = {}) {
    const channel = CHANNEL_META[options.channel] ? options.channel : 'whatsapp_chat';
    const meta = CHANNEL_META[channel];
    const style = ['standard', 'community', 'info'].includes(options.style) ? options.style : 'standard';
    const contextType = ['general', 'station', 'zone'].includes(options.contextType) ? options.contextType : 'general';
    const publicOrigin = resolvePublicShareOrigin(options.publicOrigin, typeof window !== 'undefined' ? window.location.origin : '');
    const signature = sanitizeText(options.signature || '', 60);

    // Validation stricte du contexte (uniquement données publiques, aucune garantie de stock)
    let targetPath = '/';
    let contextHeading = 'Bujumbura · Entraide Carburant';
    let contextLine = '';
    let stationName = '';
    let stationZone = '';
    let zoneName = '';

    if (contextType === 'station' && options.station && options.station.id) {
      const stId = parseInt(options.station.id, 10);
      stationName = sanitizeText(options.station.name || 'Station-service', 80);
      stationZone = sanitizeText(options.station.zone || options.station.commune || 'Bujumbura', 60);
      if (stId > 0) {
        targetPath = `/stations/${stId}`;
        contextHeading = `Station : ${stationName} (${stationZone})`;
        contextLine = `📍 Focus station : vous pouvez consulter ou compléter les dernières observations communautaires pour la station ${stationName} (${stationZone}).`;
      }
    } else if (contextType === 'zone' && options.zone) {
      zoneName = sanitizeText(options.zone, 60);
      if (zoneName) {
        targetPath = `/?q=${encodeURIComponent(zoneName)}`;
        contextHeading = `Quartier : ${zoneName} · Bujumbura`;
        contextLine = `📍 Focus quartier : suivez ou partagez les observations récentes des stations-service autour de ${zoneName}.`;
      }
    }

    const url = sanitizeShareUrl(targetPath, publicOrigin);
    const qrUrl = url;

    // Construction des textes selon le canal, le contexte et le style
    // Respecte toujours les 3 cibles : (1) celui qui cherche, (2) celui qui observe et peut aider, (3) celui qui diffuse l'outil.
    let title = 'Igitoro Live — Tu cherches. Tu observes. Tu aides.';
    let subject = 'Igitoro Live — une aide communautaire pour trouver du carburant';
    let text = '';

    if (contextType === 'station' && stationName) {
      title = `${stationName} (${stationZone}) — Observations sur Igitoro Live`;
      subject = `Igitoro Live — Informations communautaires pour ${stationName} (${stationZone})`;
    } else if (contextType === 'zone' && zoneName) {
      title = `Stations à ${zoneName} — Observations sur Igitoro Live`;
      subject = `Igitoro Live — Suivi communautaire du carburant à ${zoneName}`;
    }

    if (channel === 'sms') {
      if (contextType === 'station' && stationName) {
        text = `⛽ Tu cherches du carburant ou tu viens de passer près de ${stationName} (${stationZone}) ? Consulte ou partage une observation utile sur Igitoro Live : ${url}`;
      } else if (contextType === 'zone' && zoneName) {
        text = `⛽ Tu cherches du carburant vers ${zoneName} ou tu as une info utile sur une station ? Consulte ou aide la communauté sur Igitoro Live : ${url}`;
      } else if (style === 'community') {
        text = `⛽ Tu cherches. Tu observes. Tu aides. À Bujumbura, partage ou consulte les infos récentes sur les stations-service avec Igitoro Live : ${url}`;
      } else {
        text = `⛽ Tu cherches du carburant ou tu as une information utile sur une station à Bujumbura ? Découvre Igitoro Live : ${url}`;
      }
    } else if (channel === 'x') {
      if (contextType === 'station' && stationName) {
        text = `⛽ Vous voulez voir les dernières observations sur ${stationName} (${stationZone}) ou signaler la situation sur place ?\n\nTu cherches. Tu observes. Tu aides. 🤝🇧🇮\n👉 ${url}`;
      } else if (contextType === 'zone' && zoneName) {
        text = `📍 Carburant à ${zoneName} (Bujumbura) : tu cherches une station ou tu viens d'observer une file ?\n\nConsulte, signale et confirme sur Igitoro Live 🇧🇮\n👉 ${url}`;
      } else if (style === 'info') {
        text = `⛽ Igitoro Live à Bujumbura :\n• Tu cherches du carburant ? Consulte les observations récentes.\n• Tu passes devant une station ? Signale ou confirme en 10s.\n\nTu cherches. Tu observes. Tu aides. 🇧🇮\n👉 ${url}`;
      } else {
        text = `⛽ Tu cherches du carburant à Bujumbura ? Tu viens d'en voir ou d'observer une file ?\n\nSur Igitoro Live : tu cherches, tu observes, tu aides quelqu'un autour de toi. 🤝🇧🇮\n👉 ${url}`;
      }
    } else if (channel === 'email') {
      const introContext = contextLine ? `\n${contextLine}\n` : '';
      text = `Bonjour,

Je te partage Igitoro Live, une plateforme d'entraide communautaire pensée pour Bujumbura autour d'un principe simple : « Tu cherches. Tu observes. Tu aides. »
${introContext}
Pourquoi c'est utile pour tout le monde :
1. Si tu cherches du carburant : tu peux consulter les observations récentes avant de te déplacer inutilement.
2. Si tu viens d'observer une station (distribution en cours, file d'attente, station fermée) : tu peux publier un signalement ou confirmer une information en quelques secondes.
3. Si tu veux aider ton entourage : faire circuler l'outil permet d'avoir des informations plus fraîches dans chaque quartier.

Les informations proviennent des citoyens et constituent des observations à un instant donné (pas une garantie de stock).

👉 Accéder à Igitoro Live : ${url}`;
    } else if (channel === 'whatsapp_status' || channel === 'instagram_story' || channel === 'facebook_story') {
      if (contextType === 'station' && stationName) {
        text = `⛽ ${stationName} (${stationZone})\nTu cherches du carburant ou tu viens d’y passer ?\n\nTu cherches. Tu observes. Tu aides. 🤝🇧🇮\n👉 ${url}`;
      } else if (contextType === 'zone' && zoneName) {
        text = `📍 Quartier ${zoneName} · Bujumbura\nTu cherches du carburant ou tu as une info utile sur une station du quartier ?\n\nTu cherches. Tu observes. Tu aides. 🤝🇧🇮\n👉 ${url}`;
      } else {
        text = `⛽ Tu cherches du carburant ? Tu viens d’en voir ?\nPartage l’information et aide quelqu’un à Bujumbura sur Igitoro Live 🤝🇧🇮\n👉 ${url}`;
      }
    } else {
      // whatsapp_chat, facebook_post, everywhere, other_apps
      if (style === 'community') {
        text = `⛽ *Tu cherches. Tu observes. Tu aides.*\n\nÀ Bujumbura, un déplacement inutile fait perdre du temps et du carburant. Sur *Igitoro Live*, chacun peut s’entraider :\n${contextLine ? '\n' + contextLine + '\n' : ''}\n🔎 *Tu cherches du carburant ?* Regarde les observations récentes avant de bouger.\n📸 *Tu viens de voir une station servie ou une file ?* Signale-le ou confirme en 10 secondes.\n🤝 *Tu veux aider autour de toi ?* Fais connaître l’outil à tes proches.\n\n👉 ${url}`;
      } else if (style === 'info') {
        text = `⛽ *Igitoro Live — Informations stations-service à Bujumbura*\n${contextLine ? '\n' + contextLine + '\n' : ''}\n• *Consulter* : voir les derniers signalements par commune et quartier.\n• *Signaler* : partager ce que vous observez sur place (disponibilité, file).\n• *Confirmer* : indiquer si une observation est toujours valable.\n\n👥 Une observation partagée aide toute la communauté.\n👉 ${url}`;
      } else {
        text = `⛽ Tu cherches du carburant ou tu viens d’avoir une info utile sur une station à Bujumbura ?\n${contextLine ? '\n' + contextLine + '\n' : ''}\n*Igitoro Live* permet à la communauté de consulter et partager les observations récentes sur les stations-service :\n\n• *Tu cherches ?* Vérifie les derniers retours avant de te déplacer.\n• *Tu observes ?* Signale une file ou confirme une info en quelques secondes.\n• *Tu aides :* chaque observation évite un trajet inutile à quelqu’un d’autre.\n\n👉 ${url}`;
      }
    }

    if (signature) {
      text = `${text}\n\n— ${signature}`;
    }

    const visualFormat = options.visualFormat === 'story' || options.visualFormat === 'square'
      ? options.visualFormat
      : meta.visualFormat;

    const suffix = contextType === 'station' && stationName
      ? `station-${options.station.id}`
      : (contextType === 'zone' && zoneName ? `zone-${zoneName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : 'bujumbura');

    const fileName = `igitoro-live-${visualFormat}-${suffix}.png`;

    return {
      channel,
      channelLabel: meta.label,
      platformName: meta.platformName,
      shareTypeLabel: meta.shareTypeLabel,
      honestNote: meta.honestNote,
      style,
      contextType,
      contextHeading,
      stationName,
      stationZone,
      zoneName,
      title,
      subject,
      text,
      url,
      qrUrl,
      visualFormat,
      mimeType: 'image/png',
      fileName
    };
  }

  // ============================================================================
  // 4. GÉNÉRATEUR DE VISUELS SOCIAUX HAUTE RÉSOLUTION (STORY 9:16 & CARRÉ 1:1)
  // ============================================================================

  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawFuelPumpEmblem(ctx, cx, cy, scale = 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);

    // Badge de fond
    drawRoundedRect(ctx, -56, -56, 112, 112, 26);
    ctx.fillStyle = '#1E4631';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(251, 211, 104, 0.55)';
    ctx.stroke();

    // Tuyau
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(30, 4);
    ctx.lineTo(30, 30);
    ctx.lineTo(40, 30);
    ctx.lineTo(40, -14);
    ctx.lineTo(26, -28);
    ctx.strokeStyle = '#F5B841';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Corps de la pompe
    drawRoundedRect(ctx, -30, -36, 48, 72, 9);
    ctx.fillStyle = '#FCFAF5';
    ctx.fill();

    // Haut rouge
    drawRoundedRect(ctx, -30, -36, 48, 36, 9);
    ctx.fillStyle = '#E63946';
    ctx.fill();

    // Écran compteur
    drawRoundedRect(ctx, -22, -28, 32, 20, 4);
    ctx.fillStyle = '#14281D';
    ctx.fill();

    // Barres dorées du compteur
    ctx.fillStyle = '#FBD368';
    ctx.fillRect(-17, -22, 6, 9);
    ctx.fillRect(-9, -22, 6, 9);
    ctx.fillRect(-1, -22, 6, 9);

    // Socle
    drawRoundedRect(ctx, -36, 32, 60, 9, 4);
    ctx.fillStyle = '#FBD368';
    ctx.fill();

    ctx.restore();
  }

  function drawQrCodeOnCanvas(ctx, qrUrl, x, y, boxSize) {
    const matrix = generateQrMatrix(qrUrl);
    const n = matrix.length;
    const quietZone = 3;
    const totalModules = n + quietZone * 2;
    const cellSize = boxSize / totalModules;

    drawRoundedRect(ctx, x, y, boxSize, boxSize, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    ctx.fillStyle = '#0F261A';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          const rx = x + (c + quietZone) * cellSize;
          const ry = y + (r + quietZone) * cellSize;
          ctx.fillRect(Math.floor(rx), Math.floor(ry), Math.ceil(cellSize), Math.ceil(cellSize));
        }
      }
    }
  }

  function renderShareVisualToCanvas(canvas, pkg) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const isStory = pkg.visualFormat === 'story';
    const width = 1080;
    const height = isStory ? 1920 : 1080;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 1. Fond dégradé Vert Pin profond
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0F261A');
    bgGrad.addColorStop(0.55, '#1A3C2A');
    bgGrad.addColorStop(1, '#11291D');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Halo décoratif doux
    const radial = ctx.createRadialGradient(width * 0.5, isStory ? 460 : 280, 40, width * 0.5, isStory ? 460 : 280, 620);
    radial.addColorStop(0, 'rgba(251, 211, 104, 0.16)');
    radial.addColorStop(1, 'rgba(251, 211, 104, 0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, width, height);

    // Cadre doré subtil
    const pad = isStory ? 48 : 38;
    drawRoundedRect(ctx, pad, pad, width - pad * 2, height - pad * 2, 36);
    ctx.strokeStyle = 'rgba(251, 211, 104, 0.32)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = 'center';

    if (isStory) {
      // ==================== MISE EN PAGE STORY 9:16 (1080x1920) ====================
      drawFuelPumpEmblem(ctx, width / 2, 175, 1.25);

      ctx.fillStyle = '#FBD368';
      ctx.font = '700 28px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('BUJUMBURA · ENTRAIDE COMMUNAUTAIRE 🇧🇮', width / 2, 290);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 68px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('IGITORO LIVE', width / 2, 368);

      // Bandeau contextuel (Station ou Quartier ou Général)
      drawRoundedRect(ctx, 110, 415, width - 220, 78, 20);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(251, 211, 104, 0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#FBD368';
      ctx.font = '700 30px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(pkg.contextHeading, width / 2, 465);

      // Bloc Problème (Les 3 profils)
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 54px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Tu cherches du carburant ?', width / 2, 595);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = '600 42px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Tu viens d’en voir ou d’observer une file ?', width / 2, 665);

      // Carte centrale : Solution & Concept central
      drawRoundedRect(ctx, 90, 735, width - 180, 250, 28);
      ctx.fillStyle = '#FCFAF5';
      ctx.fill();

      ctx.fillStyle = '#1A3C2A';
      ctx.font = '800 52px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Tu cherches. Tu observes. Tu aides.', width / 2, 835);

      ctx.fillStyle = '#B47800';
      ctx.font = '700 40px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Partage l’information. Aide quelqu’un.', width / 2, 915);

      // Les 3 piliers d'action
      const pillars = [
        { icon: '🔎', title: 'Consulte', sub: 'les retours récents avant de te déplacer' },
        { icon: '📸', title: 'Signale', sub: 'ce que tu vois sur place en 10 secondes' },
        { icon: '✅', title: 'Confirme', sub: 'ou mets à jour l’état d’une station' }
      ];

      let py = 1040;
      for (const p of pillars) {
        drawRoundedRect(ctx, 110, py, width - 220, 106, 20);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.fill();

        ctx.textAlign = 'left';
        ctx.fillStyle = '#FBD368';
        ctx.font = '700 36px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`${p.icon}  ${p.title}`, 150, py + 48);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.font = '500 28px "Inter", sans-serif';
        ctx.fillText(p.sub, 150, py + 84);
        py += 126;
      }

      // Bloc QR Code + URL publique
      ctx.textAlign = 'left';
      drawRoundedRect(ctx, 110, 1445, width - 220, 290, 26);
      ctx.fillStyle = 'rgba(10, 26, 18, 0.68)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(251, 211, 104, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();

      drawQrCodeOnCanvas(ctx, pkg.qrUrl, 145, 1475, 230);

      ctx.fillStyle = '#FBD368';
      ctx.font = '700 30px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('ACCÈS DIRECT GRATUIT', 410, 1535);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 34px "Plus Jakarta Sans", sans-serif';
      const displayHost = pkg.qrUrl.replace(/^https?:\/\//, '');
      ctx.fillText(displayHost.slice(0, 32), 410, 1590);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
      ctx.font = '500 26px "Inter", sans-serif';
      ctx.fillText('Scannez le QR code ou ouvrez le lien', 410, 1642);
      ctx.fillText('pour consulter et partager en direct.', 410, 1680);

      // Pied de page discret
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.font = '500 24px "Inter", sans-serif';
      ctx.fillText('Observations communautaires · Pas une garantie de stock', width / 2, 1800);

      ctx.fillStyle = '#FBD368';
      ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('🇧🇮 Built by Tedd', width / 2, 1842);
    } else {
      // ==================== MISE EN PAGE CARRÉE 1:1 (1080x1080) ====================
      drawFuelPumpEmblem(ctx, 145, 135, 0.95);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#FBD368';
      ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('BUJUMBURA · ENTRAIDE CARBURANT 🇧🇮', 225, 115);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 54px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('IGITORO LIVE', 225, 172);

      // Bandeau contextuel
      ctx.textAlign = 'center';
      drawRoundedRect(ctx, 84, 225, width - 168, 64, 16);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fill();
      ctx.fillStyle = '#FBD368';
      ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(pkg.contextHeading, width / 2, 266);

      // Questions d'accroche
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 44px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Tu cherches du carburant ?', width / 2, 355);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = '600 34px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Tu viens d’en voir ou d’observer une file ?', width / 2, 408);

      // Carte centrale
      drawRoundedRect(ctx, 84, 445, width - 168, 175, 24);
      ctx.fillStyle = '#FCFAF5';
      ctx.fill();

      ctx.fillStyle = '#1A3C2A';
      ctx.font = '800 44px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Tu cherches. Tu observes. Tu aides.', width / 2, 518);

      ctx.fillStyle = '#B47800';
      ctx.font = '700 34px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('Partage l’information. Aide quelqu’un.', width / 2, 578);

      // 3 piliers côte à côte
      const pCols = [
        { label: '🔎 Consulte', desc: 'avant de bouger' },
        { label: '📸 Signale', desc: 'ce que tu vois' },
        { label: '✅ Confirme', desc: 'l’info récente' }
      ];
      const boxW = 288;
      for (let i = 0; i < 3; i++) {
        const bx = 84 + i * (boxW + 24);
        drawRoundedRect(ctx, bx, 648, boxW, 100, 18);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fill();

        ctx.fillStyle = '#FBD368';
        ctx.font = '700 28px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(pCols[i].label, bx + boxW / 2, 692);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '500 22px "Inter", sans-serif';
        ctx.fillText(pCols[i].desc, bx + boxW / 2, 728);
      }

      // Pied avec QR Code + URL
      drawRoundedRect(ctx, 84, 776, width - 168, 200, 22);
      ctx.fillStyle = 'rgba(10, 26, 18, 0.68)';
      ctx.fill();

      drawQrCodeOnCanvas(ctx, pkg.qrUrl, 110, 794, 164);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#FBD368';
      ctx.font = '700 24px "Plus Jakarta Sans", sans-serif';
      ctx.fillText('REJOIGNEZ LA COMMUNAUTÉ SUR :', 302, 842);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 30px "Plus Jakarta Sans", sans-serif';
      const displayHost = pkg.qrUrl.replace(/^https?:\/\//, '');
      ctx.fillText(displayHost.slice(0, 34), 302, 886);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '500 22px "Inter", sans-serif';
      ctx.fillText('Observations citoyennes · Built by Tedd 🇧🇮', 302, 932);
    }

    return canvas;
  }

  // ============================================================================
  // 5. WEB SHARE API, DÉTECTION DES CAPACITÉS ET FALLBACKS ROBUSTES
  // ============================================================================

  function detectShareCapabilities(navOverride) {
    const nav = navOverride || (typeof navigator !== 'undefined' ? navigator : null);
    const hasWebShare = Boolean(nav && typeof nav.share === 'function');
    let canShareFiles = false;

    if (hasWebShare && typeof nav.canShare === 'function' && typeof File !== 'undefined') {
      try {
        const testFile = new File([new Uint8Array([137, 80, 78, 71])], 'test.png', { type: 'image/png' });
        canShareFiles = Boolean(nav.canShare({ files: [testFile] }));
      } catch (_) {
        canShareFiles = false;
      }
    }

    return {
      hasWebShare,
      canShareFiles,
      hasClipboard: Boolean(nav && nav.clipboard && typeof nav.clipboard.writeText === 'function')
    };
  }

  function buildChannelDirectIntentUrl(pkg) {
    const encodedText = encodeURIComponent(pkg.text);
    const encodedUrl = encodeURIComponent(pkg.url);
    const encodedSubject = encodeURIComponent(pkg.subject || pkg.title);

    switch (pkg.channel) {
      case 'whatsapp_chat':
      case 'whatsapp_status':
        return `https://wa.me/?text=${encodedText}`;
      case 'facebook_post':
      case 'facebook_story':
        return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`;
      case 'x': {
        // Pour X, l'URL est déjà dans pkg.text, donc on passe uniquement text pour éviter de la dupliquer
        return `https://twitter.com/intent/tweet?text=${encodedText}`;
      }
      case 'sms':
        return `sms:?body=${encodedText}`;
      case 'email':
        return `mailto:?subject=${encodedSubject}&body=${encodedText}`;
      default:
        return null;
    }
  }

  async function canvasToFile(canvas, fileName, mimeType = 'image/png') {
    if (!canvas || typeof canvas.toBlob !== 'function' || typeof File === 'undefined') {
      return null;
    }
    return new Promise((resolve) => {
      try {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(null);
          try {
            const file = new File([blob], fileName || 'igitoro-live.png', { type: mimeType });
            resolve(file);
          } catch (_) {
            resolve(null);
          }
        }, mimeType, 0.92);
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Exécute le partage avec gestion complète de Web Share API, canShare(files),
   * annulation utilisateur et fallbacks honnêtes.
   */
  async function executeShareAction(pkg, canvas, options = {}) {
    const nav = options.navigator || (typeof navigator !== 'undefined' ? navigator : null);
    const forceNative = Boolean(options.forceNative);
    const capabilities = detectShareCapabilities(nav);

    // 1. Si l'utilisateur clique sur "Partager partout" ou un mode Story sur mobile ou forceNative
    const preferNative =
      forceNative ||
      pkg.channel === 'everywhere' ||
      pkg.channel === 'other_apps' ||
      pkg.channel === 'instagram_story' ||
      pkg.channel === 'whatsapp_status' ||
      pkg.channel === 'facebook_story';

    if (preferNative && capabilities.hasWebShare) {
      try {
        const file = await canvasToFile(canvas, pkg.fileName, pkg.mimeType);
        if (file && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
          await nav.share({
            title: pkg.title,
            text: pkg.text,
            files: [file]
          });
          return {
            ok: true,
            mode: 'native_file',
            userMessage: 'Partage natif ouvert avec le visuel et le message.'
          };
        }

        // Fallback Web Share texte + URL si le fichier n'est pas accepté par le navigateur
        await nav.share({
          title: pkg.title,
          text: pkg.text,
          url: pkg.url
        });
        return {
          ok: true,
          mode: 'native_text',
          userMessage: 'Partage natif ouvert avec le message et le lien.'
        };
      } catch (err) {
        if (err && (err.name === 'AbortError' || String(err.message || '').toLowerCase().includes('abort'))) {
          return {
            ok: false,
            cancelled: true,
            mode: 'cancelled',
            userMessage: 'Partage annulé. Votre visuel et votre message restent prêts.'
          };
        }
        // En cas d'erreur technique du système de partage natif, basculer proprement sur le fallback
      }
    }

    // 2. Intents officiels par canal (WhatsApp, Facebook, X, SMS, E-mail)
    const intentUrl = buildChannelDirectIntentUrl(pkg);
    if (intentUrl && !forceNative) {
      return {
        ok: true,
        mode: 'channel_intent',
        intentUrl,
        userMessage: `Ouverture de ${pkg.platformName} avec votre message prêt.`
      };
    }

    // 3. Fallback honnête (ex: Instagram Story sur ordinateur ou navigateur sans Web Share)
    return {
      ok: true,
      mode: 'manual_fallback',
      userMessage: 'Le partage direct n’est pas disponible sur cet appareil pour ce canal. Votre visuel et votre message sont prêts : téléchargez l’image et copiez le texte pour publier.'
    };
  }

  // Export universel (Navigateur + Node.js pour les tests automatisés)
  const api = {
    DEFAULT_PUBLIC_ORIGIN,
    CHANNEL_META,
    sanitizeText,
    resolvePublicShareOrigin,
    sanitizeShareUrl,
    generateQrMatrix,
    generateSharePackage,
    renderShareVisualToCanvas,
    detectShareCapabilities,
    buildChannelDirectIntentUrl,
    executeShareAction
  };

  root.IgitoroShare = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
