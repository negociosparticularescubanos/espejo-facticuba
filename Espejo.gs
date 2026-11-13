// FactiCuba · Espejo de tasas y mercado — Google Apps Script (v3).
// Misma lógica que el Worker de Cloudflare, en la cuenta de negocios.
// Lee BCC, elToque, Revolico, Wikipedia y DuckDuckGo en el SERVIDOR
// y los devuelve en JSON (el /exec de Apps Script admite CORS en GET).
// Rutas por parámetro ?ruta=:
//   (sin ruta)          → información del espejo
//   ?ruta=tasas         → formal BCC (todas las divisas) + informal elToque
//   ?ruta=revolico&q=   → anuncios reales (título, precio, moneda, url, fecha)
//   ?ruta=wiki&q=       → resultados Wikipedia ES
//   ?ruta=buscar&q=     → búsqueda web sin claves (Wikipedia + DuckDuckGo + web)
//   ?ruta=turismo       → puntos históricos de turismo en Cuba (Wikipedia EN)
//   ?ruta=leer&url=     → texto completo de una página (para extraer cifras)
// Despliegue: script.google.com → pegar → Implementar → Aplicación web
// (Ejecutar como: Yo · Acceso: Cualquier persona). Sin secretos ni claves.

var UA_ = { "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36", "Accept-Language": "es" };

function doGet(e) {
  var p = (e && e.parameter) || {};
  var ruta = String(p.ruta || "");
  try {
    if (ruta === "tasas") return json_(tasas_());
    if (ruta === "revolico") return json_(revolico_(p.q));
    if (ruta === "wiki") return json_(wiki_(p.q));
    if (ruta === "buscar") return json_(buscar_(p.q));
    if (ruta === "turismo") return json_(turismo_());
    if (ruta === "leer") return json_(leer_(p.url));
  } catch (err) {
    return json_({ ok: false, ruta: ruta, error: trunc_(err && err.message ? err.message : err, 120) });
  }
  return json_({ ok: true, servicio: "FactiCuba · espejo de tasas y mercado (Apps Script)", espejoVersion: 3, rutas: ["?ruta=tasas", "?ruta=revolico&q=", "?ruta=wiki&q=", "?ruta=buscar&q=", "?ruta=turismo", "?ruta=leer&url="] });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function trunc_(s, n) { return String(s || "").replace(/\s+/g, " ").trim().slice(0, n); }
function get_(url, headers) {
  var opt = { muteHttpExceptions: true, followRedirects: true };
  if (headers) opt.headers = headers;
  var r = UrlFetchApp.fetch(url, opt);
  return { status: r.getResponseCode(), text: r.getContentText() };
}

function tasas_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("tasas_v3");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var out = { ok: false, fecha: new Date().toISOString(), servicio: "tasas" };
  try {
    var r1 = get_("https://api.bc.gob.cu/v1/tasas-de-cambio/activas", { "User-Agent": "FactiCuba" });
    var j = JSON.parse(r1.text);
    out.formalTodas = {};
    (j.tasas || []).forEach(function (t) {
      if (t.codigoMoneda && t.tasaEspecial > 0) out.formalTodas[t.codigoMoneda] = Math.round(t.tasaEspecial * 100) / 100;
    });
    var f = {};
    if (out.formalTodas.USD) f.USD = out.formalTodas.USD;
    if (out.formalTodas.EUR) f.EUR = out.formalTodas.EUR;
    out.formal = Object.keys(f).length ? f : null;
    out.fechaBCC = j.fechaDia || j.fechaHoy || ((j.tasas && j.tasas[0]) ? j.tasas[0].fechaDia : null);
    if (!out.formal) { out.errBCC = "sin USD/EUR en la respuesta (HTTP " + r1.status + ")"; out.formalTodas = null; }
  } catch (e) { out.formal = null; out.formalTodas = null; out.errBCC = trunc_(e && e.message ? e.message : e, 90); }
  try {
    var r2 = get_("https://eltoque.com/tasas-de-cambio-cuba", UA_);
    var h = r2.text;
    var inf = {};
    var m; var re = /"name":"([A-Z]+)\/CUP"[^}]*?"value":\s*"?([0-9]+(?:\.[0-9]+)?)"?/g;
    while ((m = re.exec(h))) {
      var k = (m[1] === "ECU") ? "EUR" : m[1];
      if (k === "USD" || k === "EUR" || k === "MLC") inf[k] = parseFloat(m[2]);
    }
    if (!inf.USD) {
      var t = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
      var seg = t.search(/mercado informal/i) >= 0 ? t.slice(t.search(/mercado informal/i), t.search(/mercado informal/i) + 6000) : t;
      var g = function (re2) { var x = seg.match(re2); return x ? parseFloat(x[1].replace(",", ".")) : null; };
      var u = g(/1\s+USD[^0-9]{0,60}?([0-9]{2,4}(?:[.,][0-9]{1,2})?)\s*CUP/i);
      var e2 = g(/1\s+EUR[^0-9]{0,60}?([0-9]{2,4}(?:[.,][0-9]{1,2})?)\s*CUP/i);
      var ml = g(/1\s+MLC[^0-9]{0,60}?([0-9]{2,4}(?:[.,][0-9]{1,2})?)\s*CUP/i);
      if (u) inf.USD = u; if (e2) inf.EUR = e2; if (ml) inf.MLC = ml;
    }
    var dm = h.match(/"dateModified":"([^"]+)"/);
    out.fechaToque = dm ? dm[1] : null;
    if (inf.USD) out.informal = inf; else { out.informal = null; out.errToque = "sin tasas legibles en la pagina (HTTP " + r2.status + ")"; }
  } catch (e3) { out.informal = null; out.errToque = trunc_(e3 && e3.message ? e3.message : e3, 90); }
  out.ok = !!(out.formal || out.informal);
  try { cache.put("tasas_v3", JSON.stringify(out), 300); } catch (e4) {}
  return out;
}

