/* PDF Page Numbers — numbers drawn by pdf-lib (MIT), preview by pdf.js (Mozilla, Apache-2.0). Everything runs in this tab. */
import * as pdfjsLib from "./lib/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.mjs";

const { $, $$, h } = S3;
const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
const FONTS = { Helvetica: StandardFonts.Helvetica, HelveticaBold: StandardFonts.HelveticaBold, TimesRoman: StandardFonts.TimesRoman, Courier: StandardFonts.Courier };
const CSSF = { Helvetica: ["", "Helvetica, Arial, sans-serif"], HelveticaBold: ["bold ", "Helvetica, Arial, sans-serif"], TimesRoman: ["", "'Times New Roman', Times, serif"], Courier: ["", "'Courier New', Courier, monospace"] };
const PRESETS = ["{n}", "Page {n}", "Page {n} of {total}", "{n} / {total}", "- {n} -", "p. {n}"];
const DEF = { format: "Page {n} of {total}", pos: "bc", start: 1, skip: 0, range: "", font: "Helvetica", size: 10, color: "#333333", margin: 28, header: "", hAlign: "c", footer: "", fAlign: "c" };

// ---------- pure helpers ----------
const norm = r => ((r % 360) + 360) % 360;
function toUser(box, rot, X, Y) { // shown-page point (y up) -> PDF user space, for any /Rotate
  switch (norm(rot)) {
    case 90: return [box.x + box.w - Y, box.y + X];
    case 180: return [box.x + box.w - X, box.y + box.h - Y];
    case 270: return [box.x + Y, box.y + box.h - X];
    default: return [box.x + X, box.y + Y];
  }
}
function hexRgb(hex) { const n = parseInt(String(hex).slice(1), 16) || 0; return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); }
function encodable(font, s) { try { font.encodeText(s); return true; } catch (e) { return false; } }
// "2-5, 8, 10-" -> sorted unique 0-based indices; empty -> all
function parseRange(str, n) {
  const s = String(str || "").trim(), out = new Set();
  if (!s) { for (let i = 0; i < n; i++) out.add(i); return out; }
  s.split(/[,;]+/).forEach(part => {
    part = part.trim(); if (!part) return;
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part); let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; } else if (/^\d+$/.test(part)) a = b = +part; else throw new Error("“" + part + "” isn't a page or range");
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > n) throw new Error("Page " + (a < 1 ? a : b) + " doesn't exist (" + n + " pages)");
    for (let p = a; p <= b; p++) out.add(p - 1);
  });
  if (!out.size) throw new Error("No pages selected");
  return out;
}
// which pages get a number, and what it is: [{n, total} | null] per page
function plan(nPages, cfg) {
  const sel = parseRange(cfg.range, nPages), ok = i => sel.has(i) && i >= (cfg.skip || 0);
  let count = 0; for (let i = 0; i < nPages; i++) if (ok(i)) count++;
  let k = 0; const start = Number.isFinite(+cfg.start) ? +cfg.start : 1;
  return Array.from({ length: nPages }, (_, i) => ok(i) ? { n: start + k++, total: start - 1 + count } : null);
}
const fillTokens = (tpl, v) => String(tpl || "").replace(/\{(n|total|date|filename)\}/g, (m, k) => v[k] != null ? String(v[k]) : m);
// stamps for one page of shown size W x H: [{text, x, y (baseline, y up), size}]
function layout(W, H, cfg, v, widthOf) {
  const slots = {}, add = (slot, text) => { if (text.trim()) (slots[slot] = slots[slot] || []).push(text); };
  add(cfg.pos, fillTokens(cfg.format, v));
  add("t" + cfg.hAlign, fillTokens(cfg.header, v));
  add("b" + cfg.fAlign, fillTokens(cfg.footer, v));
  const size = +cfg.size || 10, m = +cfg.margin || 0, out = [];
  Object.keys(slots).forEach(slot => slots[slot].forEach((text, i) => {
    const w = widthOf(text, size), col = slot[1];
    const x = col === "l" ? m : col === "r" ? W - m - w : (W - w) / 2;
    const y = slot[0] === "t" ? H - m - size * 0.72 - i * size * 1.4 : m + i * size * 1.4;
    out.push({ text, x, y, size, w });
  }));
  return out;
}
const measureCtx = document.createElement("canvas").getContext("2d");
function cssFont(key, px) { const f = CSSF[key] || CSSF.Helvetica; return f[0] + px + "px " + f[1]; }
function widthWith(font, key) { return (t, s) => { try { return font.widthOfTextAtSize(t, s); } catch (e) { measureCtx.font = cssFont(key, s); return measureCtx.measureText(t).width; } }; }
function textPng(text, size, color, key) { // for characters the standard fonts can't encode (Arabic…)
  const k = 4, c = document.createElement("canvas"), x = c.getContext("2d"); x.font = cssFont(key, size * k);
  c.width = Math.ceil(x.measureText(text).width) + 4; c.height = Math.ceil(size * 1.25 * k);
  x.font = cssFont(key, size * k); x.fillStyle = color; x.direction = /[֐-ࣿ]/.test(text) ? "rtl" : "ltr"; x.textAlign = "left";
  x.fillText(text, 2, size * 0.95 * k);
  return { src: c.toDataURL("image/png"), w: c.width / k, h: c.height / k };
}
const shownSize = (box, rot) => rot % 180 ? [box.h, box.w] : [box.w, box.h];

