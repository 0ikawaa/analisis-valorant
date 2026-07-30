// Descarga y normaliza los datos crudos de la API.
//
// Endpoints usados (todos con la key básica):
//   GET /valorant/v1/account/{name}/{tag}
//   GET /valorant/v1/stored-matches/{region}/{name}/{tag}?mode=&size=&page=
//   GET /valorant/v1/stored-mmr-history/{region}/{name}/{tag}
//   GET /valorant/v2/mmr/{region}/{name}/{tag}
//
// La API cambia de forma entre versiones, así que todo el acceso a campos es
// defensivo: si un campo no está donde esperamos, probamos los alias conocidos
// y caemos a un valor neutro en vez de romper.

import { HenrikError } from './api.js';

const PAGE_SIZE = 20;

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nameOf = (v) => (typeof v === 'string' ? v : pick(v?.name, v?.id, null));

export async function collect(client, { name, tag, region, mode, maxMatches, log = () => {} }) {
  const encName = encodeURIComponent(name);
  const encTag = encodeURIComponent(tag);

  // --- Cuenta: nos da el puuid y, si no la pasaron, la región ---
  log('Buscando la cuenta...');
  const account = await client.get(`/valorant/v1/account/${encName}/${encTag}`);
  const acc = account?.data ?? {};
  const resolvedRegion = (region || acc.region || '').toLowerCase();
  if (!resolvedRegion) {
    throw new HenrikError(
      'No pude determinar tu región. Pasala a mano con --region (ap, br, eu, kr, latam, na).'
    );
  }
  log(`  ${acc.name ?? name}#${acc.tag ?? tag} — región ${resolvedRegion}, nivel ${acc.account_level ?? '?'}`);

  // --- Historial almacenado, paginado ---
  log(`Descargando historial (${mode === 'all' ? 'todos los modos' : mode})...`);
  const raw = [];
  const seen = new Set();
  for (let page = 1; raw.length < maxMatches; page++) {
    const size = Math.min(PAGE_SIZE, maxMatches - raw.length);
    let body;
    try {
      body = await client.get(`/valorant/v1/stored-matches/${resolvedRegion}/${encName}/${encTag}`, {
        mode: mode === 'all' ? undefined : mode,
        size,
        page,
      });
    } catch (err) {
      // Si el modo no existe o la paginación se pasa del final, la API tira 400/404.
      if (page > 1 && (err.status === 400 || err.status === 404)) break;
      throw err;
    }
    const batch = Array.isArray(body?.data) ? body.data : [];
    if (batch.length === 0) break;

    let added = 0;
    for (const m of batch) {
      const id = pick(m?.meta?.id, m?.metadata?.match_id, m?.meta?.matchid);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      raw.push(m);
      added++;
    }
    log(`  página ${page}: ${batch.length} partidas (total ${raw.length})`);
    // Página incompleta o toda repetida = llegamos al final del historial guardado.
    if (batch.length < size || added === 0) break;
  }

  if (raw.length === 0) {
    throw new HenrikError(
      `La API no devolvió partidas para ${name}#${tag} en modo "${mode}". ` +
        'Puede que el historial almacenado esté vacío: probá con --mode all, ' +
        'o jugá una partida para que el perfil quede registrado en la API.'
    );
  }

  // --- Historial de RR y rango actual (opcionales: si fallan, seguimos sin ellos) ---
  let mmrHistory = [];
  let currentRank = null;
  try {
    log('Descargando historial de RR...');
    const body = await client.get(`/valorant/v1/stored-mmr-history/${resolvedRegion}/${encName}/${encTag}`, {
      size: 100,
    });
    mmrHistory = Array.isArray(body?.data) ? body.data : [];
    log(`  ${mmrHistory.length} entradas de RR`);
  } catch (err) {
    log(`  (sin historial de RR: ${err.message})`);
  }
  try {
    const body = await client.get(`/valorant/v2/mmr/${resolvedRegion}/${encName}/${encTag}`);
    const cur = body?.data?.current_data ?? body?.data ?? {};
    currentRank = {
      tier: pick(cur.currenttierpatched, cur.currenttier_patched, null),
      rr: num(pick(cur.ranking_in_tier, cur.rr, 0)),
      elo: num(pick(cur.elo, 0)),
      peak: pick(body?.data?.highest_rank?.patched_tier, null),
    };
  } catch {
    // El rango actual es decorativo; sin él el dashboard funciona igual.
  }

  const rrByMatch = indexRr(mmrHistory);
  const matches = raw.map((m) => normalizeMatch(m, rrByMatch, acc.puuid)).filter(Boolean);
  matches.sort((a, b) => a.ts - b.ts);

  return {
    player: {
      name: acc.name ?? name,
      tag: acc.tag ?? tag,
      puuid: acc.puuid ?? null,
      region: resolvedRegion,
      level: acc.account_level ?? null,
      card: acc.card?.small ?? acc.card?.wide ?? null,
    },
    rank: currentRank,
    mode,
    matches,
    rrSeries: normalizeRr(mmrHistory),
  };
}

