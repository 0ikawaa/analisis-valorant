// Genera el dashboard HTML: un único archivo autocontenido, sin CDN ni red.
// El CSS, la lógica de estadística y el código de los gráficos se inyectan
// desde sus archivos reales, así que no hay lógica duplicada.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

async function read(name) {
  return readFile(join(HERE, name), 'utf8');
}

/** stats.js es un módulo ESM en Node; para el navegador le sacamos import/export. */
function stripModuleSyntax(source) {
  return source
    .replace(/^\s*import[\s\S]*?;\s*$/gm, '')
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/m, '')
    .replace(/^export\s+/gm, '');
}

const escapeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function buildReport(dataset, outFile) {
  const [css, statsSrc, clientSrc] = await Promise.all([read('report.css'), read('stats.js'), read('client.js')]);

  const { player, rank, mode, matches, rrSeries } = dataset;
  const first = matches[0];
  const last = matches[matches.length - 1];
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('es-UY', { day: '2-digit', month: 'short', year: 'numeric' });

  const payload = {
    player,
    rank,
    mode,
    matches,
    rrSeries,
    generatedAt: Date.now(),
  };

  const rankChip = rank?.tier
    ? `<div class="rank-chip"><strong>${escapeHtml(rank.tier)}</strong><span>${rank.rr} RR</span>${
        rank.peak ? `<span>· pico ${escapeHtml(rank.peak)}</span>` : ''
      }</div>`
    : '';

  const html = `<!doctype html>
<html lang="es" >
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(player.name)}#${escapeHtml(player.tag)} — análisis de VALORANT</title>
<style>
${css}
</style>
</head>
<body>
<div id="tooltip" role="status" aria-live="polite"></div>
<div class="wrap">

  <header class="top">
    <div>
      <h1>${escapeHtml(player.name)}<span style="color:var(--muted)">#${escapeHtml(player.tag)}</span></h1>
      <p class="sub">${matches.length} partidas de ${escapeHtml(mode === 'all' ? 'todos los modos' : mode)} ·
        ${fmtDate(first.ts)} – ${fmtDate(last.ts)} · región ${escapeHtml(player.region.toUpperCase())}</p>
    </div>
    <div class="spacer"></div>
    ${rankChip}
    <button class="theme" id="theme-toggle" type="button">Cambiar tema</button>
  </header>

  <div class="filters" role="group" aria-label="Filtros">
    <label>Rango
      <select id="f-range">
        <option value="20">Últimas 20</option>
        <option value="50" selected>Últimas 50</option>
        <option value="100">Últimas 100</option>
        <option value="all">Todas</option>
      </select>
    </label>
    <label>Mapa <select id="f-map"></select></label>
    <label>Agente <select id="f-agent"></select></label>
    <button class="reset" id="f-reset" type="button">Limpiar</button>
    <span class="count" id="f-count"></span>
  </div>

  <div class="tiles" id="tiles"></div>

  <div class="grid">

    <section class="card wide">
      <h2>Qué dicen tus partidas</h2>
      <p class="note">Hallazgos automáticos sobre el conjunto filtrado. Se descartan las diferencias con muy pocas partidas detrás.</p>
      <div class="insights" id="insights"></div>
      <p class="note" id="streaks" style="margin-top:14px"></p>
    </section>

    <section class="card wide" id="card-rr">
      <h2>Evolución del rango</h2>
      <p class="note">Elo acumulado a lo largo del período. Pasá el mouse por el gráfico para ver partida por partida.</p>
      <div class="plot" id="chart-rr"></div>
    </section>

    <section class="card wide" id="card-rr-match">
      <h2>RR ganado y perdido por partida</h2>
      <div class="legend">
        <span class="item"><span class="swatch" style="background:var(--pos)"></span>RR ganado</span>
        <span class="item"><span class="swatch" style="background:var(--neg)"></span>RR perdido</span>
      </div>
      <div class="plot" id="chart-rr-match"></div>
    </section>

    <section class="card wide">
      <h2>Winrate móvil</h2>
      <p class="note" id="rolling-note"></p>
      <div class="plot" id="chart-rolling"></div>
    </section>

    <section class="card">
      <h2>Winrate por mapa</h2>
      <p class="note">Ordenado de mejor a peor. Mirá también la cantidad de partidas: un 100 % en 2 partidas no dice nada.</p>
      <div class="plot" id="chart-map"></div>
      <details class="table-twin">
        <summary>Ver tabla completa por mapa</summary>
        <div id="table-map"></div>
      </details>
    </section>

    <section class="card">
      <h2>Winrate por agente</h2>
      <p class="note">Tu rendimiento con cada personaje del pool.</p>
      <div class="plot" id="chart-agent"></div>
      <details class="table-twin">
        <summary>Ver tabla completa por agente</summary>
        <div id="table-agent"></div>
      </details>
    </section>

    <section class="card">
      <h2>¿Cuándo conviene parar?</h2>
      <p class="note" id="session-note"></p>
      <div class="plot" id="chart-session"></div>
    </section>

    <section class="card">
      <h2>Winrate por hora del día</h2>
      <p class="note">Hora local. Las franjas con pocas partidas son ruido, no señal.</p>
      <div class="plot" id="chart-hour"></div>
    </section>

    <section class="card wide">
      <h2>Todas las partidas</h2>
      <p class="note">El detalle crudo del conjunto filtrado, de la más reciente a la más vieja.</p>
      <details class="table-twin" open>
        <summary>Ver tabla</summary>
        <div id="table-matches"></div>
      </details>
    </section>

  </div>

  <footer class="foot">
    Generado el ${new Date().toLocaleString('es-UY')} con valorant-analyzer · datos de la API no oficial de HenrikDev.
    Este proyecto no está afiliado ni respaldado por Riot Games.
  </footer>
</div>

<script>
window.__VAL_DATA__ = ${escapeJson(payload)};
${stripModuleSyntax(statsSrc)}
${clientSrc}
</script>
</body>
</html>
`;

  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html, 'utf8');
  return outFile;
}
