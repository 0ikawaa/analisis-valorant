# valorant-analyzer

Baja tu historial de partidas de VALORANT, lo analiza y genera un **dashboard HTML local**
con winrate por mapa y agente, evolución del rango, tendencia de rendimiento y conclusiones
automáticas sobre cuándo conviene dejar de jugar.

Sin dependencias: sólo Node 18 o superior. El informe es un único archivo HTML autocontenido
(no pide nada a internet cuando lo abrís).

---

## Puesta en marcha

### 1. Conseguir la API key

Los datos salen de la [API no oficial de HenrikDev](https://docs.henrikdev.xyz/), que es la
única vía práctica para leer tu historial: la API oficial de Riot restringe los endpoints de
VALORANT a aplicaciones aprobadas.

1. Entrá a **https://api.henrikdev.xyz/dashboard/** y generá una key gratuita.
2. Va a quedar con el formato `HDEV-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

El plan básico permite **30 peticiones por minuto**; el programa se autolimita para
respetarlo y cachea todo lo que baja.

### 2. Configurar

```bash
cd valorant-analyzer
cp .env.example .env      # en PowerShell: Copy-Item .env.example .env
```

Editá el `.env`:

```
VALORANT_API_KEY=HDEV-tu-key-real
VALORANT_PLAYER=Nombre#TAG
```

El Riot ID es el que aparece arriba a la derecha en el cliente del juego: nombre, almohadilla
y tag (por ejemplo `Marke#LAS`). Distingue mayúsculas.

### 3. Correrlo

```bash
node index.js --open
```

Baja las partidas, imprime un resumen en la consola y abre `out/reporte.html` en el navegador.

---

## Uso

```
node index.js --player "Nombre#TAG" [opciones]

  --player, -p   Riot ID completo (Nombre#TAG)
  --key, -k      API key de HenrikDev
  --region, -r   ap | br | eu | kr | latam | na   (por defecto se detecta sola)
  --mode, -m     competitive (por defecto) | unrated | swiftplay | deathmatch | all
  --matches, -n  máximo de partidas a bajar (por defecto 100)
  --out, -o      ruta del HTML de salida (por defecto out/reporte.html)
  --refresh      ignora la caché y vuelve a pedir todo
  --open         abre el informe al terminar
  --demo         informe de ejemplo, sin API ni key
```

Ejemplos:

```bash
node index.js --demo --open                       # ver cómo queda, sin key
node index.js -n 200 --open                       # bajar hasta 200 partidas
node index.js -m all --out out/todo.html          # todos los modos de juego
node index.js --refresh                           # forzar redescarga
```

---

## Qué te muestra el informe

**Arriba (tarjetas):** winrate, K/D, KDA, ACS, porcentaje de headshots, ADR y RR neto del período.

**Qué dicen tus partidas** — hallazgos automáticos, no datos sueltos. Detecta tu mejor y peor
mapa, el agente que te baja el promedio, si tu rendimiento cae con las horas de sesión, si se
te nota el tilt después de una derrota y si fragueás bien pero no ganás. Descarta cualquier
diferencia que no tenga partidas suficientes detrás.

**Evolución del rango** — tu elo partida a partida, con detalle al pasar el mouse.

**RR ganado y perdido por partida** — de un vistazo se ve si estás subiendo o girando en falso.

**Winrate móvil** — la tendencia real, filtrando el ruido de las últimas dos o tres partidas.

**Winrate por mapa y por agente** — ordenados de mejor a peor, con tabla completa desplegable
(partidas, victorias, derrotas, K/D, ACS, HS %, RR).

**¿Cuándo conviene parar?** — winrate según la posición de la partida dentro de la sesión.
Una sesión es una tanda sin más de 2 h de corte. Es el gráfico más útil del informe si te pasa
que empezás ganando y terminás devolviendo el RR.

**Winrate por hora del día** — hora local, con las 24 horas en el eje.

**Todas las partidas** — la tabla cruda del conjunto filtrado.

Arriba de todo hay una fila de filtros (rango, mapa, agente) que recalcula el informe entero.

---

## Cómo está armado

```
index.js          CLI: argumentos, .env, resumen de consola
src/api.js        cliente HTTP: auth, rate limit de 30 req/min, reintentos, caché en disco
src/collect.js    descarga y normaliza los datos crudos de la API
src/stats.js      estadística pura (corre igual en Node y en el navegador)
src/report.js     arma el HTML inyectando CSS, stats.js y client.js
src/client.js     filtros, gráficos SVG y tablas del dashboard
src/report.css    paleta y estilos, con modo claro y oscuro
src/demo.js       datos sintéticos para el modo --demo
data/cache/       respuestas crudas de la API (se puede borrar sin problema)
out/              informes generados
```

`src/stats.js` se ejecuta en los dos lados: Node lo importa como módulo y `report.js` lo
inyecta dentro del HTML quitándole los `export`. Así los filtros del navegador recalculan con
exactamente la misma lógica que el resumen de consola, sin código duplicado.

---

## Detalles que conviene saber

**Caché.** Todo lo que baja queda en `data/cache/` durante 6 horas. Volver a generar el informe
no gasta peticiones. Con `--refresh` se ignora.

**Cuántas partidas hay.** La API guarda un historial limitado por jugador; si pedís 200 y te
devuelve 40, ése es todo el historial almacenado, no un error del programa.

**El RR.** El cambio de RR por partida sale del endpoint de historial de MMR y se cruza con las
partidas por su ID. Si jugaste modos no competitivos, esas partidas no van a tener RR y las
columnas correspondientes muestran `—`.

**Tamaños de muestra.** El winrate de un mapa con 3 partidas es ruido. Los gráficos siempre
muestran la cantidad de partidas en el tooltip y en la tabla, y las conclusiones automáticas
descartan los grupos chicos.

**Zona horaria.** Los gráficos por hora y las sesiones usan la hora local de tu máquina.

---

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `API key rechazada (401/403)` | La key está mal copiada o venció. Regenerala en el dashboard de HenrikDev. |
| `No encontrado (404)` | Riot ID mal escrito. El tag va sin `#` y el nombre distingue mayúsculas. |
| `La API no devolvió partidas` | El historial almacenado está vacío. Probá `--mode all`; si seguís sin nada, jugá una partida para que el perfil quede registrado. |
| `Rate limit` | Estás pidiendo demasiado seguido. El programa reintenta solo; si insiste, esperá un minuto. |

---

Este proyecto no está afiliado ni respaldado por Riot Games. Usa una API comunitaria no oficial,
así que puede romperse si esa API cambia.
