// Cliente HTTP para la API no oficial de HenrikDev.
//
// Se ocupa de tres cosas que la API exige y que es fácil olvidar:
//   1. Autenticación: header `Authorization: HDEV-...` (la key va cruda, sin "Bearer").
//   2. Rate limit: 30 req/min con key básica. Serializamos y espaciamos las llamadas.
//   3. Caché en disco: reanalizar no debería volver a bajar lo mismo.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://api.henrikdev.xyz';

export class HenrikError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = 'HenrikError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HenrikClient {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey       key HDEV-...
   * @param {string} opts.cacheDir     carpeta donde guardar las respuestas crudas
   * @param {number} [opts.perMinute]  presupuesto de requests por minuto (30 = key básica)
   * @param {number} [opts.ttlMs]      antigüedad máxima de la caché
   * @param {boolean} [opts.refresh]   si es true ignora la caché y vuelve a pedir todo
   * @param {(msg: string) => void} [opts.log]
   */
  constructor({ apiKey, cacheDir, perMinute = 30, ttlMs = 6 * 60 * 60 * 1000, refresh = false, log = () => {} }) {
    if (!apiKey) throw new HenrikError('Falta la API key de HenrikDev.');
    this.apiKey = apiKey.trim();
    this.cacheDir = cacheDir;
    // Un pelín de margen sobre el intervalo teórico para no rozar el límite.
    this.minIntervalMs = Math.ceil(60000 / perMinute) + 100;
    this.ttlMs = ttlMs;
    this.refresh = refresh;
    this.log = log;
    this.requests = 0;
    this.cacheHits = 0;
    this._lastRequestAt = 0;
    this._queue = Promise.resolve();
  }

  _cachePath(url) {
    const hash = createHash('sha1').update(url).digest('hex').slice(0, 20);
    return join(this.cacheDir, `${hash}.json`);
  }

  async _readCache(url) {
    if (this.refresh) return null;
    try {
      const raw = await readFile(this._cachePath(url), 'utf8');
      const entry = JSON.parse(raw);
      if (Date.now() - entry.fetchedAt > this.ttlMs) return null;
      return entry.body;
    } catch {
      return null;
    }
  }

  async _writeCache(url, body) {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(this._cachePath(url), JSON.stringify({ url, fetchedAt: Date.now(), body }), 'utf8');
    } catch {
      // La caché es un lujo, no un requisito: si falla, seguimos.
    }
  }

  /** Espacia las llamadas para respetar el rate limit, una atrás de la otra. */
  _schedule(task) {
    const run = this._queue.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this._lastRequestAt);
      if (wait > 0) await sleep(wait);
      this._lastRequestAt = Date.now();
      return task();
    });
    // La cola no debe romperse si una tarea falla.
    this._queue = run.then(() => {}, () => {});
    return run;
  }

  /**
   * GET a la API. Devuelve el cuerpo JSON ya parseado.
   * @param {string} path   por ejemplo `/valorant/v1/stored-matches/eu/Nombre/TAG`
   * @param {Record<string, string|number|undefined>} [params]
   */
  async get(path, params = {}, { ttlMs } = {}) {
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    const href = url.href;

    const cached = await this._readCache(href);
    if (cached) {
      this.cacheHits++;
      return cached;
    }

    const body = await this._schedule(() => this._request(href));
    await this._writeCache(href, body);
    return body;
  }

  async _request(href, attempt = 0) {
    this.requests++;
    let res;
    try {
      res = await fetch(href, {
        headers: { Authorization: this.apiKey, Accept: 'application/json' },
      });
    } catch (err) {
      if (attempt < 3) {
        await sleep(1000 * (attempt + 1));
        return this._request(href, attempt + 1);
      }
      throw new HenrikError(`No se pudo conectar con la API: ${err.message}`, { url: href });
    }

    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 20;
      if (attempt < 4) {
        this.log(`  rate limit alcanzado, esperando ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        return this._request(href, attempt + 1);
      }
      throw new HenrikError('Rate limit: demasiadas peticiones seguidas.', { status: 429, body, url: href });
    }

    if (res.status >= 500 && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      return this._request(href, attempt + 1);
    }

    if (!res.ok) {
      throw new HenrikError(describeError(res.status, body), { status: res.status, body, url: href });
    }

    return body;
  }
}

function describeError(status, body) {
  const detail = body?.errors?.[0]?.message || body?.message || body?.error || '';
  switch (status) {
    case 400:
      return `Petición inválida (400). ${detail || 'Revisá región, modo o parámetros.'}`;
    case 401:
    case 403:
      return `API key rechazada (${status}). Verificá VALORANT_API_KEY en el .env. ${detail}`;
    case 404:
      return `No encontrado (404). ${detail || 'Revisá que el Riot ID (Nombre#TAG) esté bien escrito y que el perfil no sea privado.'}`;
    default:
      return `La API respondió ${status}. ${detail}`;
  }
}