/** Mapea match_id -> cambio de RR, para pegarle el dato a cada partida. */
function indexRr(history) {
  const byId = new Map();
  for (const h of history) {
    const id = pick(h?.match_id, h?.matchid, h?.meta?.id);
    if (!id) continue;
    byId.set(id, {
      change: num(pick(h.mmr_change_to_last_game, h.last_mmr_change, 0)),
      elo: num(pick(h.elo, 0)),
      tier: pick(h.currenttierpatched, h.tier?.name, null),
    });
  }
  return byId;
}

function normalizeRr(history) {
  return history
    .map((h) => {
      const ts = toTs(pick(h.date, h.date_raw));
      if (!ts) return null;
      return {
        ts,
        elo: num(pick(h.elo, 0)),
        rr: num(pick(h.ranking_in_tier, 0)),
        change: num(pick(h.mmr_change_to_last_game, h.last_mmr_change, 0)),
        tier: pick(h.currenttierpatched, h.tier?.name, null),
        map: nameOf(h.map) ?? null,
      };
    })
    .filter((x) => x && x.elo > 0)
    .sort((a, b) => a.ts - b.ts);
}

function toTs(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') {
    // La API mezcla segundos y milisegundos según el endpoint.
    return value > 1e12 ? value : value * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeMatch(m, rrByMatch, puuid) {
  const meta = m?.meta ?? {};
  const stats = m?.stats ?? {};
  const teams = m?.teams ?? {};

  const ts = toTs(pick(meta.started_at, meta.game_start_patched, meta.game_start));
  if (!ts) return null;

  const side = String(pick(stats.team, '')).toLowerCase();
  const other = side === 'red' ? 'blue' : 'red';
  const roundsWon = num(pick(teams[side], teams[side?.toUpperCase?.()], 0));
  const roundsLost = num(pick(teams[other], teams[other?.toUpperCase?.()], 0));
  const rounds = roundsWon + roundsLost;

  let result = 'draw';
  if (roundsWon > roundsLost) result = 'win';
  else if (roundsWon < roundsLost) result = 'loss';

  const shots = stats.shots ?? {};
  const damage = stats.damage ?? {};
  const id = pick(meta.id, meta.matchid, null);
  const rr = id ? rrByMatch.get(id) : null;

  return {
    id,
    ts,
    map: nameOf(meta.map) ?? 'Desconocido',
    agent: nameOf(stats.character) ?? 'Desconocido',
    mode: pick(meta.mode, meta.mode_id, 'Desconocido'),
    season: pick(meta.season?.short, meta.season_id, null),
    result,
    roundsWon,
    roundsLost,
    rounds,
    kills: num(stats.kills),
    deaths: num(stats.deaths),
    assists: num(stats.assists),
    score: num(stats.score),
    shots: {
      head: num(shots.head),
      body: num(shots.body),
      leg: num(shots.leg),
    },
    damageMade: num(pick(damage.made, damage.dealt, 0)),
    damageReceived: num(pick(damage.received, damage.taken, 0)),
    tier: pick(stats.tier_patched, rr?.tier, null),
    rrChange: rr ? rr.change : null,
    elo: rr ? rr.elo : null,
    isSelf: puuid ? stats.puuid === puuid : true,
  };
}
