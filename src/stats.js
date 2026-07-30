// Estadística pura sobre una lista de partidas ya normalizadas.
//
// IMPORTANTE: este archivo se ejecuta en dos lugares distintos, y por eso no
// usa ninguna API de Node ni ningún import:
//   1. En Node, importado por index.js para el resumen de consola.
//   2. En el navegador, inyectado tal cual dentro del HTML del dashboard, para
//      que los filtros recalculen todo con exactamente la misma lógica.
// El bloque `export` del final lo quita report.js al inyectarlo.

const HOUR = 60 * 60 * 1000;
const SESSION_GAP_MS = 2 * HOUR; // más de 2h sin jugar = sesión nueva

function sum(list, fn) {
  let total = 0;
  for (const item of list) total += fn(item) || 0;
  return total;
}

function pct(a, b) {
  return b > 0 ? (a / b) * 100 : 0;
}

function ratio(a, b) {
  return b > 0 ? a / b : a;
}

/** Totales y promedios de un conjunto de partidas. */
function aggregate(list) {
  const wins = list.filter((m) => m.result === 'win').length;
  const losses = list.filter((m) => m.result === 'loss').length;
  const kills = sum(list, (m) => m.kills);
  const deaths = sum(list, (m) => m.deaths);
  const assists = sum(list, (m) => m.assists);
  const rounds = sum(list, (m) => m.rounds);
  const score = sum(list, (m) => m.score);
  const head = sum(list, (m) => m.shots.head);
  const body = sum(list, (m) => m.shots.body);
  const leg = sum(list, (m) => m.shots.leg);
  const made = sum(list, (m) => m.damageMade);
  const received = sum(list, (m) => m.damageReceived);
  const rrMatches = list.filter((m) => typeof m.rrChange === 'number');
  const rr = sum(rrMatches, (m) => m.rrChange);

  return {
    matches: list.length,
    wins,
    losses,
    draws: list.length - wins - losses,
    winrate: pct(wins, wins + losses),
    kills,
    deaths,
    assists,
    rounds,
    kd: ratio(kills, deaths),
    kda: ratio(kills + assists, deaths),
    kpr: ratio(kills, rounds),
    dpr: ratio(deaths, rounds),
    acs: ratio(score, rounds),
    adr: ratio(made, rounds),
    ddPerRound: rounds > 0 ? (made - received) / rounds : 0,
    hs: pct(head, head + body + leg),
    roundWinrate: pct(sum(list, (m) => m.roundsWon), rounds),
    rr,
    rrMatches: rrMatches.length,
    rrPerMatch: rrMatches.length > 0 ? rr / rrMatches.length : 0,
  };
}