async function loadLib(bytes) {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error(/encrypted/i.test(e && e.message) ? "This PDF is password-protected or encrypted. Remove the protection first." : "This file couldn't be read as a PDF."); }
}
function openJs(bytes) { return pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise; }
async function stampPdf(bytes, cfg, ctx) {
  const doc = await loadLib(bytes), pages = doc.getPages(), font = await doc.embedFont(FONTS[cfg.font] || StandardFonts.Helvetica);
  const P = plan(pages.length, cfg), color = hexRgb(cfg.color), widthOf = widthWith(font, cfg.font);
  for (let i = 0; i < pages.length; i++) {
    if (!P[i]) continue;
    const pg = pages[i], cb = pg.getCropBox(), box = { x: cb.x, y: cb.y, w: cb.width, h: cb.height }, rot = norm(pg.getRotation().angle), [W, H] = shownSize(box, rot);
    for (const s of layout(W, H, cfg, Object.assign({}, ctx, P[i]), widthOf)) {
      if (encodable(font, s.text)) { const [x, y] = toUser(box, rot, s.x, s.y); pg.drawText(s.text, { x, y, size: s.size, font, color, rotate: degrees(rot) }); }
      else {
        const t = textPng(s.text, s.size, cfg.color, cfg.font), img = await doc.embedPng(t.src), [x, y] = toUser(box, rot, s.x - 2 / 4, s.y - s.size * 0.3);
        pg.drawImage(img, { x, y, width: t.w, height: t.h, rotate: degrees(rot) });
      }
    }
  }
  return doc.save();
}

// ---------- UI ----------
const cfg = Object.assign({}, DEF, S3.store("pn.cfg") || {});
const st = { file: null, base: "", bytes: null, js: null, n: 0, sizes: [], pv: 0, plan: [], ok: true };
const metricDoc = await PDFDocument.create(), metrics = {};
for (const k of Object.keys(FONTS)) metrics[k] = await metricDoc.embedFont(FONTS[k]);
const today = () => new Date().toLocaleDateString();

