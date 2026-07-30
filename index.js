#!/usr/bin/env node
// valorant-analyzer — baja tu historial, lo analiza y genera un dashboard HTML.
//
//   node index.js --player "Nombre#TAG" --open
//   node index.js --demo --open        (sin API key, con datos de ejemplo)

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { HenrikClient, HenrikError } from './src/api.js';
import { collect } from './src/collect.js';
import { buildReport } from './src/report.js';
import { analyze, buildInsights } from './src/stats.js';
import { demoDataset } from './src/demo.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

const USAGE = `
valorant-analyzer — análisis de tus partidas de VALORANT

  node index.js --player "Nombre#TAG" [opciones]
  node index.js --demo --open

Opciones
  --player, -p   Riot ID completo, con el formato Nombre#TAG
  --key, -k      API key de HenrikDev (o VALORANT_API_KEY en el .env)
  --region, -r   ap | br | eu | kr | latam | na  (por defecto se detecta sola)
  --mode, -m     competitive (por defecto) | unrated | swiftplay | deathmatch | all
  --matches, -n  cuántas partidas bajar como máximo (por defecto 100)
  --out, -o      ruta del HTML de salida (por defecto out/reporte.html)
  --refresh      ignora la caché y vuelve a pedir todo a la API
  --open         abre el informe en el navegador al terminar
  --demo         genera un informe de ejemplo, sin API ni key
  --help, -h     esta ayuda

La API key se pide gratis en https://api.henrikdev.xyz/dashboard/
`;

function parseArgs(argv) {
  const flags = {
    player: null, key: null, region: null, mode: 'competitive',
    matches: 100, out: null, refresh: false, open: false, demo: false, help: false,
  };
  const alias = { p: 'player', k: 'key', r: 'region', m: 'mode', n: 'matches', o: 'out', h: 'help' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) continue;
    const bare = arg.replace(/^--?/, '');
    const [name, inlineValue] = bare.split('=');
    const key = alias[name] || name;
    if (!(key in flags)) throw new Error(`Opción desconocida: ${arg}`);
    if (typeof flags[key] === 'boolean') {
      flags[key] = true;
    } else {
      const value = inlineValue !== undefined ? inlineValue : argv[++i];
      if (value === undefined) throw new Error(`La opción ${arg} necesita un valor.`);
      flags[key] = key === 'matches' ? Number(value) : value;
    }
  }
  return flags;
}

/** Lector de .env mínimo: no vale la pena una dependencia para esto. */
async function loadEnv() {
  const out = {};
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // Sin .env no pasa nada: se puede pasar todo por argumentos o variables de entorno.
  }
  return out;
}

function splitRiotId(value) {
  const idx = value.lastIndexOf('#');
  if (idx < 1 || idx === value.length - 1) {
    throw new Error(`Riot ID inválido: "${value}". Tiene que ser Nombre#TAG, por ejemplo "Marke#LAS".`);
  }
  return { name: value.slice(0, idx).trim(), tag: value.slice(idx + 1).trim() };
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);

