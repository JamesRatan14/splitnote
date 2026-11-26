// Post-processes the Expo web export (output: "single") so it works as an installable
// PWA on GitHub Pages: injects home-screen tags and creates 404.html for deep-link fallback.
const fs = require('fs');
const path = require('path');

const base = process.env.EXPO_BASE_URL || '';
const dist = process.env.DIST_DIR || path.join(__dirname, '..', 'dist');
const indexPath = path.join(dist, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const tags = [
  '<meta name="theme-color" content="#1D9E75">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="SplitNote">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  `<link rel="manifest" href="${base}/manifest.json">`,
  `<link rel="apple-touch-icon" href="${base}/apple-touch-icon.png">`,
  // page background = app background, so no white strip shows before/around the app (iOS home-screen mode)
  '<style>html,body{background-color:#080B12;}</style>',
].join('\n    ');

if (!html.includes('apple-touch-icon')) html = html.replace('</head>', `    ${tags}\n  </head>`);
// make sure the viewport covers the notch area
html = html.replace(/<meta name="viewport" content="([^"]*)"/, (m, c) =>
  c.includes('viewport-fit') ? m : `<meta name="viewport" content="${c}, viewport-fit=cover"`
);
fs.writeFileSync(indexPath, html);
fs.copyFileSync(indexPath, path.join(dist, '404.html')); // GitHub Pages SPA fallback
console.log('postexport: injected PWA tags and wrote 404.html (base="' + base + '")');
