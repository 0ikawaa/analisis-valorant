// Generador de datos sintéticos para probar el dashboard sin API key.
// No pretende ser realista al detalle: sirve para ver el informe funcionando.

const MAPS = ['Ascent', 'Bind', 'Haven', 'Icebox', 'Lotus', 'Split', 'Sunset', 'Abyss'];
const AGENTS = ['Jett', 'Reyna', 'Omen', 'Sova', 'Killjoy', 'Raze', 'Sage'];

// Aleatoriedad reproducible: el informe de demo sale igual en cada ejecución.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoDataset(count = 90) {
  const rnd = mulberry32(20260730);
  const pickIdx = (n) => Math.floor(rnd() * n);

  // Cada mapa y agente tiene su propia habilidad base, para que el análisis
  // encuentre diferencias reales en vez de puro ruido.
  const mapSkill = new Map(MAPS.map((m, i) => [m, 0.38 + ((i * 7) % 10) * 0.03]));
  const agentSkill = new Map(AGENTS.map((a, i) => [a, 0.42 + ((i * 5) % 8) * 0.025]));

  const matches = [];
  let elo = 1180;
  let ts = Date.now() - count * 3.1 * 60 * 60 * 1000;
  let posInSession = 0;

  for (let i = 0; i < count; i++) {
    // Sesiones: 1 a 5 partidas seguidas y después un corte largo.
    if (posInSession === 0) ts += (10 + rnd() * 20) * 60 * 60 * 1000;
    else ts += (35 + rnd() * 20) * 60 * 1000;
    posInSession++;
    const sessionLen = 2 + pickIdx(4);
    const fatigue = Math.min(0.12, (posInSession - 1) * 0.035);
    if (posInSession >= sessionLen) posInSession = 0;

    const map = MAPS[pickIdx(MAPS.length)];
    const agent = AGENTS[pickIdx(AGENTS.length)];
    const p = Math.max(0.15, Math.min(0.85, (mapSkill.get(map) + agentSkill.get(agent)) / 2 + 0.08 - fatigue));
    const win = rnd() < p;

    const myRounds = win ? 13 : pickIdx(13);
    const theirRounds = win ? pickIdx(13) : 13;
    const total = myRounds + theirRounds;

    const perf = 0.85 + rnd() * 0.5 + (win ? 0.12 : -0.05);
    const kills = Math.round(total * 0.72 * perf);
    const deaths = Math.max(3, Math.round(total * 0.68 * (2 - perf)));
    const assists = Math.round(total * 0.25 * (0.6 + rnd()));
    const acs = 150 + perf * 110 + rnd() * 40;
    const hits = kills * 4 + Math.round(rnd() * 40);
    const head = Math.round(hits * (0.17 + rnd() * 0.12));
    const leg = Math.round(hits * 0.05);

    const rrChange = win ? 14 + pickIdx(12) : -(12 + pickIdx(11));
    elo += rrChange;

    matches.push({
      id: `demo-${i}`,
      ts,
      map,
      agent,
      mode: 'Competitive',
      season: 'demo',
      result: win ? 'win' : 'loss',
      roundsWon: myRounds,
      roundsLost: theirRounds,
      rounds: total,
      kills,
      deaths,
      assists,
      score: Math.round(acs * total),
      shots: { head, body: hits - head - leg, leg },
      damageMade: Math.round(total * (110 + perf * 55)),
      damageReceived: Math.round(total * (125 + rnd() * 25)),
      tier: 'Oro 2',
      rrChange,
      elo,
      isSelf: true,
    });
  }

  return {
    player: { name: 'Demo', tag: 'UY', puuid: null, region: 'na', level: 137, card: null },
    rank: { tier: 'Oro 2', rr: elo % 100, elo, peak: 'Platino 1' },
    mode: 'competitive',
    matches,
    rrSeries: matches.map((m) => ({ ts: m.ts, elo: m.elo, rr: m.elo % 100, change: m.rrChange, tier: m.tier, map: m.map })),
  };
}