function revolico_(q) {
  q = String(q || "").slice(0, 80);
  if (!q) return { ok: false, error: "falta ?q=" };
  var searchUrl = "https://www.revolico.com/search/?q=" + encodeURIComponent(q);
  try {
    var r = get_(searchUrl, UA_);
    var h = r.text;
    var items = [];
    var seen = {};
    function push(titulo, precio, moneda, link, fecha) {
      titulo = trunc_(String(titulo || "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'"), 90);
      var p = parseFloat(precio);
      if (!titulo || !(p > 0) || items.length >= 40) return;
      var k = titulo.toLowerCase() + "|" + p + "|" + moneda;
      if (seen[k]) return; seen[k] = 1;
      items.push({ titulo: titulo, precio: String(precio), moneda: moneda, url: (link && link.charAt(0) === "/") ? "https://www.revolico.com" + link : (link || searchUrl), fecha: fecha || null });
    }
    var m;
    var re1 = /"title":"([^"]{3,120})"[^}]{0,800}?"price":([\d.]+)[^}]{0,300}?"currency":"([A-Z]{3})"[^}]{0,500}?"permalink":"([^"]+)"/g;
    while ((m = re1.exec(h))) push(m[1], m[2], m[3], m[4], (h.slice(m.index, m.index + 1500).match(/"updatedOnToOrder":"([^"]+)"/) || [])[1]);
    if (!items.length) {
      var re2 = /"permalink":"([^"]+)"[^}]{0,600}?"title":"([^"]{3,120})"[^}]{0,600}?"price":([\d.]+)[^}]{0,200}?"currency":"([A-Z]{3})"/g;
      while ((m = re2.exec(h))) push(m[2], m[3], m[4], m[1], null);
    }
    if (!items.length) {
      var re3 = /"title":"([^"]{3,120})"[^}]{0,800}?"price":([\d.]+)[^}]{0,300}?"currency":"([A-Z]{3})"/g;
      while ((m = re3.exec(h))) push(m[1], m[2], m[3], null, null);
    }
    return { ok: items.length > 0, query: q, fecha: new Date().toISOString(), items: items, url: searchUrl, total: items.length };
  } catch (e) { return { ok: false, query: q, error: trunc_(e && e.message ? e.message : e, 90) }; }
}

function wiki_(q) {
  q = String(q || "").slice(0, 120);
  if (!q) return { ok: false, error: "falta ?q=" };
  try {
    var r = get_("https://es.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" + encodeURIComponent(q) + "&srlimit=8&origin=*", UA_);
    var j = JSON.parse(r.text);
    var items = ((j.query && j.query.search) || []).slice(0, 8).map(function (x) {
      return { fuente: "Wikipedia", titulo: x.title, extracto: trunc_(String(x.snippet || "").replace(/<[^>]+>/g, " "), 280), url: "https://es.wikipedia.org/wiki/" + encodeURIComponent(String(x.title).replace(/ /g, "_")) };
    });
    return { ok: items.length > 0, query: q, fecha: new Date().toISOString(), items: items };
  } catch (e) { return { ok: false, query: q, error: trunc_(e && e.message ? e.message : e, 90) }; }
}