/** Agrupa por una clave y agrega cada grupo. Devuelve [{key, items, ...totales}]. */
function groupBy(list, keyFn) {
  const groups = new Map();
  for (const m of list) {
    const key = keyFn(m);
    if (key === null || key === undefined) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const out = [];
  for (const [key, items] of groups) out.push(Object.assign({ key, items }, aggregate(items)));
  return out;
}

/** Winrate móvil: promedio de las últimas `window` partidas, punto a punto. */
function rollingWinrate(list, window) {
  const points = [];
  for (let i = 0; i < list.length; i++) {
    const from = Math.max(0, i - window + 1);
    const slice = list.slice(from, i + 1);
    const wins = slice.filter((m) => m.result === 'win').length;
    const losses = slice.filter((m) => m.result === 'loss').length;
    if (wins + losses === 0) continue;
    points.push({
      i,
      ts: list[i].ts,
      value: pct(wins, wins + losses),
      n: slice.length,
      match: list[i],
    });
  }
  return points;
}

/** Media móvil genérica sobre un valor por partida (K/D, ACS, etc.). */
function rollingAverage(list, window, valueFn) {
  const points = [];
  for (let i = 0; i < list.length; i++) {
    const from = Math.max(0, i - window + 1);
    const slice = list.slice(from, i + 1);
    points.push({
      i,
      ts: list[i].ts,
      value: sum(slice, valueFn) / slice.length,
      n: slice.length,
      match: list[i],
    });
  }
  return points;
}

/** Parte el historial en sesiones de juego (cortes de más de 2h sin jugar). */
function sessions(list, gapMs) {
  const gap = gapMs || SESSION_GAP_MS;
  const out = [];
  let current = [];
  for (const m of list) {
    if (current.length > 0 && m.ts - current[current.length - 1].ts > gap) {
      out.push(current);
      current = [];
    }
    current.push(m);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Rendimiento según la posición de la partida dentro de la sesión.
 * Responde a "¿a partir de qué partida empiezo a jugar peor?".
 */
function bySessionPosition(list, maxBuckets) {
  const cap = maxBuckets || 5;
  const buckets = new Map();
  for (const session of sessions(list)) {
    session.forEach((m, idx) => {
      const key = idx + 1 >= cap ? cap : idx + 1;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(m);
    });
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((key) => {
      const items = buckets.get(key);
      return Object.assign(
        { key, label: key >= cap ? `${cap}ª o más` : `${key}ª`, items },
        aggregate(items)
      );
    });
}

/** Rachas de victorias y derrotas. */
function streaks(list) {
  let bestWin = 0;
  let bestLoss = 0;
  let runWin = 0;
  let runLoss = 0;
  for (const m of list) {
    if (m.result === 'win') {
      runWin++;
      runLoss = 0;
    } else if (m.result === 'loss') {
      runLoss++;
      runWin = 0;
    } else {
      runWin = 0;
      runLoss = 0;
    }
    if (runWin > bestWin) bestWin = runWin;
    if (runLoss > bestLoss) bestLoss = runLoss;
  }
  const current = runWin > 0 ? { type: 'win', length: runWin } : runLoss > 0 ? { type: 'loss', length: runLoss } : { type: 'none', length: 0 };
  return { bestWin, bestLoss, current };
}

/** Winrate de la partida siguiente según cómo terminó la anterior (efecto tilt). */
function afterResult(list) {
  const after = { win: [], loss: [] };
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    if (prev.result === 'win') after.win.push(list[i]);
    else if (prev.result === 'loss') after.loss.push(list[i]);
  }
  return {
    afterWin: Object.assign({ items: after.win }, aggregate(after.win)),
    afterLoss: Object.assign({ items: after.loss }, aggregate(after.loss)),
  };
}

/** Análisis completo listo para pintar. */
function analyze(list) {
  const sorted = list.slice().sort((a, b) => a.ts - b.ts);
  const overall = aggregate(sorted);
  const byMap = groupBy(sorted, (m) => m.map).sort((a, b) => b.winrate - a.winrate || b.matches - a.matches);
  const byAgent = groupBy(sorted, (m) => m.agent).sort((a, b) => b.winrate - a.winrate || b.matches - a.matches);
  const byHour = groupBy(sorted, (m) => new Date(m.ts).getHours()).sort((a, b) => a.key - b.key);
  const byWeekday = groupBy(sorted, (m) => new Date(m.ts).getDay()).sort((a, b) => a.key - b.key);

  return {
    matches: sorted,
    overall,
    byMap,
    byAgent,
    byHour,
    byWeekday,
    bySessionPosition: bySessionPosition(sorted),
    sessions: sessions(sorted),
    streaks: streaks(sorted),
    tilt: afterResult(sorted),
    rollingWinrate: rollingWinrate(sorted, Math.min(10, Math.max(3, Math.floor(sorted.length / 4)))),
    rollingKd: rollingAverage(sorted, Math.min(10, Math.max(3, Math.floor(sorted.length / 4))), (m) =>
      ratio(m.kills, m.deaths)
    ),
  };
}

/**
 * Conclusiones en texto. Cada una es un hallazgo accionable, no un dato suelto.
 * `tone` es 'good' | 'bad' | 'neutral' y siempre va acompañado de texto,
 * nunca el color solo.
 */
function buildInsights(a, minSample) {
  const min = minSample || 4;
  const out = [];
  const o = a.overall;
  const pp = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(0)} pp`;

  const eligibleMaps = a.byMap.filter((g) => g.matches >= min);
  if (eligibleMaps.length >= 2) {
    const best = eligibleMaps[0];
    const worst = eligibleMaps[eligibleMaps.length - 1];
    if (best.winrate - o.winrate >= 8) {
      out.push({
        tone: 'good',
        title: `${best.key} es tu mejor mapa`,
        text: `${best.winrate.toFixed(0)} % de victorias en ${best.matches} partidas, ${pp(best.winrate - o.winrate)} sobre tu media. Si podés elegir cola, es donde más rendís.`,
      });
    }
    if (o.winrate - worst.winrate >= 8) {
      out.push({
        tone: 'bad',
        title: `${worst.key} te está costando`,
        text: `${worst.winrate.toFixed(0)} % en ${worst.matches} partidas, ${pp(worst.winrate - o.winrate)} respecto a tu media. Vale la pena repasar ejecuciones y posiciones de ese mapa.`,
      });
    }
  }

  const eligibleAgents = a.byAgent.filter((g) => g.matches >= min);
  if (eligibleAgents.length >= 2) {
    const best = eligibleAgents[0];
    const worst = eligibleAgents[eligibleAgents.length - 1];
    if (best.winrate - o.winrate >= 8) {
      out.push({
        tone: 'good',
        title: `Rendís más con ${best.key}`,
        text: `${best.winrate.toFixed(0)} % de victorias y ${best.kd.toFixed(2)} de K/D en ${best.matches} partidas.`,
      });
    }
    if (o.winrate - worst.winrate >= 8 && worst.key !== best.key) {
      out.push({
        tone: 'bad',
        title: `${worst.key} baja tu promedio`,
        text: `${worst.winrate.toFixed(0)} % en ${worst.matches} partidas con ${worst.kd.toFixed(2)} de K/D. O le dedicás tiempo en no competitivo, o lo sacás de la rotación.`,
      });
    }
  }

  const positions = a.bySessionPosition.filter((p) => p.matches >= min);
  if (positions.length >= 3) {
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (first.winrate - last.winrate >= 10) {
      out.push({
        tone: 'bad',
        title: 'Tu rendimiento cae con las horas',
        text: `Ganás el ${first.winrate.toFixed(0)} % de las primeras partidas de cada sesión y el ${last.winrate.toFixed(0)} % de la ${last.label.toLowerCase()}. Cortar antes te ahorraría RR.`,
      });
    } else if (last.winrate - first.winrate >= 10) {
      out.push({
        tone: 'neutral',
        title: 'Necesitás calentar',
        text: `Tus primeras partidas rinden ${first.winrate.toFixed(0)} % y las de más adelante ${last.winrate.toFixed(0)} %. Un rato de tiro o deathmatch antes de encolar debería cerrar esa brecha.`,
      });
    }
  }

  const afterLoss = a.tilt.afterLoss;
  const afterWin = a.tilt.afterWin;
  if (afterLoss.matches >= min && afterWin.matches >= min && afterWin.winrate - afterLoss.winrate >= 10) {
    out.push({
      tone: 'bad',
      title: 'Se te nota el tilt',
      text: `Después de perder ganás el ${afterLoss.winrate.toFixed(0)} % de las partidas; después de ganar, el ${afterWin.winrate.toFixed(0)} %. Una pausa corta tras una derrota es la corrección más barata de esta lista.`,
    });
  }

  const hours = a.byHour.filter((g) => g.matches >= min).sort((x, y) => y.winrate - x.winrate);
  if (hours.length >= 3 && hours[0].winrate - hours[hours.length - 1].winrate >= 15) {
    out.push({
      tone: 'neutral',
      title: `Tu mejor franja horaria son las ${hours[0].key}:00`,
      text: `${hours[0].winrate.toFixed(0)} % de victorias ahí, contra ${hours[hours.length - 1].winrate.toFixed(0)} % a las ${hours[hours.length - 1].key}:00.`,
    });
  }

  if (o.kd >= 1.05 && o.winrate < 48) {
    out.push({
      tone: 'neutral',
      title: 'Fragueás bien pero no se traduce en victorias',
      text: `K/D de ${o.kd.toFixed(2)} con ${o.winrate.toFixed(0)} % de winrate. Suele indicar bajas en rondas que no importan: mirá tu impacto en la primera muerte, el uso de utilidad y los retakes.`,
    });
  }

  if (o.hs >= 25) {
    out.push({
      tone: 'good',
      title: 'Puntería a la cabeza por encima de la media',
      text: `${o.hs.toFixed(1)} % de disparos a la cabeza (el promedio ronda el 20–22 %).`,
    });
  } else if (o.hs > 0 && o.hs < 17) {
    out.push({
      tone: 'bad',
      title: 'Mucha bala al cuerpo',
      text: `${o.hs.toFixed(1)} % de headshots. Trabajar la altura de la mira y el control de la primera ráfaga es la ganancia más directa.`,
    });
  }

  if (o.rrMatches >= min) {
    out.push({
      tone: o.rr >= 0 ? 'good' : 'bad',
      title: `${o.rr >= 0 ? 'Ganaste' : 'Perdiste'} ${Math.abs(o.rr)} RR en el período`,
      text: `${o.rrPerMatch >= 0 ? '+' : ''}${o.rrPerMatch.toFixed(1)} RR por partida en ${o.rrMatches} partidas con dato de RR.`,
    });
  }

  return out;
}

export {
  aggregate,
  groupBy,
  rollingWinrate,
  rollingAverage,
  sessions,
  bySessionPosition,
  streaks,
  afterResult,
  analyze,
  buildInsights,
  pct,
  ratio,
  sum,
};