function seg(el, value, onPick) {
  $$("button", el).forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.v === value));
    b.addEventListener("click", () => { $$("button", el).forEach(x => x.setAttribute("aria-pressed", String(x === b))); onPick(b.dataset.v); });
  });
}
PRESETS.forEach(p => $("#fmtChips").appendChild(h("button", { type: "button", "data-v": p, text: p.replace("{n}", "1").replace("{total}", "9") })));
function syncChips() { $$("#fmtChips button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === cfg.format))); }
$("#fmtChips").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { cfg.format = b.dataset.v; $("#fmt").value = cfg.format; update(); } });
seg($("#pos"), cfg.pos, v => { cfg.pos = v; update(); });
seg($("#hAlign"), cfg.hAlign, v => { cfg.hAlign = v; update(); });
seg($("#fAlign"), cfg.fAlign, v => { cfg.fAlign = v; update(); });
const bind = [["#fmt", "format", String], ["#start", "start", Number], ["#skip", "skip", Number], ["#range", "range", String], ["#font", "font", String],
  ["#size", "size", Number], ["#color", "color", String], ["#margin", "margin", Number], ["#header", "header", String], ["#footer", "footer", String]];
bind.forEach(([sel, key, cast]) => { $(sel).value = cfg[key]; $(sel).addEventListener("input", () => { let v = cast($(sel).value); if (cast === Number && !Number.isFinite(v)) return; cfg[key] = v; update(); }); });
if (cfg.header || cfg.footer) $("#moreBox").open = true;

function update() {
  S3.store("pn.cfg", cfg); syncChips();
  $("#marginVal").textContent = cfg.margin + " pt";
  if (!st.js) return;
  try { st.plan = plan(st.n, cfg); st.ok = true; $("#rangeMsg").textContent = ""; $("#rangeMsg").className = "faint"; $("#range").classList.remove("bad"); }
  catch (e) { st.ok = false; $("#rangeMsg").textContent = e.message; $("#rangeMsg").className = "faint bad"; $("#range").classList.add("bad"); }
  const numbered = st.ok ? st.plan.filter(Boolean).length : 0;
  $("#save").disabled = !st.ok || !numbered;
  $("#fmeta").textContent = st.n + " page" + (st.n > 1 ? "s" : "") + " · " + S3.fmtBytes(st.file.size) + (st.ok ? " · " + numbered + " will be numbered" : "");
  drawOverlay();
}

// preview
let gen = 0;
async function showPage(i) {
  if (!st.js) return;
  st.pv = Math.max(0, Math.min(st.n - 1, i));
  const g = ++gen, pg = $("#page"), [W, H] = st.sizes[st.pv];
  pg.style.aspectRatio = W + " / " + H; pg.style.width = "min(100%, " + (60 * W / H).toFixed(2) + "vh)";
  $("#pageNo").textContent = "Page " + (st.pv + 1) + " of " + st.n;
  $("#prev").disabled = st.pv === 0; $("#next").disabled = st.pv === st.n - 1;
  $$("canvas.pn-base", pg).forEach(c => c.remove());
  drawOverlay();
  try {
    const page = await st.js.getPage(st.pv + 1), w = pg.getBoundingClientRect().width || 500, dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: w * dpr / W }), c = h("canvas", { "class": "pn-base" });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (g === gen) { $$("canvas.pn-base", pg).forEach(x => x.remove()); pg.insertBefore(c, pg.firstChild); }
  } catch (e) { /* preview is best-effort */ }
}
function drawOverlay() {
  const ov = $("#ov"), pg = $("#page"), r = pg.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!st.sizes.length || !r.width) return;
  const [W, H] = st.sizes[st.pv], k = r.width * dpr / W;
  ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr);
  const x = ov.getContext("2d"); x.clearRect(0, 0, ov.width, ov.height);
  const p = st.ok && st.plan[st.pv], cap = $("#cap");
  if (!p) { cap.textContent = st.ok ? "This page gets no number (skipped or outside the page range)." : "Fix the page range to see the preview."; return; }
  const widthOf = widthWith(metrics[cfg.font] || metrics.Helvetica, cfg.font);
  const stamps = layout(W, H, cfg, { n: p.n, total: p.total, date: today(), filename: st.file.name }, widthOf);
  x.fillStyle = cfg.color; x.textBaseline = "alphabetic";
  stamps.forEach(s => { x.font = cssFont(cfg.font, s.size * k); x.direction = /[֐-ࣿ]/.test(s.text) ? "rtl" : "ltr"; x.textAlign = x.direction === "rtl" ? "right" : "left"; x.fillText(s.text, (x.direction === "rtl" ? s.x + s.w : s.x) * k, (H - s.y) * k); });
  cap.textContent = stamps.length ? "Shown as: " + stamps.map(s => "“" + s.text + "”").join(" · ") : "Nothing to add: the format and texts are empty.";
}
if ("ResizeObserver" in window) new ResizeObserver(S3.debounce(() => { if (st.js) showPage(st.pv); }, 120)).observe($("#page").parentNode);
$("#prev").addEventListener("click", () => showPage(st.pv - 1));
$("#next").addEventListener("click", () => showPage(st.pv + 1));