function buscar_(q) {
  q = String(q || "").slice(0, 120);
  if (!q) return { ok: false, error: "falta ?q=" };
  var items = [];
  var seen = {};
  function add(x) { var k = String(x.url || "").toLowerCase(); if (!k || seen[k]) return; seen[k] = 1; items.push(x); }
  try {
    var r = get_("https://es.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=" + encodeURIComponent(q) + "&srlimit=5&origin=*", UA_);
    var j = JSON.parse(r.text);
    ((j.query && j.query.search) || []).slice(0, 5).forEach(function (x) {
      add({ fuente: "Wikipedia", titulo: x.title, extracto: trunc_(String(x.snippet || "").replace(/<[^>]+>/g, " "), 280), url: "https://es.wikipedia.org/wiki/" + encodeURIComponent(String(x.title).replace(/ /g, "_")) });
    });
  } catch (e) {}
  try {
    var r2 = get_("https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_html=1&skip_disambig=1", UA_);
    var j2 = JSON.parse(r2.text);
    if (j2.AbstractURL && j2.AbstractText) add({ fuente: "DuckDuckGo", titulo: j2.Heading || q, extracto: trunc_(j2.AbstractText, 280), url: j2.AbstractURL });
    (j2.RelatedTopics || []).slice(0, 6).forEach(function (t) {
      if (t.FirstURL && t.Text) add({ fuente: "DuckDuckGo", titulo: trunc_(String(t.Text).split(" - ")[0] || t.FirstURL, 90), extracto: trunc_(t.Text, 280), url: t.FirstURL });
    });
  } catch (e2) {}
  try {
    var r3 = get_("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), UA_);
    var h = r3.text;
    var links = []; var lm; var reL = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((lm = reL.exec(h))) links.push(lm);
    var snips = []; var sm; var reS = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    while ((sm = reS.exec(h))) snips.push(sm);
    links.slice(0, 7).forEach(function (mm, i) {
      var u = mm[1].replace(/&amp;/g, "&");
      var ud = u.match(/[?&]uddg=([^&]+)/);
      if (ud) { try { u = decodeURIComponent(ud[1]); } catch (e3) {} }
      if (u.indexOf("//") === 0) u = "https:" + u;
      add({ fuente: "Web", titulo: trunc_(String(mm[2]).replace(/<[^>]+>/g, " ").trim(), 110), extracto: trunc_(String((snips[i] && snips[i][1]) || "").replace(/<[^>]+>/g, " "), 380), url: u });
    });
  } catch (e4) {}
  return { ok: items.length > 0, query: q, fecha: new Date().toISOString(), items: items.slice(0, 12) };
}

function turismo_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("turismo_v3");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  try {
    var r = get_("https://en.wikipedia.org/w/api.php?action=parse&format=json&page=Tourism_in_Cuba&prop=wikitext&origin=*", UA_);
    var j = JSON.parse(r.text);
    var wt = (j.parse && j.parse.wikitext && j.parse.wikitext["*"]) || "";
    var clean = wt.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, " ").replace(/{{[^}]*}}/g, " ");
    var puntos = [];
    var seen = {};
    var re = /(\d[\d.,]*\s*million[^.\n]{0,160})/gi;
    var m;
    while ((m = re.exec(clean)) && puntos.length < 8) {
      var ctx = clean.slice(Math.max(0, m.index - 90), m.index + 170);
      var y = ctx.match(/(19|20)\d{2}/);
      var txt = trunc_(m[1].replace(/\[\[[^\]]*\]\]/g, " "), 170);
      var k = txt.slice(0, 60);
      if (!seen[k] && /arrivals|visitors|visited|tourist/i.test(ctx)) { seen[k] = 1; puntos.push({ texto: txt + (y ? " (" + y[0] + ")" : ""), url: "https://en.wikipedia.org/wiki/Tourism_in_Cuba" }); }
    }
    var out = { ok: puntos.length > 0, fecha: new Date().toISOString(), fuente: "Wikipedia · Tourism in Cuba (cifras históricas de referencia; el dato mensual vigente lo aporta la ONEI)", url: "https://en.wikipedia.org/wiki/Tourism_in_Cuba", puntos: puntos };
    try { cache.put("turismo_v3", JSON.stringify(out), 3600); } catch (e2) {}
    return out;
  } catch (e3) { return { ok: false, error: trunc_(e3 && e3.message ? e3.message : e3, 90) }; }
}

function leer_(u) {
  try {
    var url = String(u || "");
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url no válida" };
    var r = get_(url, UA_);
    var h = r.text;
    var texto = h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 12000);
    return { ok: texto.length > 80, url: url, texto: texto };
  } catch (e) { return { ok: false, error: trunc_(e && e.message ? e.message : e, 90) }; }
}
