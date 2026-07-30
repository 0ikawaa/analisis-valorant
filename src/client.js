// Código que corre en el navegador: filtros, gráficos SVG y tablas.
// Las funciones de stats.js ya están declaradas arriba, en este mismo <script>,
// así que los filtros recalculan con exactamente la misma lógica que la consola.

(function () {
  'use strict';

  var DATA = window.__VAL_DATA__;
  var ALL = DATA.matches;

  // ---------- Formato ----------

  var nf0 = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function fpct(v) {
    return nf0.format(v) + ' %';
  }
  function fpct1(v) {
    return nf1.format(v) + ' %';
  }
  function fnum(v) {
    return nf0.format(v);
  }
  function fsigned(v, dec) {
    var f = dec === 1 ? nf1 : nf0;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + f.format(Math.abs(v));
  }
  function fdate(ts) {
    return new Date(ts).toLocaleDateString('es-UY', { day: '2-digit', month: 'short' });
  }
  function fdatetime(ts) {
    return new Date(ts).toLocaleString('es-UY', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- Tooltip compartido ----------

  var tip = document.getElementById('tooltip');

  function tipHtml(title, rows) {
    var html = '<div class="tt-title">' + esc(title) + '</div>';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="tt-row"><span>' + esc(rows[i][0]) + '</span><b>' + esc(rows[i][1]) + '</b></div>';
    }
    return html;
  }

  function moveTip(x, y) {
    var pad = 14;
    var r = tip.getBoundingClientRect();
    var left = x + pad;
    var top = y + pad;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add('on');
    moveTip(x, y);
  }

  function hideTip() {
    tip.classList.remove('on');
  }

  /** Hover + foco de teclado sobre un nodo SVG. El tooltip nunca es la única vía:
      cada gráfico tiene además etiquetas visibles y su tabla gemela. */
  function hoverable(node, htmlFn, markNode) {
    node.addEventListener('mouseenter', function (e) {
      if (markNode) markNode.classList.add('hover');
      showTip(htmlFn(), e.clientX, e.clientY);
    });
    node.addEventListener('mousemove', function (e) {
      moveTip(e.clientX, e.clientY);
    });
    node.addEventListener('mouseleave', function () {
      if (markNode) markNode.classList.remove('hover');
      hideTip();
    });
    node.setAttribute('tabindex', '0');
    node.addEventListener('focus', function () {
      var r = node.getBoundingClientRect();
      if (markNode) markNode.classList.add('hover');
      showTip(htmlFn(), r.left + r.width / 2, r.top);
    });
    node.addEventListener('blur', function () {
      if (markNode) markNode.classList.remove('hover');
      hideTip();
    });
  }

  // ---------- Utilidades SVG ----------

  var NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs) {
    var node = document.createElementNS(NS, tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function text(x, y, str, cls, anchor) {
    var t = el('text', { x: x, y: y, class: cls, 'text-anchor': anchor || 'start' });
    t.textContent = str;
    return t;
  }

  /** Barra con sólo el extremo del dato redondeado, anclada a la línea base. */
  function barPathH(x, y, w, h, r) {
    r = Math.min(r, Math.max(0, w), h / 2);
    if (w <= 0.5) return 'M' + x + ',' + y + ' h0.5 v' + h + ' h-0.5 Z';
    return (
      'M' + x + ',' + y +
      ' H' + (x + w - r) +
      ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
      ' V' + (y + h - r) +
      ' Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) +
      ' H' + x + ' Z'
    );
  }

  function barPathV(x, y, w, h, r, up) {
    r = Math.min(r, w / 2, Math.max(0, h));
    if (h <= 0.5) return 'M' + x + ',' + y + ' h' + w + ' v0.5 h-' + w + ' Z';
    if (up) {
      return (
        'M' + x + ',' + (y + h) +
        ' V' + (y + r) +
        ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
        ' H' + (x + w - r) +
        ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
        ' V' + (y + h) + ' Z'
      );
    }
    return (
      'M' + x + ',' + y +
      ' V' + (y + h - r) +
      ' Q' + x + ',' + (y + h) + ' ' + (x + r) + ',' + (y + h) +
      ' H' + (x + w - r) +
      ' Q' + (x + w) + ',' + (y + h) + ' ' + (x + w) + ',' + (y + h - r) +
      ' V' + y + ' Z'
    );
  }

  function niceTicks(min, max, count) {
    if (min === max) {
      min -= 1;
      max += 1;
    }
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = (span / count) / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var start = Math.ceil(min / step) * step;
    var ticks = [];
    for (var v = start; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  function widthOf(mount) {
    var w = mount.clientWidth;
    return w > 40 ? w : 560;
  }

  function empty(mount, msg) {
    mount.innerHTML = '<div class="empty">' + esc(msg) + '</div>';
  }

  // ---------- Gráfico de barras horizontales ----------
  // Una sola serie -> un solo color. Sin leyenda (el título nombra la serie).

  function hBarChart(mount, opts) {
    mount.innerHTML = '';
    var rows = opts.rows;
    if (!rows.length) return empty(mount, 'Sin datos para este filtro.');

    var W = widthOf(mount);
    var labelW = Math.min(120, Math.max(72, W * 0.22));
    var valueW = 62;
    var rowH = 28;
    var barH = 13;
    var padR = 8;
    var H = rows.length * rowH + 22;
    var x0 = labelW + 10;
    var plotW = Math.max(60, W - x0 - valueW - padR);
    var max = opts.max || Math.max.apply(null, rows.map(function (r) { return r.value; }));
    if (max <= 0) max = 1;

    var s = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

    // Rejilla vertical de referencia (hairlines sólidas, un tono sobre la superficie)
    var ticks = niceTicks(0, max, 4);
    for (var t = 0; t < ticks.length; t++) {
      var tx = x0 + (ticks[t] / max) * plotW;
      s.appendChild(el('line', { x1: tx, y1: 8, x2: tx, y2: H - 16, class: 'gridline' }));
      s.appendChild(text(tx, H - 4, opts.tickFmt ? opts.tickFmt(ticks[t]) : fnum(ticks[t]), 'tick', 'middle'));
    }
    s.appendChild(el('line', { x1: x0, y1: 8, x2: x0, y2: H - 16, class: 'axisline' }));

    // Línea de referencia (por ejemplo el 50 % de winrate)
    if (opts.ref && opts.ref.value <= max) {
      var rx = x0 + (opts.ref.value / max) * plotW;
      s.appendChild(el('line', { x1: rx, y1: 4, x2: rx, y2: H - 16, class: 'refline' }));
      s.appendChild(text(rx + 4, 12, opts.ref.label, 'tick', 'start'));
    }

    rows.forEach(function (r, i) {
      var y = 16 + i * rowH;
      var w = (r.value / max) * plotW;

      s.appendChild(text(labelW, y + barH - 2, r.label, 'cat-label', 'end'));

      var mark = el('path', { d: barPathH(x0, y, w, barH, 4), style: 'fill:var(--series-1)' });
      mark.setAttribute('class', 'mark');
      s.appendChild(mark);

      // Etiqueta directa del valor: fuera de la barra, nunca recortada dentro.
      s.appendChild(text(x0 + plotW + 6, y + barH - 2, opts.valueFmt(r.value), 'val-label', 'start'));

      // Área sensible más alta que la marca (mínimo cómodo de puntería)
      var hit = el('rect', { x: 0, y: y - (rowH - barH) / 2, width: W, height: rowH, class: 'hit' });
      hoverable(hit, function () { return tipHtml(r.label, r.rows); }, mark);
      s.appendChild(hit);
    });

    mount.appendChild(s);
  }

  // ---------- Gráfico de barras verticales (admite valores negativos) ----------

  function vBarChart(mount, opts) {
    mount.innerHTML = '';
    var rows = opts.rows;
    if (!rows.length) return empty(mount, 'Sin datos para este filtro.');

    var W = widthOf(mount);
    var H = opts.height || 210;
    var padL = 40, padT = 12, padB = 30;
    // La etiqueta de la línea de referencia vive fuera del área de trazado,
    // así nunca se superpone con las barras.
    var padR = opts.ref ? Math.max(58, opts.ref.label.length * 6.4 + 14) : 10;
    var plotW = Math.max(60, W - padL - padR);
    var plotH = H - padT - padB;

    var values = rows.map(function (r) { return r.value; });
    var maxV = Math.max.apply(null, values);
    var minV = Math.min.apply(null, values);
    var top = opts.max !== undefined ? opts.max : Math.max(maxV, 0);
    var bottom = opts.min !== undefined ? opts.min : Math.min(minV, 0);
    if (top === bottom) top = bottom + 1;
    var pad = (top - bottom) * 0.08;
    top += pad;
    if (bottom < 0) bottom -= pad;

    var yOf = function (v) { return padT + plotH - ((v - bottom) / (top - bottom)) * plotH; };
    var slot = plotW / rows.length;
    var barW = Math.max(3, Math.min(opts.maxBarWidth || 46, slot - (rows.length > 40 ? 1 : 8)));

    var s = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

    var ticks = niceTicks(bottom, top, 4);
    ticks.forEach(function (v) {
      var y = yOf(v);
      s.appendChild(el('line', { x1: padL, y1: y, x2: padL + plotW, y2: y, class: 'gridline' }));
      s.appendChild(text(padL - 8, y + 4, opts.tickFmt ? opts.tickFmt(v) : fnum(v), 'tick', 'end'));
    });

    var zeroY = yOf(bottom < 0 ? 0 : bottom);
    s.appendChild(el('line', { x1: padL, y1: zeroY, x2: padL + plotW, y2: zeroY, class: 'axisline' }));

    if (opts.ref !== undefined && opts.ref !== null) {
      var ry = yOf(opts.ref.value);
      s.appendChild(el('line', { x1: padL, y1: ry, x2: padL + plotW, y2: ry, class: 'refline' }));
      s.appendChild(text(padL + plotW + 6, ry + 4, opts.ref.label, 'tick', 'start'));
    }

    // Etiquetamos tantas categorías como entren sin pisarse, según el ancho real.
    var widest = Math.max.apply(null, rows.map(function (r) { return (r.label || '').length; })) * 6.4 + 10;
    var labelEvery = Math.max(1, Math.ceil(widest / slot));

    rows.forEach(function (r, i) {
      var cx = padL + slot * i + slot / 2;
      var x = cx - barW / 2;
      var yv = yOf(r.value);
      var up = r.value >= 0;
      var h = Math.abs(yv - zeroY);
      var mark = null;
      // `skip` = categoría sin datos. Se deja el hueco y la etiqueta, pero no
      // se dibuja una barra en cero, que se leería como "0 %".
      if (!r.skip) {
        mark = el('path', {
          d: barPathV(x, up ? yv : zeroY, barW, h, 4, up),
          style: 'fill:' + (r.color || 'var(--series-1)'),
        });
        mark.setAttribute('class', 'mark');
        s.appendChild(mark);
      }

      if (opts.showLabels !== false && r.label && i % labelEvery === 0) {
        s.appendChild(text(cx, padT + plotH + 20, r.label, 'tick', 'middle'));
      }

      var hit = el('rect', { x: cx - Math.max(12, slot / 2), y: padT, width: Math.max(24, slot), height: plotH, class: 'hit' });
      hoverable(hit, function () { return tipHtml(r.tipTitle || r.label, r.rows); }, mark);
      s.appendChild(hit);
    });

    mount.appendChild(s);
  }

  // ---------- Gráfico de líneas con crosshair ----------

  function lineChart(mount, opts) {
    mount.innerHTML = '';
    var pts = opts.points;
    if (pts.length < 2) return empty(mount, 'Hacen falta al menos 2 partidas para dibujar la tendencia.');

    var W = widthOf(mount);
    var H = opts.height || 230;
    var padL = 46, padT = 14, padB = 28;
    var padR = opts.ref ? Math.max(58, opts.ref.label.length * 6.4 + 14) : 46;
    var plotW = Math.max(60, W - padL - padR);
    var plotH = H - padT - padB;

    var ys = pts.map(function (p) { return p.y; });
    var minY = opts.yMin !== undefined ? opts.yMin : Math.min.apply(null, ys);
    var maxY = opts.yMax !== undefined ? opts.yMax : Math.max.apply(null, ys);
    if (minY === maxY) { minY -= 1; maxY += 1; }
    var padY = (maxY - minY) * 0.1;
    minY -= padY;
    maxY += padY;
    if (opts.clampZero && minY < 0) minY = 0;

    var xOf = function (i) { return padL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW); };
    var yOf = function (v) { return padT + plotH - ((v - minY) / (maxY - minY)) * plotH; };

    var s = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img' });

    niceTicks(minY, maxY, 4).forEach(function (v) {
      var y = yOf(v);
      s.appendChild(el('line', { x1: padL, y1: y, x2: padL + plotW, y2: y, class: 'gridline' }));
      s.appendChild(text(padL - 8, y + 4, opts.tickFmt ? opts.tickFmt(v) : fnum(v), 'tick', 'end'));
    });
    s.appendChild(el('line', { x1: padL, y1: padT, x2: padL, y2: padT + plotH, class: 'axisline' }));

    if (opts.ref) {
      var ry = yOf(opts.ref.value);
      if (ry > padT && ry < padT + plotH) {
        s.appendChild(el('line', { x1: padL, y1: ry, x2: padL + plotW, y2: ry, class: 'refline' }));
        s.appendChild(text(padL + plotW + 6, ry + 4, opts.ref.label, 'tick', 'start'));
      }
    }

    // Etiquetas del eje x: primera, media y última
    [0, Math.floor((pts.length - 1) / 2), pts.length - 1].forEach(function (i, k, arr) {
      if (k > 0 && arr[k] === arr[k - 1]) return;
      s.appendChild(
        text(xOf(i), padT + plotH + 18, opts.xLabel(pts[i]), 'tick', k === 0 ? 'start' : k === 2 ? 'end' : 'middle')
      );
    });

    var d = '';
    pts.forEach(function (p, i) { d += (i === 0 ? 'M' : ' L') + xOf(i) + ',' + yOf(p.y); });
    s.appendChild(el('path', { d: d, style: 'fill:none;stroke:var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // Etiqueta directa sólo en el extremo, no en cada punto
    var last = pts[pts.length - 1];
    s.appendChild(el('circle', { cx: xOf(pts.length - 1), cy: yOf(last.y), r: 4, style: 'fill:var(--series-1);stroke:var(--surface-1)', 'stroke-width': 2 }));
    s.appendChild(text(xOf(pts.length - 1) - 8, yOf(last.y) - 10, opts.valueFmt(last.y), 'val-label', 'end'));

    // Capa de crosshair: punto más cercano en x
    var cross = el('line', { x1: 0, y1: padT, x2: 0, y2: padT + plotH, class: 'refline', opacity: 0 });
    var dot = el('circle', { r: 4.5, style: 'fill:var(--series-1);stroke:var(--surface-1)', 'stroke-width': 2, opacity: 0 });
    s.appendChild(cross);
    s.appendChild(dot);

    var overlay = el('rect', { x: padL, y: padT, width: plotW, height: plotH, class: 'hit' });
    overlay.addEventListener('mousemove', function (e) {
      var box = s.getBoundingClientRect();
      var rel = e.clientX - box.left - padL;
      var i = Math.round((rel / plotW) * (pts.length - 1));
      i = Math.max(0, Math.min(pts.length - 1, i));
      var p = pts[i];
      cross.setAttribute('x1', xOf(i));
      cross.setAttribute('x2', xOf(i));
      cross.setAttribute('opacity', 1);
      dot.setAttribute('cx', xOf(i));
      dot.setAttribute('cy', yOf(p.y));
      dot.setAttribute('opacity', 1);
      showTip(tipHtml(p.title, p.rows), e.clientX, e.clientY);
    });
    overlay.addEventListener('mouseleave', function () {
      cross.setAttribute('opacity', 0);
      dot.setAttribute('opacity', 0);
      hideTip();
    });
    s.appendChild(overlay);

    mount.appendChild(s);
  }

  // ---------- Tablas gemelas ----------

  function renderTable(mount, cols, rows) {
    var html = '<div class="table-scroll"><table><thead><tr>';
    cols.forEach(function (c) { html += '<th>' + esc(c) + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr>';
      r.forEach(function (cell) { html += '<td>' + esc(cell) + '</td>'; });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    mount.innerHTML = html;
  }

  // ---------- Filtros ----------

  var state = { range: '50', map: 'all', agent: 'all' };

  function fillSelect(sel, values, allLabel) {
    var html = '<option value="all">' + esc(allLabel) + '</option>';
    values.forEach(function (v) { html += '<option value="' + esc(v) + '">' + esc(v) + '</option>'; });
    sel.innerHTML = html;
  }

  function currentMatches() {
    var list = ALL.slice();
    if (state.range !== 'all') {
      var n = parseInt(state.range, 10);
      list = list.slice(Math.max(0, list.length - n));
    }
    if (state.map !== 'all') list = list.filter(function (m) { return m.map === state.map; });
    if (state.agent !== 'all') list = list.filter(function (m) { return m.agent === state.agent; });
    return list;
  }

  // ---------- Render principal ----------

  function tile(k, v, d, tone) {
    return (
      '<div class="tile"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' +
      (d ? '<div class="d' + (tone ? ' ' + tone : '') + '">' + esc(d) + '</div>' : '') +
      '</div>'
    );
  }

  function render() {
    var list = currentMatches();
    document.getElementById('f-count').textContent =
      list.length + (list.length === 1 ? ' partida' : ' partidas') +
      (list.length ? ' · ' + fdate(list[0].ts) + ' → ' + fdate(list[list.length - 1].ts) : '');

    if (!list.length) {
      document.getElementById('tiles').innerHTML = '';
      document.querySelectorAll('.plot').forEach(function (p) { empty(p, 'Ningún resultado con estos filtros.'); });
      document.getElementById('insights').innerHTML = '<p class="empty">Sin datos.</p>';
      return;
    }

    var a = analyze(list);
    var o = a.overall;

    // --- Tiles ---
    document.getElementById('tiles').innerHTML =
      tile('Winrate', fpct(o.winrate), o.wins + 'V · ' + o.losses + 'D' + (o.draws ? ' · ' + o.draws + 'E' : ''),
        o.winrate >= 50 ? 'good' : 'bad') +
      tile('K/D', nf2.format(o.kd), o.kills + ' / ' + o.deaths + ' / ' + o.assists) +
      tile('KDA', nf2.format(o.kda), nf2.format(o.kpr) + ' bajas por ronda') +
      tile('ACS', fnum(o.acs), 'puntuación de combate media') +
      tile('Headshots', fpct1(o.hs), 'de los disparos acertados') +
      tile('ADR', fnum(o.adr), fsigned(o.ddPerRound, 0) + ' de daño neto por ronda',
        o.ddPerRound >= 0 ? 'good' : 'bad') +
      (o.rrMatches
        ? tile('RR', fsigned(o.rr, 0), fsigned(o.rrPerMatch, 1) + ' por partida', o.rr >= 0 ? 'good' : 'bad')
        : tile('Rondas ganadas', fpct(o.roundWinrate), o.rounds + ' rondas jugadas'));

    // --- Evolución del RR ---
    var eloPts = list.filter(function (m) { return typeof m.elo === 'number' && m.elo > 0; });
    var rrCard = document.getElementById('card-rr');
    if (eloPts.length < 2 && DATA.rrSeries.length >= 2) {
      eloPts = DATA.rrSeries.map(function (r) {
        return { ts: r.ts, elo: r.elo, tier: r.tier, map: r.map, rrChange: r.change };
      });
    }
    if (eloPts.length >= 2) {
      rrCard.style.display = '';
      lineChart(document.getElementById('chart-rr'), {
        points: eloPts.map(function (m) {
          return {
            y: m.elo,
            title: fdatetime(m.ts),
            rows: [
              ['Elo', fnum(m.elo)],
              ['Rango', m.tier || '—'],
              ['Mapa', m.map || '—'],
              ['RR de la partida', typeof m.rrChange === 'number' ? fsigned(m.rrChange, 0) : '—'],
            ],
          };
        }),
        xLabel: function (p) { return p.title.split(',')[0]; },
        valueFmt: function (v) { return fnum(v); },
        tickFmt: function (v) { return fnum(v); },
      });
    } else {
      rrCard.style.display = 'none';
    }

    // --- RR por partida (diverging: ganado vs perdido) ---
    var rrMatches = list.filter(function (m) { return typeof m.rrChange === 'number'; });
    var rrCard2 = document.getElementById('card-rr-match');
    if (rrMatches.length >= 3) {
      rrCard2.style.display = '';
      vBarChart(document.getElementById('chart-rr-match'), {
        rows: rrMatches.map(function (m) {
          return {
            value: m.rrChange,
            label: '',
            color: m.rrChange >= 0 ? 'var(--pos)' : 'var(--neg)',
            tipTitle: m.map + ' · ' + fdate(m.ts),
            rows: [
              ['RR', fsigned(m.rrChange, 0)],
              ['Resultado', m.result === 'win' ? 'Victoria' : m.result === 'loss' ? 'Derrota' : 'Empate'],
              ['Marcador', m.roundsWon + ' – ' + m.roundsLost],
              ['Agente', m.agent],
              ['K/D/A', m.kills + '/' + m.deaths + '/' + m.assists],
            ],
          };
        }),
        showLabels: false,
        tickFmt: function (v) { return fsigned(v, 0); },
        height: 190,
        maxBarWidth: 14,
      });
    } else {
      rrCard2.style.display = 'none';
    }

    // --- Winrate móvil ---
    var win = a.rollingWinrate;
    lineChart(document.getElementById('chart-rolling'), {
      points: win.map(function (p) {
        return {
          y: p.value,
          title: fdatetime(p.ts),
          rows: [
            ['Winrate móvil', fpct(p.value)],
            ['Ventana', p.n + ' partidas'],
            ['Esta partida', p.match.result === 'win' ? 'Victoria' : p.match.result === 'loss' ? 'Derrota' : 'Empate'],
            ['Mapa', p.match.map],
          ],
        };
      }),
      xLabel: function (p) { return p.title.split(',')[0]; },
      valueFmt: fpct,
      tickFmt: fpct,
      ref: { value: 50, label: '50 %' },
      clampZero: true,
    });
    document.getElementById('rolling-note').textContent =
      'Media móvil de las últimas ' + (win.length ? win[win.length - 1].n : 0) + ' partidas. La línea fina marca el 50 %.';

    // --- Por mapa ---
    var maps = a.byMap.filter(function (g) { return g.matches >= 1; });
    hBarChart(document.getElementById('chart-map'), {
      rows: maps.map(function (g) {
        return {
          label: g.key,
          value: g.winrate,
          rows: [
            ['Winrate', fpct1(g.winrate)],
            ['Partidas', g.matches + ' (' + g.wins + 'V · ' + g.losses + 'D)'],
            ['K/D', nf2.format(g.kd)],
            ['ACS', fnum(g.acs)],
            ['RR neto', g.rrMatches ? fsigned(g.rr, 0) : '—'],
          ],
        };
      }),
      max: 100,
      valueFmt: fpct,
      tickFmt: fpct,
      ref: { value: 50, label: '50 %' },
    });
    renderTable(
      document.getElementById('table-map'),
      ['Mapa', 'Partidas', 'V', 'D', 'Winrate', 'K/D', 'ACS', 'HS %', 'RR'],
      maps.map(function (g) {
        return [g.key, g.matches, g.wins, g.losses, fpct1(g.winrate), nf2.format(g.kd), fnum(g.acs), fpct1(g.hs), g.rrMatches ? fsigned(g.rr, 0) : '—'];
      })
    );

    // --- Por agente ---
    var agents = a.byAgent;
    hBarChart(document.getElementById('chart-agent'), {
      rows: agents.map(function (g) {
        return {
          label: g.key,
          value: g.winrate,
          rows: [
            ['Winrate', fpct1(g.winrate)],
            ['Partidas', g.matches + ' (' + g.wins + 'V · ' + g.losses + 'D)'],
            ['K/D', nf2.format(g.kd)],
            ['ACS', fnum(g.acs)],
            ['HS', fpct1(g.hs)],
          ],
        };
      }),
      max: 100,
      valueFmt: fpct,
      tickFmt: fpct,
      ref: { value: 50, label: '50 %' },
    });
    renderTable(
      document.getElementById('table-agent'),
      ['Agente', 'Partidas', 'V', 'D', 'Winrate', 'K/D', 'ACS', 'HS %', 'ADR'],
      agents.map(function (g) {
        return [g.key, g.matches, g.wins, g.losses, fpct1(g.winrate), nf2.format(g.kd), fnum(g.acs), fpct1(g.hs), fnum(g.adr)];
      })
    );

    // --- Posición dentro de la sesión ---
    vBarChart(document.getElementById('chart-session'), {
      rows: a.bySessionPosition.map(function (p) {
        return {
          value: p.winrate,
          label: p.label,
          rows: [
            ['Winrate', fpct1(p.winrate)],
            ['Partidas', p.matches + ' (' + p.wins + 'V · ' + p.losses + 'D)'],
            ['K/D', nf2.format(p.kd)],
            ['ACS', fnum(p.acs)],
          ],
        };
      }),
      max: 100,
      min: 0,
      tickFmt: fpct,
      ref: { value: o.winrate, label: 'tu media ' + fpct(o.winrate) },
      height: 200,
    });
    document.getElementById('session-note').textContent =
      'Una sesión es una tanda de partidas sin más de 2 h de corte. ' + a.sessions.length +
      (a.sessions.length === 1 ? ' sesión detectada.' : ' sesiones detectadas.');

    // --- Por hora del día ---
    // Se pintan las 24 horas para que el eje sea un eje de tiempo de verdad;
    // las horas en las que no jugaste quedan como hueco, no como 0 %.
    var byHour = {};
    a.byHour.forEach(function (g) { byHour[g.key] = g; });
    var hourRows = [];
    for (var h24 = 0; h24 < 24; h24++) {
      var g = byHour[h24];
      hourRows.push({
        value: g ? g.winrate : 0,
        skip: !g,
        label: h24 + 'h',
        tipTitle: h24 + ':00 – ' + h24 + ':59',
        rows: g
          ? [
              ['Winrate', fpct1(g.winrate)],
              ['Partidas', g.matches + ' (' + g.wins + 'V · ' + g.losses + 'D)'],
              ['K/D', nf2.format(g.kd)],
            ]
          : [['Partidas', 'ninguna a esta hora']],
      });
    }
    vBarChart(document.getElementById('chart-hour'), {
      rows: hourRows,
      max: 100,
      min: 0,
      tickFmt: fpct,
      ref: { value: o.winrate, label: 'tu media' },
      height: 200,
    });

    // --- Tabla completa ---
    renderTable(
      document.getElementById('table-matches'),
      ['Fecha', 'Mapa', 'Agente', 'Resultado', 'Marcador', 'K', 'D', 'A', 'K/D', 'ACS', 'HS %', 'RR'],
      list.slice().reverse().map(function (m) {
        var rounds = m.rounds || 1;
        var shots = m.shots.head + m.shots.body + m.shots.leg;
        return [
          fdatetime(m.ts),
          m.map,
          m.agent,
          m.result === 'win' ? 'Victoria' : m.result === 'loss' ? 'Derrota' : 'Empate',
          m.roundsWon + ' – ' + m.roundsLost,
          m.kills,
          m.deaths,
          m.assists,
          nf2.format(m.deaths ? m.kills / m.deaths : m.kills),
          fnum(m.score / rounds),
          shots ? fpct1((m.shots.head / shots) * 100) : '—',
          typeof m.rrChange === 'number' ? fsigned(m.rrChange, 0) : '—',
        ];
      })
    );

    // --- Conclusiones ---
    var insights = buildInsights(a, Math.max(3, Math.round(list.length / 12)));
    var icons = { good: '▲', bad: '▼', neutral: '■' };
    document.getElementById('insights').innerHTML = insights.length
      ? insights
          .map(function (ins) {
            return (
              '<div class="insight ' + ins.tone + '"><span class="icon" aria-hidden="true">' + icons[ins.tone] +
              '</span><div><h3>' + esc(ins.title) + '</h3><p>' + esc(ins.text) + '</p></div></div>'
            );
          })
          .join('')
      : '<p class="empty">Con esta cantidad de partidas todavía no hay diferencias lo bastante grandes como para sacar conclusiones firmes.</p>';

    // Racha
    var st = a.streaks;
    document.getElementById('streaks').textContent =
      'Mejor racha: ' + st.bestWin + ' victorias seguidas · Peor racha: ' + st.bestLoss + ' derrotas seguidas' +
      (st.current.length > 1
        ? ' · Ahora mismo llevás ' + st.current.length + (st.current.type === 'win' ? ' victorias' : ' derrotas') + ' al hilo'
        : '');
  }

  // ---------- Arranque ----------

  var mapSel = document.getElementById('f-map');
  var agentSel = document.getElementById('f-agent');
  var rangeSel = document.getElementById('f-range');

  var uniqueMaps = [...new Set(ALL.map(function (m) { return m.map; }))].sort();
  var uniqueAgents = [...new Set(ALL.map(function (m) { return m.agent; }))].sort();
  fillSelect(mapSel, uniqueMaps, 'Todos los mapas');
  fillSelect(agentSel, uniqueAgents, 'Todos los agentes');

  // Si hay menos partidas que el rango por defecto, arrancamos mostrando todo.
  if (ALL.length <= 50) {
    state.range = 'all';
    rangeSel.value = 'all';
  }

  rangeSel.addEventListener('change', function () { state.range = this.value; render(); });
  mapSel.addEventListener('change', function () { state.map = this.value; render(); });
  agentSel.addEventListener('change', function () { state.agent = this.value; render(); });
  document.getElementById('f-reset').addEventListener('click', function () {
    state = { range: ALL.length <= 50 ? 'all' : '50', map: 'all', agent: 'all' };
    rangeSel.value = state.range;
    mapSel.value = 'all';
    agentSel.value = 'all';
    render();
  });

  // Tema: el interruptor manual gana sobre la preferencia del sistema.
  var themeBtn = document.getElementById('theme-toggle');
  themeBtn.addEventListener('click', function () {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.hasAttribute('data-theme') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    render(); // los SVG usan var(--...) en atributos, así que se repintan al redibujar
  });

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });

  render();
})();