async function openFile(file) {
  try {
    const bytes = new Uint8Array(await S3.readFile(file)), doc = await loadLib(bytes);
    const sizes = doc.getPages().map(p => { const b = p.getCropBox(); return shownSize({ w: b.width, h: b.height }, norm(p.getRotation().angle)); });
    let js; try { js = await openJs(bytes); } catch (e) { throw new Error("This file couldn't be read as a PDF."); }
    if (st.js) st.js.destroy();
    Object.assign(st, { file, base: file.name.replace(/\.pdf$/i, "") || "document", bytes, js, n: sizes.length, sizes });
    $("#fname").textContent = file.name;
    $("#dropCard").hidden = true; $("#work").hidden = false;
    update();
    const first = st.ok ? st.plan.findIndex(Boolean) : 0;
    await showPage(first < 0 ? 0 : first);
  } catch (e) { S3.toast(e.message, "error"); }
}
const fileInput = S3.drop($("#drop"), files => openFile(files[0]), { accept: ".pdf,application/pdf", multiple: false });
$("#change").addEventListener("click", () => fileInput.click());

$("#save").addEventListener("click", async () => {
  if (!st.bytes || !st.ok) return;
  const b = $("#save"); b.disabled = true;
  try {
    const out = await stampPdf(st.bytes, cfg, { date: today(), filename: st.file.name });
    S3.download(new Blob([out], { type: "application/pdf" }), st.base + "-numbered.pdf");
    S3.toast("Numbered " + st.plan.filter(Boolean).length + " pages"); S3.done();
  } catch (e) { S3.toast("Couldn't save: " + (e && e.message || e), "error"); }
  b.disabled = false;
});
update();

