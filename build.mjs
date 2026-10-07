// Crea dist/ata-coach.html: un unico file autosufficiente (nessun server necessario).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const ORDER = ['core/util.js', 'core/store.js', 'content/seed.js', 'engine/srs.js', 'engine/learning.js', 'engine/quiz.js', 'engine/scheduler.js', 'engine/reporting.js', 'engine/bando.js', 'engine/packs.js', 'core/sync.js', 'ai/ai.js', 'ui/app.js'];
let js = '';
for (const f of ORDER) {
  let src = readFileSync('src/' + f, 'utf8');
  for (const line of src.match(/^import .*$/gm) || []) if (/\bas\b/.test(line.split(' from ')[0])) throw new Error('Alias negli import non supportati dal file unico (' + f + '): ' + line);
  src = src.replace(/^import .*? from .*?;\s*$/gm, '').replace(/^export (async function|function|class|const|let)/gm, '$1');
  if (/\bimport\s*\(|^export /m.test(src)) throw new Error('Import/export non gestito in ' + f);
  js += `\n// ===== ${f} =====\n${src}`;
}
const css = readFileSync('src/ui/styles.css', 'utf8');
const html = `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>ATA Coach</title><meta name="theme-color" content="#2C3A92">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap" rel="stylesheet">
<style>${css}</style></head>
<body><div id="app"><p style="padding:2rem">Caricamento…</p></div>
<script>window.__SINGLE_FILE__ = true;</script>
<script>(function(){'use strict';${js}\n})();</script>
</body></html>`;
mkdirSync('dist', { recursive: true });
writeFileSync('dist/ata-coach.html', html);
console.log('Creato dist/ata-coach.html (' + Math.round(html.length / 1024) + ' KB)');
