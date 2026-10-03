import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Table CRC32 pour l'encodage PNG valide
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type None
    const srcOffset = y * width * 4;
    const dstOffset = y * stride + 1;
    rgba.copy(raw, dstOffset, srcOffset, srcOffset + width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// Signed Distance Functions (SDF) en coordonnées normalisées [-1, 1]
function sdRoundedBox(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    r
  );
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function mixColor(bg, fg, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    Math.round(bg[0] * (1 - a) + fg[0] * a),
    Math.round(bg[1] * (1 - a) + fg[1] * a),
    Math.round(bg[2] * (1 - a) + fg[2] * a),
    255
  ];
}

function smoothCoverage(dist, pixelSize) {
  return Math.max(0, Math.min(1, 0.5 - dist / pixelSize));
}

/**
 * Génère une icône PNG avec une pompe à essence (style Igitoro Live ⛽)
 */
function renderFuelPumpIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = maskable ? 1.22 : 1.0;
  const pixelSize = (2.0 * scale) / size;

  // Couleurs de la marque Igitoro Live + Pompe à essence ⛽
  const pineDark = [20, 48, 34];      // #143022
  const pineLight = [38, 88, 62];     // #26583E
  const goldAccent = [251, 211, 104]; // #FBD368
  const pumpRed = [230, 57, 70];      // #E63946 (haut de la pompe à essence ⛽)
  const pumpRedDark = [185, 28, 40];  // #B91C28
  const creamWhite = [252, 250, 245]; // #FCFAF5 (corps de la pompe)
  const screenDark = [22, 42, 32];    // #162A20 (écran compteur)
  const hoseGold = [245, 184, 65];    // #F5B841 (tuyau & pistolet)
  const nozzleSilver = [255, 232, 163];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Coordonnées normalisées [-1, 1]
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;

      // Dégradé de fond vert pin (Igitoro Live)
      const gradT = Math.max(0, Math.min(1, (nx + ny + 2) / 4));
      let color = [
        Math.round(pineLight[0] * (1 - gradT) + pineDark[0] * gradT),
        Math.round(pineLight[1] * (1 - gradT) + pineDark[1] * gradT),
        Math.round(pineLight[2] * (1 - gradT) + pineDark[2] * gradT),
        255
      ];

      // Halo lumineux central subtil
      const centerDist = Math.hypot(nx, ny);
      if (centerDist < 0.85) {
        const glow = Math.pow(1 - centerDist / 0.85, 2) * 0.16;
        color = mixColor(color, goldAccent, glow);
      }

      // Bordure dorée intérieure subtile pour les icônes standard
      if (!maskable) {
        const borderDist = Math.abs(sdRoundedBox(nx, ny, 0.88, 0.88, 0.36)) - 0.018;
        const borderAlpha = smoothCoverage(borderDist, pixelSize) * 0.45;
        color = mixColor(color, goldAccent, borderAlpha);
      }

      // Coordonnées de la pompe (avec marge de sécurité maskable)
      const px = (nx + 0.08) * scale; // léger décalage à gauche pour équilibrer le tuyau à droite
      const py = ny * scale;

      // 1. Ombre portée sous la pompe
      const shadowDist = sdRoundedBox(px - 0.03, py - 0.05, 0.34, 0.50, 0.09);
      const shadowAlpha = smoothCoverage(shadowDist, pixelSize * 2.5) * 0.35;
      color = mixColor(color, [8, 20, 14], shadowAlpha);

      // 2. Tuyau de la pompe à essence (à droite du corps)
      const dHose1 = sdSegment(px, py, 0.30, 0.02, 0.46, 0.02) - 0.042;
      const dHose2 = sdSegment(px, py, 0.46, 0.02, 0.46, 0.34) - 0.042;
      const dHose3 = sdSegment(px, py, 0.46, 0.34, 0.58, 0.34) - 0.042;
      const dHose4 = sdSegment(px, py, 0.58, 0.34, 0.58, -0.18) - 0.042;
      const dHose = Math.min(dHose1, dHose2, dHose3, dHose4);
      color = mixColor(color, hoseGold, smoothCoverage(dHose, pixelSize));

      // Pistolet à carburant (nozzle) en haut à droite du tuyau
      const dNozzleBody = sdSegment(px, py, 0.58, -0.18, 0.44, -0.32) - 0.048;
      const dNozzleTip = sdSegment(px, py, 0.44, -0.32, 0.36, -0.26) - 0.030;
      const dNozzle = Math.min(dNozzleBody, dNozzleTip);
      color = mixColor(color, nozzleSilver, smoothCoverage(dNozzle, pixelSize));

      // 3. Corps principal de la pompe à essence
      const dBody = sdRoundedBox(px, py, 0.32, 0.48, 0.08);
      const bodyCov = smoothCoverage(dBody, pixelSize);
      if (bodyCov > 0) {
        // Partie haute rouge vif (comme l'icône ⛽), partie basse blanc crème
        const isTopHalf = py < 0.04;
        const bodyFill = isTopHalf
          ? (px > 0.15 ? pumpRedDark : pumpRed)
          : creamWhite;
        color = mixColor(color, bodyFill, bodyCov);
      }

      // Bande de séparation dorée au milieu de la pompe
      const dDivider = sdRoundedBox(px, py - 0.04, 0.325, 0.028, 0.01);
      color = mixColor(color, goldAccent, smoothCoverage(dDivider, pixelSize));

      // 4. Écran du compteur dans la partie supérieure
      const dScreenFrame = sdRoundedBox(px, py + 0.22, 0.23, 0.14, 0.04);
      color = mixColor(color, creamWhite, smoothCoverage(dScreenFrame, pixelSize));

      const dScreen = sdRoundedBox(px, py + 0.22, 0.19, 0.105, 0.025);
      color = mixColor(color, screenDark, smoothCoverage(dScreen, pixelSize));

      // Chiffres / barres lumineuses dorées sur l'écran du compteur
      const dMeter1 = sdRoundedBox(px + 0.09, py + 0.22, 0.03, 0.045, 0.01);
      const dMeter2 = sdRoundedBox(px, py + 0.22, 0.03, 0.045, 0.01);
      const dMeter3 = sdRoundedBox(px - 0.09, py + 0.22, 0.03, 0.045, 0.01);
      const dMeters = Math.min(dMeter1, dMeter2, dMeter3);
      color = mixColor(color, goldAccent, smoothCoverage(dMeters, pixelSize));

      // 5. Goutte de carburant verte/dorée au centre de la partie basse
      const dropCx = 0.0;
      const dropCy = 0.27;
      const dDropCircle = sdCircle(px, py, dropCx, dropCy, 0.095);
      const dDropCone = sdSegment(px, py, dropCx, dropCy - 0.13, dropCx, dropCy) - (0.095 * (py - (dropCy - 0.16)) / 0.16);
      const dDrop = Math.min(dDropCircle, Math.max(dDropCone, Math.abs(py - (dropCy - 0.05)) - 0.10));
      color = mixColor(color, pineLight, smoothCoverage(dDrop, pixelSize));

      // Petit reflet doré dans la goutte
      const dDropHighlight = sdCircle(px, py, dropCx - 0.03, dropCy + 0.02, 0.028);
      color = mixColor(color, goldAccent, smoothCoverage(dDropHighlight, pixelSize));

      // 6. Socle robuste de la pompe en bas
      const dBase = sdRoundedBox(px, py - 0.49, 0.39, 0.055, 0.025);
      color = mixColor(color, goldAccent, smoothCoverage(dBase, pixelSize));

      const idx = (y * size + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = 255;
    }
  }

  return encodePNG(size, size, rgba);
}

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#26583E"/>
      <stop offset="100%" stop-color="#143022"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect x="28" y="28" width="456" height="456" rx="92" fill="none" stroke="#FBD368" stroke-opacity="0.4" stroke-width="8"/>
  <!-- Tuyau et pistolet -->
  <path d="M312 260 H352 V345 H386 V210 L348 172 L326 190" fill="none" stroke="#F5B841" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Corps de la pompe -->
  <rect x="148" y="132" width="164" height="248" rx="28" fill="#FCFAF5"/>
  <path d="M148 160 C148 144.5 160.5 132 176 132 H284 C299.5 132 312 144.5 312 160 V266 H148 Z" fill="#E63946"/>
  <rect x="146" y="258" width="168" height="14" rx="6" fill="#FBD368"/>
  <!-- Écran compteur -->
  <rect x="172" y="162" width="116" height="72" rx="12" fill="#FCFAF5"/>
  <rect x="182" y="172" width="96" height="52" rx="8" fill="#162A20"/>
  <rect x="198" y="186" width="14" height="24" rx="4" fill="#FBD368"/>
  <rect x="223" y="186" width="14" height="24" rx="4" fill="#FBD368"/>
  <rect x="248" y="186" width="14" height="24" rx="4" fill="#FBD368"/>
  <!-- Goutte de carburant -->
  <path d="M230 290 C230 290 198 326 198 344 A32 32 0 1 0 262 344 C262 326 230 290 230 290 Z" fill="#26583E"/>
  <circle cx="220" cy="348" r="8" fill="#FBD368"/>
  <!-- Socle -->
  <rect x="128" y="368" width="204" height="28" rx="12" fill="#FBD368"/>