// ---------- sample + self-test ----------
async function samplePdf() {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), fb = await d.embedFont(StandardFonts.HelveticaBold);
  const teal = rgb(0.05, 0.62, 0.6), ink = rgb(0.16, 0.18, 0.22), bar = rgb(0.9, 0.91, 0.93);
  for (let i = 0; i < 8; i++) {
    const p = d.addPage([595.28, 841.89]), H = p.getHeight();
    if (i === 0) {
      p.drawRectangle({ x: 0, y: 0, width: 595.28, height: H, color: teal });
      p.drawText("Annual Report", { x: 56, y: H / 2 + 20, size: 44, font: fb, color: rgb(1, 1, 1) });
      p.drawText("2026", { x: 56, y: H / 2 - 30, size: 28, font: f, color: rgb(1, 1, 1) });
      continue;
    }
    p.drawText(["Introduction", "Highlights", "Our people", "Finances", "Outlook", "Partners", "Contacts"][i - 1], { x: 56, y: H - 90, size: 22, font: fb, color: ink });
    for (let l = 0; l < 18; l++) p.drawRectangle({ x: 56, y: H - 140 - l * 26, width: 483 - ((l * 47 + i * 13) % 160), height: 9, color: bar });
    p.drawRectangle({ x: 56, y: 150, width: 483, height: 140, color: rgb(0.86, 0.95, 0.94) });
  }
  return d.save();
}
window.S3_DEMO = async () => {
  Object.assign(cfg, DEF, { format: "Page {n} of {total}", pos: "br", skip: 1, footer: "Annual Report 2026", fAlign: "l", color: "#0b6e6a", size: 10 });
  bind.forEach(([sel, key]) => { $(sel).value = cfg[key]; });
  $$("#pos button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === cfg.pos)));
  $$("#fAlign button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === cfg.fAlign)));
  $$("#hAlign button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === cfg.hAlign)));
  $("#moreBox").open = true;
  await openFile(new File([await samplePdf()], "Annual report 2026.pdf", { type: "application/pdf" }));
  await new Promise(r => setTimeout(r, 700));
};

window.S3_SELFTEST = async () => {
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
  const p = plan(5, Object.assign({}, DEF, { skip: 1, start: 1 }));
  ok(p[0] === null && p[1].n === 1 && p[4].n === 4 && p[4].total === 4, "skip first page");
  const q = plan(6, Object.assign({}, DEF, { range: "2-4, 6", start: 10 }));
  ok(q.map(x => x ? x.n : "-").join() === "-,10,11,12,-,13" && q[1].total === 13, "range + start number");
  let bad = ""; try { plan(3, Object.assign({}, DEF, { range: "2-9" })); } catch (e) { bad = e.message; }
  ok(/9/.test(bad), "bad range explained");
  ok(fillTokens("Page {n} of {total} · {filename}", { n: 2, total: 7, filename: "a.pdf" }) === "Page 2 of 7 · a.pdf", "tokens");
  // three pages: A4, landscape, and a rotated page with an offset box
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); d.addPage([842, 595]);
  const r3 = d.addPage([400, 600]); r3.setMediaBox(20, 30, 400, 600); r3.setRotation(degrees(90));
  const c = Object.assign({}, DEF, { format: "Page {n} of {total}", pos: "bc", skip: 1, header: "{filename}", hAlign: "l", margin: 30, size: 12 });
  const out = await stampPdf(await d.save(), c, { date: "26/10/2026", filename: "test.pdf" });
  const js = await openJs(out), PU = pdfjsLib.Util;
  const texts = [];
  for (let i = 1; i <= 3; i++) {
    const pg = await js.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    texts.push(tc.items.filter(t => t.str.trim()).map(t => { const m = PU.transform(vp.transform, t.transform); return { s: t.str, x: m[4], y: m[5], a: m[0], b: m[1], W: vp.width, H: vp.height }; }));
  }
  ok(texts[0].length === 0, "cover skipped");
  const n2 = texts[1].find(t => t.s === "Page 1 of 2"), h2 = texts[1].find(t => t.s === "test.pdf"), n3 = texts[2].find(t => t.s === "Page 2 of 2");
  ok(n2 && h2 && n3, "numbers + header on the right pages: " + JSON.stringify(texts.map(t => t.map(x => x.s))));
  if (n2) ok(Math.abs(n2.y - (n2.H - 30)) < 1 && n2.x > n2.W / 2 - 60 && n2.x < n2.W / 2, "bottom-centre on landscape page");
  if (h2) ok(Math.abs(h2.x - 30) < 1 && Math.abs(h2.y - (30 + 12 * 0.72)) < 1, "header top-left");
  if (n3) ok(n3.W === 600 && n3.H === 400 && Math.abs(n3.y - (400 - 30)) < 1 && n3.x > 240 && n3.x < 300 && n3.a > 0 && Math.abs(n3.b) < 1e-6, "rotated page: upright at the bottom centre " + JSON.stringify(n3));
  js.destroy();
  return fails.length ? fails : true;
};
