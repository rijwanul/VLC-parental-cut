/*
 * VLC Parental Cut: page logic.
 * The pasted list is the single source of truth. Everything else (tabs, rows, timeline, playlist) is
 * computed from it plus a small set of overrides (which rows are ticked, per-episode playlist names).
 */
(function () {
  "use strict";

  var S = window.SPB, P = S.parser, L = S.playlist, PR = S.prompt;
  var KEY = "spb-v2";
  var $ = function (id) { return document.getElementById(id); };

  var EXAMPLE_TEXT = [
    "Buffer before and after: 1s",
    "",
    "Sample Show - S01E01 (Pilot):",
    "Runtime: 24:10",
    "",
    "Skip-",
    "* 3:30.9-3:52.1: Pregnancy talk between friends. (Mid, pregnancy talk)",
    "* 5:54.1-6:08.5: Double-meaning lines. (Low, double meaning)",
    "* 12:10-13:25: A long romantic scene. (Mid, romantic)",
    "",
    "Others-",
    "* 0:33.0-0:40.5: One mild joke.",
    "",
    "Sample Show - S01E02 (Second Day):",
    "",
    "Skip-",
    "* 2:00-2:45: A romantic remark. (Low, romantic)",
    "* 9:15-10:40: A romantic scene. (High, romantic)"
  ].join("\n");
  var EXAMPLE_FILES = "Sample.Show.S01E01.1080p.WEB-DL.mkv\nSample.Show.S01E02.1080p.WEB-DL.mkv";

  var state = {
    text: "", files: "", sel: 0, ov: {}, epx: {}, theme: "",
    settings: { gap: 2, pattern: "{code}_clean.m3u", criteria: PR.DEFAULTS.criteria, keep: PR.DEFAULTS.keep }
  };
  var parsed = null, fileList = [], match = {};

  /* ---------- storage ---------- */
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!s || typeof s !== "object") return;
      if (typeof s.text === "string") state.text = s.text;
      if (typeof s.files === "string") state.files = s.files;
      if (typeof s.sel === "number") state.sel = s.sel;
      if (s.ov && typeof s.ov === "object") state.ov = s.ov;
      if (s.epx && typeof s.epx === "object") state.epx = s.epx;
      if (s.theme === "light" || s.theme === "dark") state.theme = s.theme;
      if (s.settings && typeof s.settings === "object") {
        var st = s.settings;
        if (typeof st.gap === "number" && st.gap >= 0) state.settings.gap = st.gap;
        if (typeof st.pattern === "string" && st.pattern) state.settings.pattern = st.pattern;
        if (typeof st.criteria === "string") state.settings.criteria = st.criteria;
        if (typeof st.keep === "string") state.settings.keep = st.keep;
      }
    } catch (e) { /* storage blocked or corrupt: start fresh */ }
  }
  var saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    }, 150);
  }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function icons() { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }
  function icon(name) { return '<i data-lucide="' + name + '" aria-hidden="true"></i>'; }
  function num(n) { return String(+Number(n).toFixed(2)); }
  function dur(t) { return t < 60 ? Math.round(t * 10) / 10 + "s" : P.formatClock(t); }
  function epKey(ep) { return ep.code || ("#" + ep.index); }
  function numOrNull(v) {
    v = String(v).trim();
    if (v === "") return null;
    var n = parseFloat(v);
    return isFinite(n) && n >= 0 ? n : undefined;
  }
  function setMsg(el, text) {
    el.textContent = text;
    clearTimeout(el._t);
    if (text) el._t = setTimeout(function () { el.textContent = ""; }, 3000);
  }
  function copyText(text, msgEl) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      setMsg(msgEl, ok ? "Copied." : "Copy failed. Select the text and copy it by hand.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { setMsg(msgEl, "Copied."); }, fallback);
    } else fallback();
  }
  function download(name, data, type) {
    var blob = new Blob([data], { type: type || "application/octet-stream" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ---------- model ---------- */
  function reparse() {
    parsed = P.parseList(state.text);
    fileList = P.parseFileList(state.files);
    match = P.matchFiles(parsed.episodes, fileList);
    if (state.sel >= parsed.episodes.length) state.sel = Math.max(0, parsed.episodes.length - 1);
  }
  function cur() { return parsed.episodes[state.sel] || null; }
  function isCut(r) { return r.key in state.ov ? !!state.ov[r.key] : r.sec === "skip"; }
  function bufferOf(ep) {
    var g = parsed.globals;
    return {
      before: ep.before !== null ? ep.before : (g.before !== null ? g.before : 0),
      after: ep.after !== null ? ep.after : (g.after !== null ? g.after : 0)
    };
  }
  function compute(ep) {
    var b = bufferOf(ep);
    var cuts = ep.ranges.filter(isCut).map(function (r) { return { s: r.s, e: r.e }; });
    var res = L.computeParts(cuts, { before: b.before, after: b.after, run: ep.runtime || Infinity, gap: state.settings.gap });
    res.cutCount = cuts.length;
    return res;
  }
  function videoFor(ep) { return ep.video || (match[ep.index] && match[ep.index].name) || ""; }
  function plFor(ep) {
    var x = state.epx[epKey(ep)];
    if (x && x.pl) return x.pl;
    return L.playlistName(state.settings.pattern, { code: ep.code || ("ep" + (ep.index + 1)), show: ep.show, name: ep.name });
  }
  function m3uFor(ep, res) {
    return L.buildM3U(res.parts, { video: videoFor(ep), label: ep.title || ep.label });
  }
  /** Changes the text through a parser helper, then recomputes the model. */
  function setText(text) {
    state.text = text;
    $("src").value = text;
    reparse();
    save();
  }

  /* ---------- prompt ---------- */
  function updatePrompt() {
    state.settings.criteria = $("criteria").value;
    state.settings.keep = $("keep").value;
    $("promptText").value = PR.buildPrompt({ criteria: state.settings.criteria, keep: state.settings.keep });
    save();
  }

  /* ---------- problems and file status ---------- */
  function renderProblems() {
    var el = $("problems"), bad = parsed.bad;
    if (!bad.length) { el.textContent = ""; return; }
    var show = bad.slice(0, 3).map(function (b) { return "line " + b.n; }).join(", ");
    el.textContent = bad.length + (bad.length === 1 ? " line was" : " lines were") + " not understood and ignored (" + show + (bad.length > 3 ? ", ..." : "") + "). Check the format guide below the box.";
  }
  function renderFiles() {
    var ul = $("fileStatus"), html = "";
    if (state.files.trim()) {
      if (!fileList.length) html = '<li class="no">' + icon("circle-alert") + "<span>No video file names found in that text.</span></li>";
      else {
        html = '<li class="ok">' + icon("check") + "<span>" + fileList.length + " video file" + (fileList.length === 1 ? "" : "s") + " found.</span></li>";
        parsed.episodes.forEach(function (ep) {
          var m = match[ep.index];
          if (m) html += '<li class="ok">' + icon("link") + "<span><b>" + esc(ep.label) + "</b> uses " + esc(m.name) + (m.count > 1 ? " (" + m.count + " files share this code, the first is used)" : "") + "</span></li>";
          else if (parsed.episodes.length) html += '<li class="no">' + icon("circle-alert") + "<span><b>" + esc(ep.label) + "</b> has no file with that code. Type the file name in the playlist box.</span></li>";
        });
      }
    }
    ul.innerHTML = html;
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    var el = $("tabs");
    el.innerHTML = parsed.episodes.map(function (ep) {
      var n = ep.ranges.filter(isCut).length;
      return '<button type="button" class="tab" data-i="' + ep.index + '" aria-pressed="' + (ep.index === state.sel) + '">' +
        (match[ep.index] ? icon("video") : "") + esc(ep.label) + "<small>" + n + (n === 1 ? " cut" : " cuts") + "</small></button>";
    }).join("");
  }

  /* ---------- panel ---------- */
  function rowHtml(r) {
    var meta = "";
    if (r.lv) meta += '<span class="lv ' + r.lv + '">' + r.lv.charAt(0).toUpperCase() + r.lv.slice(1) + "</span>";
    r.tags.forEach(function (t) { meta += '<span class="tag">' + esc(t) + "</span>"; });
    return '<li class="row" data-key="' + esc(r.key) + '" data-line="' + r.line + '">' +
      "<div>" +
        '<label class="chk"><input type="checkbox" data-act="cut"' + (isCut(r) ? " checked" : "") + "><span>" + esc(r.desc) + "</span></label>" +
        (meta ? '<div class="meta">' + meta + "</div>" : "") +
      "</div>" +
      '<div class="times">' +
        '<input class="t" data-act="s" type="text" inputmode="decimal" autocomplete="off" aria-label="Start time" value="' + P.formatTime(r.s) + '">' +
        '<span aria-hidden="true">to</span>' +
        '<input class="t" data-act="e" type="text" inputmode="decimal" autocomplete="off" aria-label="End time" value="' + P.formatTime(r.e) + '">' +
        '<span class="len num">' + dur(r.e - r.s) + "</span>" +
        '<button type="button" class="icon-btn" data-act="rm" aria-label="Remove this range" title="Remove">' + icon("trash-2") + "</button>" +
      "</div></li>";
  }

  function renderPanel() {
    var panel = $("panel"), ep = cur();
    if (!ep) {
      panel.innerHTML = '<div class="empty">Paste a skip list above, or <button type="button" class="btn small" data-act="example">' + icon("sparkles") + "Load example</button></div>";
      return;
    }
    var b = bufferOf(ep), g = parsed.globals;
    var skipRows = ep.ranges.filter(function (r) { return r.sec === "skip"; }).map(rowHtml).join("");
    var otherRows = ep.ranges.filter(function (r) { return r.sec === "other"; }).map(rowHtml).join("");
    var m = match[ep.index];
    var ph = function (own, glob) { return own === null && glob !== null ? num(glob) : "0"; };

    panel.innerHTML =
      '<div class="ep-head"><div><h3>' + esc(ep.title || ep.label) + "</h3>" +
        "<p>" + (m ? "File: " + esc(m.name) : "No file matched yet. You can type the file name below.") + "</p></div></div>" +

      '<div class="grid3">' +
        '<label class="f">Buffer before (s)<input data-q="before" type="text" inputmode="decimal" autocomplete="off" value="' + (ep.before !== null ? num(ep.before) : "") + '" placeholder="' + ph(ep.before, g.before) + '"></label>' +
        '<label class="f">Buffer after (s)<input data-q="after" type="text" inputmode="decimal" autocomplete="off" value="' + (ep.after !== null ? num(ep.after) : "") + '" placeholder="' + ph(ep.after, g.after) + '"></label>' +
        '<label class="f">Runtime (m:ss)<input data-q="runtime" type="text" inputmode="decimal" autocomplete="off" value="' + (ep.runtime ? P.formatClock(ep.runtime) : "") + '" placeholder="optional"></label>' +
      "</div>" +

      '<div class="tl" id="tlBox"></div>' +

      '<p class="hint">Ticked ranges are cut from the playlist. Edit a time and press Enter or leave the box.</p>' +
      '<h3 class="grp">Skip</h3><ul class="rows" id="rowsSkip">' + skipRows + "</ul>" +
      '<h3 class="grp">Others (left in unless ticked)</h3><ul class="rows" id="rowsOther">' + otherRows + "</ul>" +

      '<details class="add"><summary>Add a range</summary><div class="add-form">' +
        '<label class="f wide">Note<input id="addNote" type="text" autocomplete="off" placeholder="Romantic scene (Low)"></label>' +
        '<label class="f">Start<input id="addS" type="text" inputmode="decimal" autocomplete="off" placeholder="3:30.9"></label>' +
        '<label class="f">End<input id="addE" type="text" inputmode="decimal" autocomplete="off" placeholder="3:52.1"></label>' +
        '<label class="f">List<select id="addSec"><option value="skip">Skip</option><option value="other">Others</option></select></label>' +
        '<div><button type="button" class="btn small" data-act="add">' + icon("plus") + "Add range</button></div>" +
        '<p class="msg wide" id="addMsg" role="status"></p>' +
      "</div></details>" +

      '<div class="out">' +
        "<h3>VLC playlist</h3>" +
        '<div class="out-fields">' +
          '<label class="f">Video file name<input data-q="video" type="text" autocomplete="off" spellcheck="false" value="' + esc(videoFor(ep)) + '" placeholder="Episode.mkv"></label>' +
          '<label class="f">Playlist file name<input data-q="pl" type="text" autocomplete="off" spellcheck="false" value="' + esc(plFor(ep)) + '"></label>' +
        "</div>" +
        '<p class="sum" id="sum"></p><p class="pill" id="warn" hidden></p>' +
        '<label class="sr-only" for="m3u">Playlist text</label>' +
        '<textarea id="m3u" class="code" rows="8" readonly spellcheck="false"></textarea>' +
        '<div class="actions">' +
          '<button type="button" class="btn primary" data-act="dl">' + icon("file-down") + "Download .m3u</button>" +
          '<button type="button" class="btn" data-act="copym3u">' + icon("copy") + "Copy text</button>" +
          '<button type="button" class="btn" data-act="zip">' + icon("package") + "Download all episodes (.zip)</button>" +
          '<span class="msg" id="outMsg" role="status"></span>' +
        "</div>" +
        '<p class="hint">Save the playlist in the same folder as the video, then open it in VLC. Press N for the next part, P for the previous one.</p>' +
      "</div>";

    updateDerived();
  }

  function timelineHtml(ep, res) {
    var maxEnd = 0;
    ep.ranges.forEach(function (r) { maxEnd = Math.max(maxEnd, r.e); });
    res.merged.forEach(function (m) { if (isFinite(m.e)) maxEnd = Math.max(maxEnd, m.e); });
    var tot = ep.runtime || Math.ceil((maxEnd + 180) / 60) * 60;
    var info = "Skips <b class=\"num\">" + P.formatClock(res.skipped) + "</b> in " + res.merged.length + (res.merged.length === 1 ? " cut" : " cuts");
    info += ep.runtime ? ". Plays <b class=\"num\">" + P.formatClock(Math.max(0, tot - res.skipped)) + "</b> of " + P.formatClock(tot) + "." : ". Add a runtime for exact figures.";

    var cuts = res.merged.map(function (m) {
      var l = Math.min(100, m.s / tot * 100), w = Math.max(0.4, Math.min(100 - l, (Math.min(m.e, tot) - m.s) / tot * 100));
      return '<span class="tl-cut" style="left:' + l.toFixed(2) + "%;width:" + w.toFixed(2) + '%"></span>';
    }).join("");

    var steps = [60, 120, 300, 600, 900, 1800, 3600], step = 3600, i;
    for (i = 0; i < steps.length; i++) if (tot / steps[i] <= 6) { step = steps[i]; break; }
    var ticks = "";
    for (var t = 0; t <= tot * (ep.runtime ? 0.88 : 0.98); t += step) {
      ticks += '<span class="tl-tick' + (t === 0 ? " first" : "") + '" style="left:' + (t / tot * 100).toFixed(2) + '%">' + P.formatClock(t) + "</span>";
    }
    if (ep.runtime) ticks += '<span class="tl-tick last" style="left:100%">' + P.formatClock(tot) + "</span>";

    return '<p class="tl-info">' + info + "</p>" +
      '<div class="tl-stage" role="img" aria-label="Timeline of the episode with cut ranges marked"><div class="tl-track"></div>' + cuts + ticks + "</div>" +
      '<p class="legend"><span><i class="c"></i>Cut</span><span><i class="k"></i>Plays</span></p>';
  }

  /** Recomputes everything that depends on ticks and times, without touching the rows (keeps focus). */
  function updateDerived() {
    var ep = cur();
    renderTabs();
    if (!ep || !$("tlBox")) return;
    var res = compute(ep);
    $("tlBox").innerHTML = timelineHtml(ep, res);
    $("m3u").value = m3uFor(ep, res);
    var n = res.parts.length;
    $("sum").textContent = n + (n === 1 ? " part" : " parts") + " in the playlist, " + res.cutCount + " ticked " + (res.cutCount === 1 ? "range" : "ranges") + ".";
    var warn = $("warn"), msgs = [];
    if (!videoFor(ep)) msgs.push("Add the video file name so VLC can find the file.");
    if (!res.cutCount) msgs.push("Nothing is ticked, so the playlist plays the whole file.");
    warn.hidden = !msgs.length;
    warn.innerHTML = msgs.length ? icon("circle-alert") + "<span>" + esc(msgs.join(" ")) + "</span>" : "";
    icons();
  }

  function renderAll() {
    reparse();
    renderProblems();
    renderFiles();
    renderTabs();
    renderPanel();
    icons();
    save();
  }

  /* ---------- panel events ---------- */
  function onPanelClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var act = btn.getAttribute("data-act"), ep = cur();
    if (act === "example") { loadExample(); return; }
    if (!ep) return;
    if (act === "rm") {
      var row = btn.closest(".row");
      setText(P.removeRange(state.text, parseInt(row.getAttribute("data-line"), 10)));
      renderAll();
      return;
    }
    if (act === "add") {
      var s = P.parseTime($("addS").value), en = P.parseTime($("addE").value), msg = $("addMsg");
      if (!(isFinite(s) && isFinite(en) && s < en)) { msg.textContent = "Enter a start and an end time, with the end after the start."; return; }
      var sec = $("addSec").value, note = $("addNote").value.trim() || "Range";
      setText(P.addRange(state.text, ep.index, { s: s, e: en, desc: note, sec: sec }));
      renderAll();
      var d = document.querySelector("details.add"); if (d) d.open = true;
      return;
    }
    if (act === "dl") {
      var res = compute(ep);
      download(plFor(ep), m3uFor(ep, res), "audio/x-mpegurl");
      setMsg($("outMsg"), "Downloaded " + plFor(ep));
      return;
    }
    if (act === "copym3u") { copyText($("m3u").value, $("outMsg")); return; }
    if (act === "zip") {
      var used = {}, files = parsed.episodes.map(function (x) {
        var name = plFor(x), base = name.replace(/\.m3u8?$/i, ""), n = 1;
        while (used[name.toLowerCase()]) { n++; name = base + "_" + n + ".m3u"; }
        used[name.toLowerCase()] = true;
        return { name: name, text: m3uFor(x, compute(x)) };
      });
      download("skip-playlists.zip", L.makeZip(files), "application/zip");
      setMsg($("outMsg"), "Downloaded " + files.length + (files.length === 1 ? " playlist." : " playlists."));
    }
  }

  function onPanelInput(e) {
    var el = e.target;
    if (el.classList.contains("t")) {
      var row = el.closest(".row"), ins = row.querySelectorAll(".t");
      var s = P.parseTime(ins[0].value), en = P.parseTime(ins[1].value), ok = isFinite(s) && isFinite(en) && s < en;
      ins[0].classList.toggle("bad", !ok); ins[1].classList.toggle("bad", !ok);
      var len = row.querySelector(".len");
      len.classList.toggle("bad", !ok);
      len.textContent = ok ? dur(en - s) : "check times";
    }
  }

  function onPanelChange(e) {
    var el = e.target, ep = cur();
    if (!ep) return;
    var act = el.getAttribute("data-act"), q = el.getAttribute("data-q");

    if (act === "cut") {
      var key = el.closest(".row").getAttribute("data-key");
      state.ov[key] = el.checked;
      save(); updateDerived();
      return;
    }
    if (act === "s" || act === "e") {
      var row = el.closest(".row"), ins = row.querySelectorAll(".t");
      var s = P.parseTime(ins[0].value), en = P.parseTime(ins[1].value);
      if (!(isFinite(s) && isFinite(en) && s < en)) return;
      setText(P.updateRange(state.text, parseInt(row.getAttribute("data-line"), 10), s, en));
      ins[0].value = P.formatTime(s); ins[1].value = P.formatTime(en);
      row.querySelector(".len").textContent = dur(en - s);
      updateDerived();
      return;
    }
    if (q === "before" || q === "after") {
      var v = numOrNull(el.value);
      if (v === undefined) { el.value = ep[q] !== null ? num(ep[q]) : ""; return; }
      var edits = {}; edits[q] = v;
      setText(P.editHeader(state.text, ep.index, edits));
      updateDerived();
      return;
    }
    if (q === "runtime") {
      var t = el.value.trim() === "" ? null : P.parseTime(el.value);
      if (t !== null && !(isFinite(t) && t > 0)) { el.value = ep.runtime ? P.formatClock(ep.runtime) : ""; return; }
      setText(P.editHeader(state.text, ep.index, { runtime: t }));
      el.value = t ? P.formatClock(t) : "";
      updateDerived();
      return;
    }
    if (q === "video") {
      setText(P.editHeader(state.text, ep.index, { video: el.value.trim() }));
      updateDerived();
      return;
    }
    if (q === "pl") {
      var k = epKey(ep), val = el.value.trim();
      if (val) { state.epx[k] = state.epx[k] || {}; state.epx[k].pl = L.safeName(val, "playlist.m3u"); }
      else delete state.epx[k];
      el.value = plFor(ep);
      save();
    }
  }

  /* ---------- settings dialog ---------- */
  function openSettings() {
    var dlg = $("settings"), ep = cur(), g = parsed.globals;
    var first = parsed.episodes[0];
    $("setShow").value = first ? first.show : "";
    $("setBF").value = g.before !== null ? num(g.before) : "";
    $("setAF").value = g.after !== null ? num(g.after) : "";
    $("setGap").value = num(state.settings.gap);
    $("setPattern").value = state.settings.pattern;
    $("epFields").hidden = !ep;
    if (ep) {
      $("epLegend").textContent = "This episode: " + ep.label;
      $("setCode").value = ep.code;
      $("setName").value = ep.name;
      $("setRun").value = ep.runtime ? P.formatClock(ep.runtime) : "";
      $("setPl").value = plFor(ep);
      $("setPl").setAttribute("data-init", plFor(ep));
      $("setVideo").value = videoFor(ep);
    }
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  function closeSettings() {
    var dlg = $("settings");
    if (dlg.close) dlg.close(); else dlg.removeAttribute("open");
  }
  function applySettings() {
    var text = state.text, p = P.parseList(text), ep = p.episodes[state.sel];
    var showV = $("setShow").value.trim();

    if (ep) {
      var edits = {}, code = $("setCode").value.trim().toUpperCase(), name = $("setName").value.trim();
      if (code !== ep.code || name !== ep.name) edits.title = P.joinTitle(showV || ep.show, code, name);
      var rv = $("setRun").value.trim();
      if (rv === "") { if (ep.runtime) edits.runtime = null; }
      else { var rt = P.parseTime(rv); if (isFinite(rt) && rt > 0 && rt !== ep.runtime) edits.runtime = rt; }
      var vv = $("setVideo").value.trim();
      if (vv !== (ep.video || "") && vv !== (match[ep.index] ? match[ep.index].name : "")) edits.video = vv;
      if (Object.keys(edits).length) text = P.editHeader(text, ep.index, edits);
    }

    var g = P.parseList(text).globals;
    var bf = numOrNull($("setBF").value), af = numOrNull($("setAF").value);
    if (bf === undefined) bf = g.before;
    if (af === undefined) af = g.after;
    if (bf !== g.before || af !== g.after) text = P.editHeader(text, -1, { before: bf, after: af });

    var p3 = P.parseList(text);
    if (showV && p3.episodes.some(function (x) { return x.show !== showV; })) text = P.setShow(text, showV);

    var gap = parseFloat($("setGap").value);
    if (isFinite(gap) && gap >= 0) state.settings.gap = gap;
    var pat = $("setPattern").value.trim();
    if (pat) state.settings.pattern = pat;

    state.text = text; $("src").value = text;
    reparse();
    var ep2 = cur();
    if (ep2) {
      var k = epKey(ep2), pl = $("setPl").value.trim(), auto = L.playlistName(state.settings.pattern, { code: ep2.code || ("ep" + (ep2.index + 1)), show: ep2.show, name: ep2.name });
      var init = $("setPl").getAttribute("data-init");
      if (pl === init) { /* untouched: keep the current override or the pattern */ }
      else if (pl && L.safeName(pl) !== auto) { state.epx[k] = state.epx[k] || {}; state.epx[k].pl = L.safeName(pl, "playlist.m3u"); }
      else delete state.epx[k];
    }
    closeSettings();
    renderAll();
  }

  function resetAll() {
    if (!window.confirm("Remove your list, file names and settings from this browser?")) return;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    var theme = state.theme;
    state = { text: "", files: "", sel: 0, ov: {}, epx: {}, theme: theme, settings: { gap: 2, pattern: "{code}_clean.m3u", criteria: PR.DEFAULTS.criteria, keep: PR.DEFAULTS.keep } };
    $("src").value = ""; $("files").value = "";
    $("criteria").value = state.settings.criteria; $("keep").value = state.settings.keep;
    updatePrompt();
    closeSettings();
    renderAll();
  }

  /* ---------- top-level actions ---------- */
  function loadExample() {
    state.text = EXAMPLE_TEXT; state.files = EXAMPLE_FILES; state.ov = {}; state.sel = 0;
    $("src").value = state.text; $("files").value = state.files;
    renderAll();
  }
  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function paintTheme() {
    var btn = $("themeBtn");
    btn.innerHTML = icon(isDark() ? "sun" : "moon");
    icons();
  }
  function toggleTheme() {
    state.theme = isDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    paintTheme(); save();
  }
  function focusTarget(id) {
    var t = $(id);
    if (!t) return;
    t.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    t.focus({ preventScroll: true });
    t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
    setTimeout(function () { t.classList.remove("flash"); }, 1500);
  }
  function debounce(fn, ms) {
    var t = 0;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* ---------- start ---------- */
  function init() {
    load();
    if (state.theme) document.documentElement.setAttribute("data-theme", state.theme);
    $("criteria").value = state.settings.criteria;
    $("keep").value = state.settings.keep;
    $("src").value = state.text;
    $("files").value = state.files;
    updatePrompt();
    paintTheme();

    $("criteria").addEventListener("input", updatePrompt);
    $("keep").addEventListener("input", updatePrompt);
    $("copyPrompt").addEventListener("click", function () { copyText($("promptText").value, $("promptMsg")); });

    var onSrc = debounce(function () { state.text = $("src").value; renderAll(); }, 250);
    $("src").addEventListener("input", onSrc);
    var onFiles = debounce(function () { state.files = $("files").value; renderAll(); }, 250);
    $("files").addEventListener("input", onFiles);

    $("loadExample").addEventListener("click", loadExample);
    $("clearAll").addEventListener("click", function () {
      if (state.text && !window.confirm("Clear the list and all ticks?")) return;
      state.text = ""; state.ov = {}; state.sel = 0; $("src").value = ""; renderAll();
    });
    $("importBtn").addEventListener("click", function () { $("importFile").click(); });
    $("importFile").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { state.text = String(reader.result || ""); state.ov = {}; state.sel = 0; $("src").value = state.text; renderAll(); };
      reader.readAsText(f);
      e.target.value = "";
    });

    $("tabs").addEventListener("click", function (e) {
      var b = e.target.closest(".tab");
      if (!b) return;
      state.sel = parseInt(b.getAttribute("data-i"), 10);
      renderAll();
    });
    var panel = $("panel");
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("input", onPanelInput);
    panel.addEventListener("change", onPanelChange);
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.matches("input.t, input[data-q]")) { e.preventDefault(); e.target.blur(); }
    });

    $("themeBtn").addEventListener("click", toggleTheme);
    $("openSettings").addEventListener("click", openSettings);
    $("closeSettings").addEventListener("click", closeSettings);
    $("cancelSettings").addEventListener("click", closeSettings);
    $("resetAll").addEventListener("click", resetAll);
    $("settingsForm").addEventListener("submit", function (e) { e.preventDefault(); applySettings(); });
    $("settings").addEventListener("click", function (e) { if (e.target === $("settings")) closeSettings(); });

    document.addEventListener("click", function (e) {
      var a = e.target.closest("a[data-focus]");
      if (!a) return;
      e.preventDefault();
      focusTarget(a.getAttribute("data-focus"));
    });

    renderAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
