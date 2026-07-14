// scripts/super.js — SUPERSCORM: todas las competencias de un rol en un solo paquete.
// Reutiliza íntegramente el render y el scoring de la rúbrica individual (app.js):
//   Rol -> Menú de 6 competencias -> Wizard de cada competencia (idéntico).
// Se guarda solo (SCORM). La nota a Moodle es el PROGRESO de finalización:
//   score.raw = round(competencias completas / total * 100), score.max = 100.
//   lesson_status = "completed" cuando están las 6, si no "incomplete".

'use strict';

/* ================= Utilidades globales (idénticas a app.js) ================= */
function normalize(s){
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function classifyByRange(score, rules){
  if(!Array.isArray(rules)) return null;
  return rules.find(function(r){
    var lo = Number(r.min), hi = Number(r.max);
    return score >= Math.min(lo, hi) && score <= Math.max(lo, hi);
  }) || null;
}
function areaClassText(area, label){
  if(!area || !label) return "";
  var map = area.area_classification_text || {};
  var lab = normalize(label);
  if(lab.indexOf("alto") >= 0)  return map.alto || "";
  if(lab.indexOf("medio") >= 0) return map.medio || "";
  if(lab.indexOf("basico") >= 0) return map.basico || "";
  if(lab.indexOf("sin competencia") >= 0) return map.sin_competencia || "";
  return "";
}
function pointsForFactory(rubric){
  var ppl = (rubric.scoring && rubric.scoring.points_per_level) || {};
  return function(val){
    if(val == null || val === "") return 0;
    var n = Number(ppl[String(val)]);
    return Number.isFinite(n) ? n : (Number(val) || 0);
  };
}
function allBehaviors(rubric){
  var out = [];
  (rubric.areas || []).forEach(function(a){
    (a.behaviors || []).forEach(function(b){ out.push({ area: a, beh: b }); });
  });
  return out;
}
function computeScores(rubric, selections){
  var pointsFor = pointsForFactory(rubric);
  var sc = rubric.scoring || {};
  var accreditedMin = Number(sc.accredited_min_grade) || 3;
  var gm = sc.global_model || {};
  var maxRaw = Number(gm.max_raw) || (allBehaviors(rubric).length * (Number(sc.max_points_per_behavior) || 4));
  var total = Number(gm.total_behaviors) || allBehaviors(rubric).length;

  var raw = 0, accredited = 0, answered = 0;
  allBehaviors(rubric).forEach(function(item){
    var v = selections[item.beh.id];
    if(v != null && v !== ""){
      answered++;
      var p = pointsFor(v);
      raw += p;
      if(p >= accreditedMin) accredited++;
    }
  });
  var quality = maxRaw > 0 ? (raw / maxRaw) : 0;
  var coverage = total > 0 ? (accredited / total) : 0;
  var punt = Math.round(maxRaw * quality * (0.5 + 0.5 * coverage));
  punt = Math.max(0, Math.min(maxRaw, punt));
  var globalClass = classifyByRange(punt, (sc.classification_rules && sc.classification_rules.global) || []);
  return { raw: raw, maxRaw: maxRaw, answered: answered, total: total, accredited: accredited,
           quality: quality, coverage: coverage, punt: punt, globalClass: globalClass };
}
function areaScore(area, selections, pointsFor){
  return (area.behaviors || []).reduce(function(sum, b){
    var v = selections[b.id];
    return sum + (v != null && v !== "" ? pointsFor(v) : 0);
  }, 0);
}
function areaAnswered(area, selections){
  return (area.behaviors || []).reduce(function(n, b){
    var v = selections[b.id];
    return n + (v != null && v !== "" ? 1 : 0);
  }, 0);
}
function gradeShort(lv){
  var d = String(lv.description || "");
  d = d.split("(")[0].split("/")[0];
  d = d.replace(/[.\s]+$/, "").trim();
  return d || lv.label;
}
function escapeHTML(s){
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s){
  return escapeHTML(s).replace(/"/g, "&quot;");
}
function roleValue(rol){
  var v = String(rol == null ? "" : rol).replace(/^\s*rol\s+/i, "");
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}
// ¿Están valoradas TODAS las actuaciones de una rúbrica?
function isRubricComplete(rubric, selections){
  if(!rubric) return false;
  var beh = allBehaviors(rubric);
  if(beh.length === 0) return false;
  return beh.every(function(item){
    var v = selections[item.beh.id];
    return v != null && v !== "";
  });
}

/* ================= Capa PDF compartida (jsPDF) ================= */
// Fábrica de contexto de dibujo: helpers reutilizados por el informe individual
// y el informe combinado. Mantiene `y` mutable y las constantes de página A4.
function makePdfCtx(doc){
  var ctx = {
    doc: doc,
    GREEN_DEEP: [0, 67, 28], GREEN: [0, 121, 50], GREEN_DK: [0, 90, 37],
    INK: [46, 41, 37], MUTED: [85, 85, 89], SOFT: [234, 243, 236], BORDER: [214, 216, 218],
    PW: 210, PH: 297, M: 16
  };
  ctx.CW = ctx.PW - 2 * ctx.M;
  ctx.y = ctx.M;
  ctx.ink = function(c){ doc.setTextColor(c[0], c[1], c[2]); };
  ctx.ensure = function(h){ if(ctx.y + h > ctx.PH - ctx.M){ doc.addPage(); ctx.y = ctx.M; } };
  ctx.wrap = function(text, w, size, style){
    doc.setFont("helvetica", style || "normal"); doc.setFontSize(size);
    return doc.splitTextToSize(String(text == null ? "" : text), w);
  };
  ctx.paragraph = function(text, size, color, style, gap){
    var lines = ctx.wrap(text, ctx.CW, size, style);
    var lh = size * 0.3528 * 1.32;
    ctx.ensure(lines.length * lh);
    ctx.ink(color); doc.setFont("helvetica", style || "normal"); doc.setFontSize(size);
    doc.text(lines, ctx.M, ctx.y + lh * 0.8); ctx.y += lines.length * lh + (gap == null ? 2 : gap);
  };
  ctx.paragraphRuns = function(runs, size, color, gap){
    var lh = size * 0.3528 * 1.32;
    doc.setFont("helvetica", "normal"); doc.setFontSize(size);
    var space = doc.getTextWidth(" ");
    var tokens = [];
    runs.forEach(function(run){
      var st = run.style || "normal";
      String(run.t == null ? "" : run.t).split(/\s+/).forEach(function(w){
        if(w !== "") tokens.push({ t: w, style: st });
      });
    });
    var lines = [], cur = [], curW = 0;
    tokens.forEach(function(tok){
      doc.setFont("helvetica", tok.style); tok.w = doc.getTextWidth(tok.t);
      var add = (cur.length ? space : 0) + tok.w;
      if(curW + add > ctx.CW && cur.length){ lines.push(cur); cur = []; curW = 0; add = tok.w; }
      cur.push(tok); curW += add;
    });
    if(cur.length) lines.push(cur);
    ctx.ensure(lines.length * lh);
    ctx.ink(color);
    var yy = ctx.y + lh * 0.8;
    lines.forEach(function(line){
      var x = ctx.M;
      line.forEach(function(tok, i){
        if(i) x += space;
        doc.setFont("helvetica", tok.style); doc.setFontSize(size);
        doc.text(tok.t, x, yy); x += tok.w;
      });
      yy += lh;
    });
    ctx.y += lines.length * lh + (gap == null ? 2 : gap);
  };
  return ctx;
}

// Cabecera de marca (logo + kicker + título + rol + regla). Apilado dinámico.
function drawBrandHeader(ctx, kicker, title, rol, logo){
  var doc = ctx.doc, M = ctx.M, PW = ctx.PW, CW = ctx.CW;
  var textX = M, logoH = 16;
  if(logo && logo.data && logo.w && logo.h){
    var logoW = logoH * (logo.w / logo.h);
    try{ doc.addImage(logo.data, "JPEG", M, ctx.y, logoW, logoH); textX = M + logoW + 6; }catch(e){ textX = M; }
  }
  var tw = PW - M - textX;
  var kickLines = ctx.wrap(String(kicker || "").toUpperCase(), tw, 8, "bold");
  var titleLines = ctx.wrap(String(title || ""), tw, 17, "bold");
  var rolLines = ctx.wrap(String(rol || ""), tw, 11, "bold");
  var hy = ctx.y + 3.2;
  ctx.ink(ctx.MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.text(kickLines, textX, hy); hy += (kickLines.length - 1) * 3.4 + 6.6;
  ctx.ink(ctx.GREEN_DEEP); doc.setFont("helvetica", "bold"); doc.setFontSize(17);
  doc.text(titleLines, textX, hy); hy += (titleLines.length - 1) * 6.6 + 6.2;
  ctx.ink(ctx.INK); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(rolLines, textX, hy); hy += (rolLines.length - 1) * 5;
  ctx.y = Math.max(ctx.y + logoH, hy + 2) + 3;
  doc.setDrawColor(ctx.GREEN[0], ctx.GREEN[1], ctx.GREEN[2]); doc.setLineWidth(0.7);
  doc.line(M, ctx.y, M + CW, ctx.y); ctx.y += 6;
}

function drawDefinition(ctx, rubric){
  if(!rubric.rubric_definition) return;
  var defM = rubric.rubric_definition.match(/^(\s*Definici[oó]n de la competencia\s*:?)([\s\S]*)$/i);
  if(defM){
    ctx.paragraphRuns([{ t: defM[1].trim(), style: "bold" }, { t: defM[2], style: "normal" }], 9.5, ctx.MUTED, 3);
  } else {
    ctx.paragraph(rubric.rubric_definition, 9.5, ctx.MUTED, "normal", 3);
  }
}

function drawMeta(ctx, rubric, studentName){
  var fecha = "";
  try{ fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }); }catch(e){}
  var metaParts = [];
  if(studentName) metaParts.push("Persona: " + studentName);
  metaParts.push("Rol: " + roleValue(rubric.rubric_rol));
  if(fecha) metaParts.push("Fecha: " + fecha);
  ctx.paragraph(metaParts.join("     ·     "), 9, ctx.MUTED, "normal", 4);
}

function drawSummaryBox(ctx, scores){
  var doc = ctx.doc, M = ctx.M, CW = ctx.CW;
  var gc = scores.globalClass || {};
  var boxPad = 5;
  var kpiLines = ctx.wrap("Puntuación global: " + scores.punt + "/" + scores.maxRaw, CW - 2 * boxPad, 15, "bold");
  var verdictLines = ctx.wrap("Nivel de competencia: " + (gc.label || "–"), CW - 2 * boxPad, 10.5, "bold");
  var descLines = gc.description ? ctx.wrap(gc.description, CW - 2 * boxPad, 9.5, "normal") : [];
  var covLines = ctx.wrap("Calidad " + Math.round(scores.quality * 100) + "%   ·   Cobertura " +
    scores.accredited + "/" + scores.total + " actuaciones acreditadas", CW - 2 * boxPad, 9, "normal");
  var boxH = boxPad * 2 + kpiLines.length * 6.6 + verdictLines.length * 4.6 +
    descLines.length * 4.2 + covLines.length * 4.0 + 3;
  ctx.ensure(boxH + 2);
  doc.setFillColor(ctx.SOFT[0], ctx.SOFT[1], ctx.SOFT[2]);
  doc.setDrawColor(ctx.GREEN[0], ctx.GREEN[1], ctx.GREEN[2]); doc.setLineWidth(0.5);
  doc.roundedRect(M, ctx.y, CW, boxH, 3, 3, "FD");
  var by = ctx.y + boxPad + 4.5, bx = M + boxPad;
  ctx.ink(ctx.GREEN_DEEP); doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text(kpiLines, bx, by); by += kpiLines.length * 6.6 + 1;
  ctx.ink(ctx.GREEN_DK); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  doc.text(verdictLines, bx, by); by += verdictLines.length * 4.6;
  if(descLines.length){ ctx.ink(ctx.MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    doc.text(descLines, bx, by); by += descLines.length * 4.2; }
  ctx.ink(ctx.MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(covLines, bx, by);
  ctx.y += boxH + 8;
}

// Detalle por comportamiento (tablas Actuación/Grado, con paginación).
function drawAreas(ctx, rubric, selections){
  var doc = ctx.doc, M = ctx.M, CW = ctx.CW, PH = ctx.PH;
  var pointsFor = pointsForFactory(rubric);
  var levelsMap = (rubric.scale && rubric.scale.levels || []).reduce(function(acc, l){
    acc[String(l.value)] = l.label; return acc;
  }, {});
  var maxArea = Number((rubric.scoring || {}).max_points_per_area) || 16;
  var areaRules = ((rubric.scoring || {}).classification_rules || {}).area || [];
  var GRADE_W = 34, ACT_W = CW - GRADE_W, PADX = 3;

  function tableHeader(){
    var hH = 8;
    ctx.ensure(hH);
    doc.setFillColor(ctx.SOFT[0], ctx.SOFT[1], ctx.SOFT[2]);
    doc.setDrawColor(ctx.BORDER[0], ctx.BORDER[1], ctx.BORDER[2]); doc.setLineWidth(0.3);
    doc.rect(M, ctx.y, ACT_W, hH, "FD"); doc.rect(M + ACT_W, ctx.y, GRADE_W, hH, "FD");
    ctx.ink(ctx.GREEN_DK); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("Actuación", M + PADX, ctx.y + 5.4);
    doc.text("Grado", M + ACT_W + GRADE_W / 2, ctx.y + 5.4, { align: "center" });
    ctx.y += hH;
  }
  function tableRow(actText, gradeText){
    var lines = ctx.wrap(actText, ACT_W - 2 * PADX, 9, "normal");
    var lh = 4.2, rowH = Math.max(lines.length * lh + 3.6, 8);
    if(ctx.y + rowH > PH - M){ doc.addPage(); ctx.y = M; tableHeader(); }
    doc.setDrawColor(ctx.BORDER[0], ctx.BORDER[1], ctx.BORDER[2]); doc.setLineWidth(0.3);
    doc.rect(M, ctx.y, ACT_W, rowH); doc.rect(M + ACT_W, ctx.y, GRADE_W, rowH);
    ctx.ink(ctx.INK); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(lines, M + PADX, ctx.y + 3.4 + lh * 0.4);
    ctx.ink(ctx.GREEN_DK); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(String(gradeText), M + ACT_W + GRADE_W / 2, ctx.y + rowH / 2 + 1.4, { align: "center" });
    ctx.y += rowH;
  }

  (rubric.areas || []).forEach(function(a, idx){
    ctx.ensure(20);
    ctx.y += 2;
    ctx.ink(ctx.GREEN_DK); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    var titleLines = ctx.wrap((idx + 1) + ". " + (a.title || "Comportamiento"), CW, 12, "bold");
    doc.text(titleLines, M, ctx.y + 4); ctx.y += titleLines.length * 5 + 2;
    if(a.description) ctx.paragraph(a.description, 9, ctx.MUTED, "normal", 2);
    tableHeader();
    (a.behaviors || []).forEach(function(b){
      var v = selections[b.id];
      var label = (v != null && v !== "") ? (levelsMap[String(v)] || String(v)) : "Sin valorar";
      tableRow(b.text || "—", label);
    });
    var sVal = areaScore(a, selections, pointsFor);
    var answered = areaAnswered(a, selections);
    var cls = answered === 0 ? {} : (classifyByRange(sVal, areaRules) || {});
    var clsText = areaClassText(a, cls.label) || cls.description || "";
    ctx.y += 2;
    ctx.paragraph("Puntuación: " + sVal + "/" + maxArea + "     ·     Nivel: " +
      (answered === 0 ? "Sin valorar" : (cls.label || "–")), 9.5, ctx.INK, "bold", 1);
    if(clsText) ctx.paragraph(clsText, 9, ctx.MUTED, "normal", 3);
  });
}

function addPdfFooter(ctx){
  var doc = ctx.doc;
  var total = doc.getNumberOfPages();
  for(var p = 1; p <= total; p++){
    doc.setPage(p);
    ctx.ink(ctx.MUTED); doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text("Autoevaluación de competencias · Junta de Andalucía", ctx.M, ctx.PH - 8);
    doc.text(p + " / " + total, ctx.PW - ctx.M, ctx.PH - 8, { align: "right" });
  }
}

/* ---- Informe individual (una competencia) ---- */
function buildReportPDF(JsPDF, rubric, selections, scores, studentName, logo){
  var doc = new JsPDF({ unit: "mm", format: "a4", compress: true });
  var ctx = makePdfCtx(doc);
  drawBrandHeader(ctx,
    rubric.rubric_competency || "Mapa de Competencias Básicas · Junta de Andalucía",
    rubric.rubric_title || "Rúbrica", rubric.rubric_rol || "", logo);
  drawDefinition(ctx, rubric);
  drawMeta(ctx, rubric, studentName);
  drawSummaryBox(ctx, scores);
  drawAreas(ctx, rubric, selections);
  addPdfFooter(ctx);
  return doc;
}

/* ---- Informe combinado (todas las competencias del rol) ---- */
// items = [{ rubric, selections, scores }] en orden de competencia.
function buildAggregateReportPDF(JsPDF, items, roleLabel, studentName, logo){
  var doc = new JsPDF({ unit: "mm", format: "a4", compress: true });
  var ctx = makePdfCtx(doc);
  var M = ctx.M, CW = ctx.CW, PH = ctx.PH;

  drawBrandHeader(ctx, "Mapa de Competencias Básicas · Junta de Andalucía",
    "Informe de autoevaluación", roleLabel || "", logo);

  // Meta (persona / rol / fecha)
  var fecha = "";
  try{ fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }); }catch(e){}
  var metaParts = [];
  if(studentName) metaParts.push("Persona: " + studentName);
  metaParts.push("Rol: " + roleValue(roleLabel));
  if(fecha) metaParts.push("Fecha: " + fecha);
  ctx.paragraph(metaParts.join("     ·     "), 9, ctx.MUTED, "normal", 4);

  // Tabla resumen de las competencias.
  ctx.ink(ctx.GREEN_DK); doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  ctx.ensure(10); doc.text("Resumen por competencia", M, ctx.y + 4); ctx.y += 9;

  var NAME_W = CW - 34 - 40, PUNT_W = 34, NIV_W = 40, PADX = 3;
  function ovHeader(){
    var hH = 8; ctx.ensure(hH);
    doc.setFillColor(ctx.SOFT[0], ctx.SOFT[1], ctx.SOFT[2]);
    doc.setDrawColor(ctx.BORDER[0], ctx.BORDER[1], ctx.BORDER[2]); doc.setLineWidth(0.3);
    doc.rect(M, ctx.y, NAME_W, hH, "FD");
    doc.rect(M + NAME_W, ctx.y, PUNT_W, hH, "FD");
    doc.rect(M + NAME_W + PUNT_W, ctx.y, NIV_W, hH, "FD");
    ctx.ink(ctx.GREEN_DK); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("Competencia", M + PADX, ctx.y + 5.4);
    doc.text("Puntuación", M + NAME_W + PUNT_W / 2, ctx.y + 5.4, { align: "center" });
    doc.text("Nivel", M + NAME_W + PUNT_W + NIV_W / 2, ctx.y + 5.4, { align: "center" });
    ctx.y += hH;
  }
  ovHeader();
  items.forEach(function(it, idx){
    var name = (idx + 1) + ". " + (it.rubric.rubric_title || "Competencia");
    var lines = ctx.wrap(name, NAME_W - 2 * PADX, 9, "normal");
    var lh = 4.2, rowH = Math.max(lines.length * lh + 3.6, 8);
    if(ctx.y + rowH > PH - M){ doc.addPage(); ctx.y = M; ovHeader(); }
    doc.setDrawColor(ctx.BORDER[0], ctx.BORDER[1], ctx.BORDER[2]); doc.setLineWidth(0.3);
    doc.rect(M, ctx.y, NAME_W, rowH);
    doc.rect(M + NAME_W, ctx.y, PUNT_W, rowH);
    doc.rect(M + NAME_W + PUNT_W, ctx.y, NIV_W, rowH);
    ctx.ink(ctx.INK); doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(lines, M + PADX, ctx.y + 3.4 + lh * 0.4);
    ctx.ink(ctx.GREEN_DK); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(it.scores.punt + "/" + it.scores.maxRaw, M + NAME_W + PUNT_W / 2, ctx.y + rowH / 2 + 1.4, { align: "center" });
    var niv = (it.scores.globalClass && it.scores.globalClass.label) || "–";
    var nivLines = ctx.wrap(niv, NIV_W - 2, 8.5, "bold");
    doc.setFontSize(8.5);
    doc.text(nivLines, M + NAME_W + PUNT_W + NIV_W / 2, ctx.y + rowH / 2 + 1.4 - (nivLines.length - 1) * 2, { align: "center" });
    ctx.y += rowH;
  });

  // Detalle: una sección por competencia, en página nueva.
  items.forEach(function(it){
    doc.addPage(); ctx.y = M;
    var r = it.rubric;
    ctx.ink(ctx.MUTED); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    var kick = ctx.wrap(String(r.rubric_competency || "").toUpperCase().replace(/\s*·\s*JUNTA DE ANDALUC[IÍ]A\s*$/i, ""), CW, 8, "bold");
    doc.text(kick, M, ctx.y + 4); ctx.y += kick.length * 3.4 + 5;
    ctx.ink(ctx.GREEN_DEEP); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
    var tl = ctx.wrap(r.rubric_title || "Competencia", CW, 16, "bold");
    doc.text(tl, M, ctx.y + 5); ctx.y += tl.length * 6.4 + 3;
    doc.setDrawColor(ctx.GREEN[0], ctx.GREEN[1], ctx.GREEN[2]); doc.setLineWidth(0.5);
    doc.line(M, ctx.y, M + CW, ctx.y); ctx.y += 6;
    drawDefinition(ctx, r);
    drawSummaryBox(ctx, it.scores);
    drawAreas(ctx, r, it.selections);
  });

  addPdfFooter(ctx);
  return doc;
}

/* ================= Controlador de vistas ================= */
(function(){
  var $  = function(s, c){ return (c || document).querySelector(s); };
  var $$ = function(s, c){ return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var manifest = null;      // { roles:[{key,label,img}], comps:[{order,folder,display}] }
  var role = null;          // key del rol elegido (directivo/soporte/tecnico)
  var rubrics = {};         // caché de rubric.json por orden (1..6)
  var selByComp = {};       // { orden: { behId: value } }
  var activeComp = null;    // orden de la competencia abierta (o null en menú)
  var rubric = null;        // rúbrica activa (para el render reutilizado)
  var current = 0;          // paso actual del wizard
  var lastIndex = 0;        // = areas.length (paso final)
  var commitTimer = null;

  /* ---------- Carga ---------- */
  function fetchJSON(url){
    return fetch(url + "?nocache=" + Date.now()).then(function(r){
      if(!r.ok) throw new Error("HTTP " + r.status + " en " + url);
      return r.json();
    });
  }
  function loadManifest(){ return fetchJSON("rubrics/manifest.json"); }
  function loadRoleRubrics(roleKey){
    // Carga en paralelo las 6 competencias del rol, cachea por orden.
    var comps = (manifest.comps || []).slice().sort(function(a, b){ return a.order - b.order; });
    return Promise.all(comps.map(function(c){
      if(rubrics[c.order]) return Promise.resolve(rubrics[c.order]);
      return fetchJSON("rubrics/" + c.order + "_" + roleKey + ".json").then(function(data){
        rubrics[c.order] = data; return data;
      });
    }));
  }
  function orderedComps(){
    return (manifest.comps || []).slice().sort(function(a, b){ return a.order - b.order; });
  }
  function roleInfo(key){
    return (manifest.roles || []).find(function(r){ return r.key === key; }) || null;
  }
  function roleLabel(){ var ri = roleInfo(role); return ri ? ri.label : ""; }

  /* ---------- Vistas ---------- */
  function showView(name){
    ["role", "menu", "wizard"].forEach(function(v){
      var el = $("#view-" + v); if(el) el.hidden = (v !== name);
    });
    try{ window.scrollTo(0, 0); }catch(e){}
  }
  function resetHeader(){
    $("#rb-competency").textContent = "";
    $("#rb-title").textContent = "Autoevaluación de Competencias Básicas";
    $("#rb-rol").textContent = roleLabel();
    document.title = "Autoevaluación de Competencias Básicas";
  }

  function renderRoleView(){
    var grid = $("#role-grid");
    grid.innerHTML = (manifest.roles || []).map(function(r){
      var img = encodeURI(r.img);
      return '<li class="role-card">' +
        '<button type="button" class="role-btn" data-role="' + escapeAttr(r.key) + '">' +
          '<span class="role-img"><img src="' + escapeAttr(img) + '" alt="" aria-hidden="true"/></span>' +
          '<span class="role-name">' + escapeHTML(r.label) + '</span>' +
        '</button>' +
      '</li>';
    }).join("");
  }

  function renderMenuView(){
    $("#menu-role-line").textContent = "Rol seleccionado: " + roleLabel();
    var comps = orderedComps();
    var grid = $("#comp-grid");
    grid.innerHTML = comps.map(function(c){
      var r = rubrics[c.order];
      var sel = selByComp[c.order] || {};
      var done = isRubricComplete(r, sel);
      var answered = r ? allBehaviors(r).filter(function(it){ var v = sel[it.beh.id]; return v != null && v !== ""; }).length : 0;
      var totalB = r ? allBehaviors(r).length : 20;
      var name = (r && r.rubric_title) || c.display || c.folder;
      var status = done
        ? '<span class="comp-badge is-done">✓ Hecho</span>'
        : (answered > 0
            ? '<span class="comp-badge is-progress">En curso · ' + answered + '/' + totalB + '</span>'
            : '<span class="comp-badge">Sin empezar</span>');
      return '<li class="comp-card' + (done ? ' is-done' : '') + '">' +
        '<div class="comp-card-head">' +
          '<span class="comp-num">' + c.order + '</span>' +
          status +
        '</div>' +
        '<h3 class="comp-name">' + escapeHTML(name) + '</h3>' +
        '<button type="button" class="btn primary comp-open" data-open="' + c.order + '">' +
          (answered > 0 ? "Continuar" : "Empezar") + '</button>' +
      '</li>';
    }).join("");
    updateProgress();
  }

  function completedCount(){
    return orderedComps().reduce(function(n, c){
      return n + (isRubricComplete(rubrics[c.order], selByComp[c.order] || {}) ? 1 : 0);
    }, 0);
  }
  function updateProgress(){
    var total = orderedComps().length || 6;
    var done = completedCount();
    var pct = total > 0 ? Math.round(done / total * 100) : 0;
    var fill = $("#menu-progress-fill"); if(fill) fill.style.width = pct + "%";
    var lbl = $("#menu-progress-label");
    if(lbl) lbl.textContent = done + " de " + total + " competencias completadas (" + pct + "%)";
    var btn = $("#btn-aggregate-pdf");
    if(btn) btn.disabled = (done < total);
    var hint = $("#aggregate-hint");
    if(hint) hint.hidden = (done >= total);
  }

  /* ---------- Wizard (render reutilizado de app.js) ---------- */
  function levelsSorted(){
    var lv = (rubric.scale && rubric.scale.levels) || [];
    return lv.slice().sort(function(a, b){ return Number(a.value) - Number(b.value); });
  }
  function maxAreaOf(a){
    return Number((rubric.scoring || {}).max_points_per_area) || ((a.behaviors || []).length * 4);
  }
  function readSelections(){
    var sel = {};
    (rubric.areas || []).forEach(function(a){
      (a.behaviors || []).forEach(function(b){
        var checked = document.querySelector('input[name="b_' + a.id + "_" + b.id + '"]:checked');
        if(checked) sel[b.id] = checked.value;
      });
    });
    return sel;
  }
  function applySelections(sel){
    Object.keys(sel || {}).forEach(function(behId){
      (rubric.areas || []).forEach(function(a){
        (a.behaviors || []).forEach(function(b){
          if(b.id === behId){
            var input = document.getElementById("b_" + a.id + "_" + b.id + "_" + sel[behId]);
            if(input) input.checked = true;
          }
        });
      });
    });
  }

  function renderHeader(){
    var kicker = (rubric.rubric_competency || "").replace(/\s*·\s*Junta de Andaluc[ií]a\s*$/i, "");
    $("#rb-competency").textContent   = kicker;
    $("#rb-title").textContent        = rubric.rubric_title || "Rúbrica";
    $("#rb-rol").textContent          = rubric.rubric_rol || "";
    var def = rubric.rubric_definition || "";
    var defM = def.match(/^(\s*Definici[oó]n de la competencia\s*:?)([\s\S]*)$/i);
    if(defM){
      $("#rb-definition").innerHTML = "<strong>" + escapeHTML(defM[1]) + "</strong>" + escapeHTML(defM[2]);
    } else {
      $("#rb-definition").textContent = def;
    }
    $("#rb-instructions").innerHTML   = "<strong>" + escapeHTML(rubric.rubric_instructions || "") + "</strong>";
    document.title = (rubric.rubric_title || "Rúbrica") + " · " + (rubric.rubric_rol || "");
  }
  function renderLegend(){
    var ul = $("#rb-legend");
    ul.innerHTML = "";
    levelsSorted().forEach(function(lv){
      var li = document.createElement("li");
      li.className = "legend-item";
      li.innerHTML =
        '<span class="legend-grade">' + escapeHTML(lv.label) + '</span>' +
        '<span class="legend-desc">' + escapeHTML(gradeShort(lv)) + '</span>';
      ul.appendChild(li);
    });
  }
  function renderStepper(){
    var nav = $("#stepper");
    var ol = document.createElement("ol");
    ol.className = "stepper-list";
    (rubric.areas || []).forEach(function(a, idx){
      ol.appendChild(stepperItem(idx, String(idx + 1), "Comp. " + (idx + 1)));
    });
    ol.appendChild(stepperItem(lastIndex, "⚑", "Resultado"));
    nav.innerHTML = "";
    nav.appendChild(ol);
  }
  function stepperItem(idx, dotText, label){
    var li = document.createElement("li");
    li.className = "stepper-item";
    li.setAttribute("data-step-item", String(idx));
    li.innerHTML =
      '<button type="button" class="stepper-btn" data-step="' + idx + '">' +
        '<span class="stepper-dot" aria-hidden="true">' + escapeHTML(dotText) + '</span>' +
        '<span class="stepper-label">' + escapeHTML(label) + '</span>' +
      '</button>';
    return li;
  }
  function renderSteps(){
    var levels = levelsSorted();
    var host = $("#steps");
    host.innerHTML = "";
    (rubric.areas || []).forEach(function(a, idx){
      host.appendChild(buildAreaStep(a, idx, levels));
    });
    host.appendChild(buildFinalStep());
  }
  function buildAreaStep(a, idx, levels){
    var sec = document.createElement("section");
    sec.className = "panel step";
    sec.id = "step-" + idx;
    sec.setAttribute("role", "group");
    sec.setAttribute("aria-labelledby", "stephead_" + a.id);
    sec.hidden = true;
    var itemsHTML = (a.behaviors || []).map(function(b, bi){
      return buildItem(a, b, bi, levels);
    }).join("");
    sec.innerHTML =
      '<header class="step-header">' +
        '<p class="step-eyebrow">Comportamiento observable ' + (idx + 1) + ' de ' + rubric.areas.length + '</p>' +
        '<h2 class="step-title" id="stephead_' + a.id + '" tabindex="-1">' + escapeHTML(a.title || "Comportamiento") + '</h2>' +
        (a.description ? '<p class="step-desc">' + escapeHTML(a.description) + '</p>' : '') +
        '<div class="step-score" aria-live="polite">' +
          '<span class="score-pill"><span class="visually-hidden">Puntuación del comportamiento: </span>' +
            '<span class="score-num" id="t_' + a.id + '">0</span>' +
            '<span class="score-den">/' + maxAreaOf(a) + '</span></span>' +
          '<span class="badge is-empty" id="c_' + a.id + '">Sin valorar</span>' +
        '</div>' +
        '<p class="step-note" id="d_' + a.id + '"></p>' +
      '</header>' +
      '<div class="items">' + itemsHTML + '</div>' +
      (idx === 0
        ? '<div class="step-nav end-only">' +
            '<button type="button" class="btn primary" data-nav="next">Siguiente</button>' +
          '</div>'
        : '<div class="step-nav">' +
            '<button type="button" class="btn btn-ghost" data-nav="prev">Anterior</button>' +
            '<button type="button" class="btn primary" data-nav="next">Siguiente</button>' +
          '</div>');
    return sec;
  }
  function buildItem(a, b, bi, levels){
    var name = "b_" + a.id + "_" + b.id;
    var segs = levels.map(function(lv){
      var id = name + "_" + lv.value;
      return '<label class="seg">' +
        '<input type="radio" name="' + name + '" id="' + id + '" value="' + lv.value + '"/>' +
        '<span class="seg-body">' +
          '<span class="seg-grade">' + escapeHTML(lv.label) + '</span>' +
          '<span class="seg-desc">' + escapeHTML(gradeShort(lv)) + '</span>' +
          '<span class="seg-check" aria-hidden="true">✓</span>' +
        '</span>' +
      '</label>';
    }).join("");
    return '<div class="item" role="radiogroup" aria-labelledby="lg_' + name + '">' +
      '<p class="item-legend" id="lg_' + name + '">' +
        '<span class="item-index" aria-hidden="true">' + (bi + 1) + '</span>' +
        '<span>' + escapeHTML(b.text || "—") + '</span>' +
      '</p>' +
      '<div class="segments">' + segs + '</div>' +
    '</div>';
  }
  function buildFinalStep(){
    var sec = document.createElement("section");
    sec.className = "panel step result-step";
    sec.id = "step-" + lastIndex;
    sec.setAttribute("role", "group");
    sec.setAttribute("aria-labelledby", "result-h");
    sec.hidden = true;
    sec.innerHTML =
      '<header class="step-header">' +
        '<p class="step-eyebrow">Resumen de la autoevaluación</p>' +
        '<h2 class="step-title" id="result-h" tabindex="-1">Resultado global</h2>' +
      '</header>' +
      '<div class="result-hero">' +
        '<div class="result-figure" aria-live="polite">' +
          '<div class="kpi"><span id="global-score">0</span><span class="kpi-unit" aria-hidden="true">/80</span>' +
            '<span class="visually-hidden"> de 80 puntos</span></div>' +
          '<div class="muted">Puntuación global</div>' +
        '</div>' +
        '<div class="result-verdict" aria-live="polite">' +
          '<span class="badge badge-lg is-empty" id="global-class-label">–</span>' +
          '<p class="note" id="global-class-desc"></p>' +
        '</div>' +
      '</div>' +
      '<h3 class="visually-hidden">Detalle por comportamiento</h3>' +
      '<div class="result-areas" id="result-areas"></div>' +
      '<p id="comp-done" class="comp-done" role="status" hidden>✓ Competencia completada. El progreso se guarda automáticamente.</p>' +
      '<div class="btn-row">' +
        '<button type="button" id="btn-pdf" class="btn btn-ghost">Descargar PDF de esta competencia</button>' +
        '<button type="button" id="btn-reset" class="btn btn-ghost">Reiniciar</button>' +
      '</div>' +
      '<p class="muted small">El progreso se guarda automáticamente. Puedes revisar esta competencia y volver a valorarla más adelante; ' +
        'cuando completes las 6 podrás descargar el informe completo desde el menú.</p>' +
      '<div class="step-nav">' +
        '<button type="button" class="btn btn-ghost" data-nav="prev">Anterior</button>' +
        '<button type="button" class="btn primary" data-back-menu>Volver a competencias</button>' +
      '</div>';
    return sec;
  }

  function refresh(){
    var sel = readSelections();
    var pointsFor = pointsForFactory(rubric);
    var areaRules = ((rubric.scoring || {}).classification_rules || {}).area || [];
    (rubric.areas || []).forEach(function(a){
      var answered = areaAnswered(a, sel);
      var t = areaScore(a, sel, pointsFor);
      var tEl = $("#t_" + a.id); if(tEl) tEl.textContent = String(Math.min(t, maxAreaOf(a)));
      var cEl = $("#c_" + a.id);
      var dEl = $("#d_" + a.id);
      if(answered === 0){
        if(cEl){ cEl.textContent = "Sin valorar"; cEl.classList.add("is-empty"); }
        if(dEl) dEl.textContent = "";
      } else {
        var cls = classifyByRange(t, areaRules) || {};
        if(cEl){ cEl.textContent = cls.label || "–"; cEl.classList.remove("is-empty"); }
        if(dEl) dEl.textContent = areaClassText(a, cls.label) || cls.description || "";
      }
    });
    var s = computeScores(rubric, sel);
    var gsEl = $("#global-score"); if(gsEl) gsEl.textContent = String(s.punt);
    var glEl = $("#global-class-label");
    var gdEl = $("#global-class-desc");
    if(s.answered === 0){
      if(glEl){ glEl.textContent = "–"; glEl.classList.add("is-empty"); }
      if(gdEl) gdEl.textContent = "";
    } else {
      if(glEl){ glEl.textContent = (s.globalClass && s.globalClass.label) || "–"; glEl.classList.remove("is-empty"); }
      if(gdEl) gdEl.textContent = (s.globalClass && s.globalClass.description) || "";
    }
    var doneEl = $("#comp-done"); if(doneEl) doneEl.hidden = !isRubricComplete(rubric, sel);
    renderResultAreas(sel, pointsFor, areaRules);
    renderStepperState(sel);
    return sel;
  }
  function renderResultAreas(sel, pointsFor, areaRules){
    var host = $("#result-areas");
    if(!host) return;
    host.innerHTML = (rubric.areas || []).map(function(a, idx){
      var answered = areaAnswered(a, sel);
      var t = areaScore(a, sel, pointsFor);
      var cls = answered === 0 ? null : (classifyByRange(t, areaRules) || {});
      var badge = answered === 0
        ? '<span class="badge is-empty">Sin valorar</span>'
        : '<span class="badge">' + escapeHTML(cls.label || "–") + '</span>';
      return '<div class="result-area">' +
          '<span class="result-area-name">' + (idx + 1) + '. ' + escapeHTML(a.title || "Comportamiento") + '</span>' +
          '<span class="score-pill"><span class="score-num">' + Math.min(t, maxAreaOf(a)) + '</span>' +
            '<span class="score-den">/' + maxAreaOf(a) + '</span></span>' +
          badge +
        '</div>';
    }).join("");
  }
  function renderStepperState(sel){
    var doneCount = 0;
    (rubric.areas || []).forEach(function(a, idx){
      var li = $('[data-step-item="' + idx + '"]');
      if(!li) return;
      var done = areaAnswered(a, sel) === (a.behaviors || []).length && (a.behaviors || []).length > 0;
      if(done) doneCount++;
      li.classList.toggle("is-done", done && idx !== current);
      li.classList.toggle("is-current", idx === current);
      var btn = li.querySelector(".stepper-btn");
      if(btn){ if(idx === current) btn.setAttribute("aria-current", "step"); else btn.removeAttribute("aria-current"); }
    });
    var list = document.querySelector(".stepper-list");
    if(list) list.style.setProperty("--progress", lastIndex ? (doneCount / lastIndex) : 0);
    var lastLi = $('[data-step-item="' + lastIndex + '"]');
    if(lastLi){
      lastLi.classList.toggle("is-current", current === lastIndex);
      var lb = lastLi.querySelector(".stepper-btn");
      if(lb){ if(current === lastIndex) lb.setAttribute("aria-current", "step"); else lb.removeAttribute("aria-current"); }
    }
  }
  function goToStep(n, opts){
    opts = opts || {};
    n = Math.max(0, Math.min(lastIndex, n));
    current = n;
    $$("#steps .step").forEach(function(sec){
      sec.hidden = (sec.id !== "step-" + n);
    });
    refresh();
    var title = (rubric.areas[n] && rubric.areas[n].title) || "Resultado global";
    var stepLabel = "Paso " + (n + 1) + " de " + (lastIndex + 1) + ": " + title;
    var status = $("#wizard-status"); if(status) status.textContent = stepLabel;
    if(opts.focus !== false){
      var active = document.getElementById("step-" + n);
      var head = active && active.querySelector(".step-title");
      if(head) head.focus();
    }
    if(opts.scroll !== false){
      var host = $("#stepper");
      if(host && host.scrollIntoView) host.scrollIntoView({ block: "start" });
    }
  }

  /* ---------- Navegación entre competencias ---------- */
  function openCompetency(order){
    rubric = rubrics[order];
    if(!rubric){ showError("No se pudo cargar la competencia."); return; }
    activeComp = order;
    lastIndex = (rubric.areas || []).length;
    renderHeader();
    renderLegend();
    renderStepper();
    renderSteps();
    applySelections(selByComp[order] || {});
    showView("wizard");
    goToStep(0, { focus: false, scroll: false });
  }
  function backToMenu(){
    activeComp = null;
    rubric = null;
    resetHeader();
    renderMenuView();
    showView("menu");
  }
  function chooseRole(key){
    role = key;
    resetHeader();
    persist();
    // Cargar (si hace falta) las 6 rúbricas y mostrar el menú.
    loadRoleRubrics(role).then(function(){
      renderMenuView();
      showView("menu");
    }).catch(function(e){ showError("No se pudieron cargar las competencias del rol."); console.error(e); });
  }
  function changeRole(){
    activeComp = null; rubric = null;
    resetHeader();
    // En la pantalla de elegir rol no se muestra ningún rol en la cabecera
    // (si no, al volver aparecería el rol anterior y confunde).
    $("#rb-rol").textContent = "";
    showView("role");
  }

  /* ---------- Persistencia SCORM ---------- */
  function scheduleCommit(){
    if(commitTimer) return;
    commitTimer = setTimeout(function(){
      commitTimer = null;
      try{ SCORM12.commit(); }catch(e){}
    }, 2000);
  }
  function persist(){
    try{
      var payload = { v: 1, role: role, sel: selByComp };
      SCORM12.setValue("cmi.suspend_data", JSON.stringify(payload).slice(0, 4000));
      // Nota = progreso de finalización (0..100).
      var total = orderedComps().length || 6;
      var done = completedCount();
      var raw = total > 0 ? Math.round(done / total * 100) : 0;
      SCORM12.setValue("cmi.core.score.min", "0");
      SCORM12.setValue("cmi.core.score.max", "100");
      SCORM12.setValue("cmi.core.score.raw", String(raw));
      SCORM12.setValue("cmi.core.lesson_status", done >= total ? "completed" : "incomplete");
      scheduleCommit();
    }catch(e){}
  }
  function autosave(){
    if(activeComp == null) return;
    selByComp[activeComp] = readSelections();
    persist();
  }
  function restore(){
    try{
      var raw = SCORM12.getValue("cmi.suspend_data");
      if(!raw) return null;
      var data = JSON.parse(raw);
      if(data && data.sel) selByComp = data.sel;
      return data && data.role ? data.role : null;
    }catch(e){ return null; }
  }

  function showError(msg){ var err = $("#err"); if(err){ err.hidden = false; err.textContent = msg; } }
  function clearError(){ var err = $("#err"); if(err) err.hidden = true; }

  /* ---------- Modal de reinicio ---------- */
  var lastFocus = null;
  function openModal(){
    lastFocus = document.activeElement;
    var m = $("#modal"); if(m){ m.hidden = false; var c = $("#modal-confirm"); if(c) c.focus(); }
  }
  function closeModal(){
    var m = $("#modal"); if(m) m.hidden = true;
    if(lastFocus && lastFocus.focus){ try{ lastFocus.focus(); }catch(e){} }
  }
  function resetActiveComp(){
    if(activeComp == null) return;
    selByComp[activeComp] = {};
    $$('#steps input[type="radio"]').forEach(function(i){ i.checked = false; });
    clearError();
    persist();
    goToStep(0);
  }

  /* ---------- Informe individual / combinado ---------- */
  function loadLogo(cb){
    try{
      var img = new Image();
      img.onload = function(){
        try{
          var c = document.createElement("canvas");
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          cb({ data: c.toDataURL("image/jpeg", 0.92), w: img.naturalWidth, h: img.naturalHeight });
        }catch(e){ cb(null); }
      };
      img.onerror = function(){ cb(null); };
      img.src = "media/Logo-JuntaAndalucia.jpg";
    }catch(e){ cb(null); }
  }
  function asciiSlug(s){
    var b = String(s || "");
    if(b.normalize) b = b.normalize("NFD");
    return b.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function studentName(){
    try{ return SCORM12.getValue("cmi.core.student_name") || ""; }catch(e){ return ""; }
  }
  function downloadCompPDF(){
    if(!rubric) return;
    var sel = readSelections();
    var s = computeScores(rubric, sel);
    var name = studentName();
    loadLogo(function(logo){
      var ns = window.jspdf || null;
      if(ns && ns.jsPDF){
        try{
          var doc = buildReportPDF(ns.jsPDF, rubric, sel, s, name, logo);
          doc.save("Informe_" + (asciiSlug((rubric.rubric_title || "Rubrica") + " " + (rubric.rubric_rol || "")) || "Rubrica") + ".pdf");
          return;
        }catch(e){ console.error("jsPDF falló:", e); }
      }
      var w = window.open("", "_blank");
      if(!w){ alert("Permite las ventanas emergentes para generar el informe."); return; }
      var html = buildReportHTML(rubric, sel, s, name, logo ? logo.data : "");
      w.document.open(); w.document.write(html); w.document.close();
      setTimeout(function(){ try{ w.focus(); w.print(); }catch(e){} }, 350);
    });
  }
  function downloadAggregatePDF(){
    var comps = orderedComps();
    var items = comps.map(function(c){
      var r = rubrics[c.order];
      var sel = selByComp[c.order] || {};
      return { rubric: r, selections: sel, scores: computeScores(r, sel) };
    });
    var name = studentName();
    loadLogo(function(logo){
      var ns = window.jspdf || null;
      if(ns && ns.jsPDF){
        try{
          var doc = buildAggregateReportPDF(ns.jsPDF, items, roleLabel(), name, logo);
          doc.save("Informe_completo_" + (asciiSlug(roleLabel()) || "rol") + ".pdf");
          return;
        }catch(e){ console.error("jsPDF (combinado) falló:", e); }
      }
      alert("No se pudo generar el PDF combinado en este navegador.");
    });
  }

  /* ---------- Eventos ---------- */
  function wireEvents(){
    document.addEventListener("change", function(e){
      if(e.target && e.target.matches && e.target.matches('#steps input[type="radio"]')){
        refresh(); autosave();
      }
    });
    document.addEventListener("click", function(e){
      var t = e.target;
      // Elección de rol
      var roleBtn = t.closest && t.closest("[data-role]");
      if(roleBtn){ chooseRole(roleBtn.getAttribute("data-role")); return; }
      // Menú
      if(t.closest && t.closest("#btn-change-role")){ changeRole(); return; }
      var openBtn = t.closest && t.closest("[data-open]");
      if(openBtn){ openCompetency(Number(openBtn.getAttribute("data-open"))); return; }
      if(t.closest && t.closest("#btn-aggregate-pdf")){ if(!$("#btn-aggregate-pdf").disabled) downloadAggregatePDF(); return; }
      // Wizard: volver al menú
      if(t.closest && (t.closest("#btn-back-menu") || t.closest("[data-back-menu]"))){ backToMenu(); return; }
      // Wizard: navegación de pasos
      var nav = t.closest && t.closest("[data-nav]");
      if(nav){ goToStep(current + (nav.getAttribute("data-nav") === "next" ? 1 : -1)); return; }
      var step = t.closest && t.closest("[data-step]");
      if(step){ goToStep(Number(step.getAttribute("data-step"))); return; }
      // Wizard: acciones del paso final
      if(t.closest && t.closest("#btn-pdf")){ downloadCompPDF(); return; }
      if(t.closest && t.closest("#btn-reset")){ openModal(); return; }
      // Modal
      if(t.closest && t.closest("#modal-cancel")){ closeModal(); return; }
      if(t.closest && t.closest("#modal-confirm")){ closeModal(); resetActiveComp(); return; }
      if(t.id === "modal"){ closeModal(); return; } // clic en el velo
    });
    document.addEventListener("keydown", function(e){
      if(e.key === "Escape"){ var m = $("#modal"); if(m && !m.hidden){ closeModal(); } }
    });
  }

  /* ---------- Arranque ---------- */
  // Decisión inicial de vista (una sola vez). Se renderiza aquí la primera vista;
  // así el usuario no puede navegar antes y restore() nunca pisa su navegación.
  var booted = false;
  function boot(){
    if(booted) return;
    booted = true;
    var savedRole = restore();
    if(savedRole && roleInfo(savedRole)){
      role = savedRole;
      resetHeader();
      loadRoleRubrics(role).then(function(){ renderMenuView(); showView("menu"); })
        .catch(function(e){ renderRoleView(); showView("role"); console.error(e); });
    } else {
      renderRoleView();
      showView("role");
    }
  }
  loadManifest().then(function(m){
    manifest = m;
    wireEvents();
    // Arrancar tras 'load' (garantiza que SCORM12.init ya corrió y suspend_data está disponible).
    if(document.readyState === "complete") boot();
    else window.addEventListener("load", boot, { once: true });
  }).catch(function(e){
    showError("No se pudo cargar el manifiesto de rúbricas (rubrics/manifest.json).");
    console.error(e);
  });
})();

/* ---------- Informe imprimible de reserva (sin jsPDF) ---------- */
function buildReportHTML(rubric, selections, scores, studentName, logoDataUrl){
  var pointsFor = pointsForFactory(rubric);
  var levelsMap = (rubric.scale && rubric.scale.levels || []).reduce(function(acc, l){
    acc[String(l.value)] = l.label; return acc;
  }, {});
  var maxArea = Number((rubric.scoring || {}).max_points_per_area) || 16;
  var areaRules = ((rubric.scoring || {}).classification_rules || {}).area || [];
  var areasHTML = (rubric.areas || []).map(function(a, idx){
    var rows = (a.behaviors || []).map(function(b){
      var v = selections[b.id];
      var label = (v != null && v !== "") ? (levelsMap[String(v)] || String(v)) : "Sin valorar";
      return "<tr><td>" + escapeHTML(b.text || "—") + "</td><td class='c'>" + escapeHTML(label) + "</td></tr>";
    }).join("");
    var sVal = areaScore(a, selections, pointsFor);
    var answered = areaAnswered(a, selections);
    var cls = answered === 0 ? {} : (classifyByRange(sVal, areaRules) || {});
    var clsText = areaClassText(a, cls.label) || cls.description || "";
    return "<section class='area'>" +
      "<h2>" + (idx + 1) + ". " + escapeHTML(a.title || "Comportamiento") + "</h2>" +
      (a.description ? "<p class='muted'>" + escapeHTML(a.description) + "</p>" : "") +
      "<table><thead><tr><th>Actuación</th><th class='c'>Grado</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      "<p class='areascore'><strong>Puntuación:</strong> " + sVal + "/" + maxArea +
        " &nbsp;·&nbsp; <strong>Nivel:</strong> " + escapeHTML(answered === 0 ? "Sin valorar" : (cls.label || "–")) + "</p>" +
      (clsText ? "<p class='muted'>" + escapeHTML(clsText) + "</p>" : "") +
    "</section>";
  }).join("");
  var gc = scores.globalClass || {};
  var fecha = "";
  try{ fecha = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" }); }catch(e){}
  var meta = [];
  if(studentName) meta.push("<div><strong>Persona:</strong> " + escapeHTML(studentName) + "</div>");
  meta.push("<div><strong>Rol:</strong> " + escapeHTML(roleValue(rubric.rubric_rol)) + "</div>");
  if(fecha) meta.push("<div><strong>Fecha:</strong> " + escapeHTML(fecha) + "</div>");
  return "<!doctype html><html lang='es'><head><meta charset='utf-8'/>" +
    "<title>Informe · " + escapeHTML(rubric.rubric_title || "Rúbrica") + "</title><style>" +
    ":root{--g:#007932;--gd:#005a25;--gdeep:#00431c;--soft:#eaf3ec;--ink:#2e2925;--muted:#555559;--bd:#dcdddf}" +
    "*{box-sizing:border-box}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial;margin:32px;color:var(--ink);line-height:1.55}" +
    "h1{color:var(--gdeep);margin:0 0 4px;font-size:26px;letter-spacing:-.01em}" +
    "h2{color:var(--gd);font-size:18px;margin:22px 0 8px}" +
    ".kicker{color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:12px;font-weight:600;margin:0}" +
    ".rol{font-size:16px;font-weight:600;margin:4px 0 14px}" +
    ".meta{display:flex;gap:24px;flex-wrap:wrap;color:var(--muted);font-size:14px;margin:10px 0 4px}" +
    ".summary{background:linear-gradient(135deg,var(--soft),#f3f9f4);border:1px solid var(--g);border-radius:14px;padding:18px 20px;margin:16px 0}" +
    ".kpi{font-size:30px;font-weight:800;color:var(--gdeep);letter-spacing:-.02em}" +
    ".verdict{margin:6px 0 0;font-size:15px}.verdict strong{color:var(--gd)}" +
    "table{width:100%;border-collapse:collapse;margin:8px 0}" +
    "th,td{border:1px solid var(--bd);padding:9px 10px;text-align:left;vertical-align:top}" +
    "th{background:var(--soft);color:var(--gd)}.c{text-align:center;white-space:nowrap}" +
    ".muted{color:var(--muted)}.small{font-size:13px}.areascore{margin:8px 0 2px}" +
    ".brand{display:flex;align-items:center;gap:20px;border-bottom:2px solid var(--g);padding-bottom:14px;margin-bottom:18px}" +
    ".brand-logo{height:52px;width:auto;flex:0 0 auto}.brand h1{margin:2px 0}" +
    ".area{page-break-inside:avoid}@media print{body{margin:12mm}}" +
    "</style></head><body>" +
    "<div class='brand'>" +
      (logoDataUrl ? "<img class='brand-logo' src='" + logoDataUrl + "' alt='Junta de Andalucía'/>" : "") +
      "<div>" +
        "<p class='kicker'>" + escapeHTML(rubric.rubric_competency || "Mapa de Competencias Básicas · Junta de Andalucía") + "</p>" +
        "<h1>" + escapeHTML(rubric.rubric_title || "Rúbrica") + "</h1>" +
        "<p class='rol'>" + escapeHTML(rubric.rubric_rol || "") + "</p>" +
      "</div>" +
    "</div>" +
    (rubric.rubric_definition ? "<p class='muted'>" + escapeHTML(rubric.rubric_definition) + "</p>" : "") +
    "<div class='meta'>" + meta.join("") + "</div>" +
    "<div class='summary'><div class='kpi'>Puntuación global: " + scores.punt + "/" + scores.maxRaw + "</div>" +
      "<p class='verdict'><strong>Nivel de competencia:</strong> " + escapeHTML(gc.label || "–") + "</p>" +
      (gc.description ? "<p class='muted'>" + escapeHTML(gc.description) + "</p>" : "") +
      "<p class='small muted'>Calidad " + Math.round(scores.quality * 100) + "% · " +
        "Cobertura " + scores.accredited + "/" + scores.total + " actuaciones acreditadas</p>" +
    "</div>" +
    areasHTML +
    "</body></html>";
}