function printSummary(dataset) {
  const a = analyze(dataset.matches);
  const o = a.overall;
  const line = '─'.repeat(58);

  console.log(`\n${line}`);
  console.log(`  ${dataset.player.name}#${dataset.player.tag}  ·  ${o.matches} partidas analizadas`);
  console.log(line);
  console.log(`  Winrate      ${padL(f1(o.winrate) + ' %', 8)}   (${o.wins}V · ${o.losses}D${o.draws ? ` · ${o.draws}E` : ''})`);
  console.log(`  K/D          ${padL(f2(o.kd), 8)}   KDA ${f2(o.kda)}`);
  console.log(`  ACS          ${padL(o.acs.toFixed(0), 8)}   ADR ${o.adr.toFixed(0)}`);
  console.log(`  Headshots    ${padL(f1(o.hs) + ' %', 8)}   ${o.rounds} rondas jugadas`);
  if (o.rrMatches) {
    console.log(`  RR neto      ${padL((o.rr >= 0 ? '+' : '') + o.rr, 8)}   ${(o.rrPerMatch >= 0 ? '+' : '') + f1(o.rrPerMatch)} por partida`);
  }

  const top = (rows, label) => {
    const eligible = rows.filter((g) => g.matches >= 3).slice(0, 5);
    if (!eligible.length) return;
    console.log(`\n  ${label}`);
    for (const g of eligible) {
      console.log(`    ${pad(g.key, 12)} ${padL(f1(g.winrate) + ' %', 7)}  ${padL(g.matches + ' part.', 10)}  K/D ${f2(g.kd)}`);
    }
  };
  top(a.byMap, 'Mejores mapas (mínimo 3 partidas)');
  top(a.byAgent, 'Mejores agentes (mínimo 3 partidas)');

  const insights = buildInsights(a, Math.max(3, Math.round(o.matches / 12)));
  if (insights.length) {
    console.log('\n  Conclusiones');
    for (const ins of insights) {
      const mark = ins.tone === 'good' ? '+' : ins.tone === 'bad' ? '!' : '·';
      console.log(`    ${mark} ${ins.title}`);
    }
  }
  console.log('');
}

function openInBrowser(file) {
  // `start` es un builtin de cmd, así que hay que invocarlo a través de cmd.
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [file], { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return;
  }

  const env = await loadEnv();
  const outFile = resolve(ROOT, flags.out || 'out/reporte.html');

  let dataset;

  if (flags.demo) {
    console.log('Modo demo: generando partidas de ejemplo (no se llama a la API).');
    dataset = demoDataset(90);
  } else {
    const playerRaw = flags.player || env.VALORANT_PLAYER || process.env.VALORANT_PLAYER;
    if (!playerRaw || playerRaw.includes('Nombre#TAG')) {
      console.error('Falta tu Riot ID. Pasalo con --player "Nombre#TAG" o ponelo en el .env.');
      console.error('Si querés ver cómo queda el informe sin API key: node index.js --demo --open');
      process.exitCode = 1;
      return;
    }
    const apiKey = flags.key || env.VALORANT_API_KEY || process.env.VALORANT_API_KEY;
    if (!apiKey || apiKey.includes('pega-tu-key')) {
      console.error('Falta la API key de HenrikDev.');
      console.error('Pedila gratis en https://api.henrikdev.xyz/dashboard/ y ponela en el .env como VALORANT_API_KEY.');
      process.exitCode = 1;
      return;
    }

    const { name, tag } = splitRiotId(playerRaw);
    const client = new HenrikClient({
      apiKey,
      cacheDir: join(ROOT, 'data', 'cache'),
      refresh: flags.refresh,
      log: (msg) => console.log(msg),
    });

    dataset = await collect(client, {
      name,
      tag,
      region: flags.region || env.VALORANT_REGION || null,
      mode: (flags.mode || env.VALORANT_MODE || 'competitive').toLowerCase(),
      maxMatches: Number.isFinite(flags.matches) && flags.matches > 0 ? flags.matches : 100,
      log: (msg) => console.log(msg),
    });

    console.log(`\n${dataset.matches.length} partidas listas (${client.requests} peticiones a la API, ${client.cacheHits} desde caché).`);
  }

  printSummary(dataset);
  await buildReport(dataset, outFile);
  console.log(`Informe generado: ${outFile}`);

  if (flags.open) openInBrowser(outFile);
}

main().catch((err) => {
  if (err instanceof HenrikError) {
    console.error(`\nError de la API: ${err.message}`);
    if (err.status === 404) {
      console.error('Sugerencia: el Riot ID distingue mayúsculas y el tag va sin el "#". Probá con --mode all.');
    }
  } else {
    console.error(`\nError: ${err.message}`);
  }
  process.exitCode = 1;
});