</svg>`;

const dirs = ['static/icons', 'app/static/icons'];
for (const d of dirs) {
  fs.mkdirSync(path.resolve(d), { recursive: true });
}

const filesToGenerate = [
  { name: 'favicon-32.png', size: 32, maskable: false },
  { name: 'icon-180.png', size: 180, maskable: false },
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true }
];

for (const item of filesToGenerate) {
  const buf = renderFuelPumpIcon(item.size, { maskable: item.maskable });
  for (const d of dirs) {
    fs.writeFileSync(path.resolve(d, item.name), buf);
  }
  console.log(`Généré : ${item.name} (${item.size}x${item.size})`);
}

for (const d of dirs) {
  fs.writeFileSync(path.resolve(d, 'icon.svg'), svgContent, 'utf8');
}
console.log('Généré : icon.svg');

/**
 * Génère une bannière Open Graph 1200x630 pour les aperçus sociaux (WhatsApp, Facebook, X, LinkedIn)
 */
function renderOgBanner(width = 1200, height = 630) {
  const rgba = Buffer.alloc(width * height * 4);
  const pineDark = [16, 39, 27];
  const pineLight = [35, 82, 58];
  const goldAccent = [251, 211, 104];
  const pumpRed = [230, 57, 70];
  const creamWhite = [252, 250, 245];
  const screenDark = [22, 42, 32];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x / width) * 2 - 1;
      const ny = (y / height) * 2 - 1;

      const gradT = Math.max(0, Math.min(1, (nx + ny + 2) / 4));
      let color = [
        Math.round(pineLight[0] * (1 - gradT) + pineDark[0] * gradT),
        Math.round(pineLight[1] * (1 - gradT) + pineDark[1] * gradT),
        Math.round(pineLight[2] * (1 - gradT) + pineDark[2] * gradT),
        255
      ];

      // Bordure dorée panoramique
      const bx = (x - width / 2) / (height / 2);
      const by = (y - height / 2) / (height / 2);
      const aspect = width / height;
      const bDist = Math.abs(sdRoundedBox(bx, by, aspect - 0.08, 0.92, 0.08)) - 0.01;
      color = mixColor(color, goldAccent, smoothCoverage(bDist, 2.0 / height) * 0.5);

      // Pompe à essence centrée
      const px = bx * 1.15;
      const py = by * 1.15;
      const pixelSize = 2.3 / height;

      const dHose1 = sdSegment(px, py, 0.30, 0.02, 0.46, 0.02) - 0.042;
      const dHose2 = sdSegment(px, py, 0.46, 0.02, 0.46, 0.34) - 0.042;
      const dHose3 = sdSegment(px, py, 0.46, 0.34, 0.58, 0.34) - 0.042;
      const dHose4 = sdSegment(px, py, 0.58, 0.34, 0.58, -0.18) - 0.042;
      const dHose = Math.min(dHose1, dHose2, dHose3, dHose4);
      color = mixColor(color, goldAccent, smoothCoverage(dHose, pixelSize));

      const dBody = sdRoundedBox(px, py, 0.32, 0.48, 0.08);
      const bodyCov = smoothCoverage(dBody, pixelSize);
      if (bodyCov > 0) {
        color = mixColor(color, py < 0.04 ? pumpRed : creamWhite, bodyCov);
      }

      const dDivider = sdRoundedBox(px, py - 0.04, 0.325, 0.028, 0.01);
      color = mixColor(color, goldAccent, smoothCoverage(dDivider, pixelSize));

      const dScreenFrame = sdRoundedBox(px, py + 0.22, 0.23, 0.14, 0.04);
      color = mixColor(color, creamWhite, smoothCoverage(dScreenFrame, pixelSize));

      const dScreen = sdRoundedBox(px, py + 0.22, 0.19, 0.105, 0.025);
      color = mixColor(color, screenDark, smoothCoverage(dScreen, pixelSize));

      const dBase = sdRoundedBox(px, py - 0.49, 0.39, 0.055, 0.025);
      color = mixColor(color, goldAccent, smoothCoverage(dBase, pixelSize));

      const idx = (y * width + x) * 4;
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = 255;
    }
  }
  return encodePNG(width, height, rgba);
}

const ogBuf = renderOgBanner(1200, 630);
for (const d of dirs) {
  fs.writeFileSync(path.resolve(d, 'og-share.png'), ogBuf);
}
console.log('Généré : og-share.png (1200x630)');
