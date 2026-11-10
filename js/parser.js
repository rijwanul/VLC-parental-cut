/*
 * VLC Parental Cut: list parser, folder-listing matcher and text editing helpers.
 * Plain script (no build step). Works in the browser as window.SPB.parser and in Node via require().
 */
(function (root) {
  "use strict";

  var T = "\\d+(?::\\d{1,2}){0,2}(?:\\.\\d+)?";
  var RANGE_RE = new RegExp("^([\\s*\\u2022\\-\\u2013]*)(" + T + ")\\s*(?:-|\\u2013|\\u2014|\\u2192|to)\\s*(" + T + ")\\s*(?::\\s*(.*))?$", "i");
  var SKIP_HEAD = /^(skips?|cuts?)\s*[-:–]?\s*$/i;
  var OTHER_HEAD = /^(others?|optional|left in|keep|maybe)\s*[-:–]?\s*$/i;
  var VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|webm|ts|m2ts|mpg|mpeg|flv)$/i;

  /** "3:30.9", "1:02:03" or "210.9" to seconds. NaN when it cannot be read. */
  function parseTime(str) {
    str = String(str).trim();
    if (!str) return NaN;
    if (str.indexOf(":") >= 0) {
      var p = str.split(":");
      if (p.length > 3) return NaN;
      var v = 0;
      for (var i = 0; i < p.length; i++) {
        if (p[i].trim() === "") return NaN;
        var n = Number(p[i]);
        if (!isFinite(n) || n < 0) return NaN;
        v = v * 60 + n;
      }
      return v;
    }
    var x = Number(str);
    return isFinite(x) && x >= 0 ? x : NaN;
  }

  /** Seconds to "m:ss.s" (or "h:mm:ss.s"). */
  function formatTime(t) {
    var h = Math.floor(t / 3600), m = Math.floor((t - h * 3600) / 60), s = t - h * 3600 - m * 60;
    var txt = s.toFixed(1);
    if (parseFloat(txt) >= 60) { txt = "0.0"; m += 1; if (m >= 60) { m = 0; h += 1; } }
    if (parseFloat(txt) < 10) txt = "0" + txt;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + txt : m + ":" + txt;
  }

  /** Seconds to a whole-second clock, "m:ss" or "h:mm:ss". */
  function formatClock(t) {
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var ss = (s < 10 ? "0" : "") + s;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }

  function secondsText(n) { return String(+Number(n).toFixed(2)) + "s"; }

  /** Episode code like "S02E05" from a title or file name, or "". Understands 2x05 too. */
  function episodeCode(text) {
    var m = String(text).match(/S(\d{1,3})[ ._-]*E(\d{1,3})/i);
    if (m) return "S" + pad2(m[1]) + "E" + pad2(m[2]);
    m = String(text).match(/(?:^|[^0-9a-z])(\d{1,2})x(\d{2,3})(?![0-9a-z])/i);
    if (m) return "S" + pad2(m[1]) + "E" + pad2(m[2]);
    return "";
  }
  function pad2(n) { n = String(parseInt(n, 10)); return n.length < 2 ? "0" + n : n; }

  /** Splits "Show - S02E05 (Episode name)" into its parts. */
  function splitTitle(title) {
    var t = String(title || "").trim();
    var m = t.match(/^(.*?)\s*[-–—]\s*(S\d+E\d+)\b\s*(?:\((.*)\))?\s*$/i);
    if (m) return { show: m[1].trim(), code: episodeCode(m[2]), name: (m[3] || "").trim() };
    var code = episodeCode(t);
    var name = "", mm = t.match(/\(([^()]*)\)\s*$/);
    if (mm) name = mm[1].trim();
    return { show: code ? "" : t, code: code, name: name };
  }

  function joinTitle(show, code, name) {
    var out = show || "";
    if (code) out += (out ? " - " : "") + code;
    if (name) out += (out ? " " : "") + "(" + name + ")";
    return out || "Untitled";
  }

  function newEpisode(index, start) {
    return {
      index: index, start: start, lastLine: start, headEnd: start - 1,
      titleLine: -1, title: "", show: "", code: "", name: "",
      runtime: null, runtimeLine: -1, before: null, after: null, bufferLines: [],
      video: "", videoLine: -1, skipHeaderLine: -1, otherHeaderLine: -1, ranges: []
    };
  }

  /** Reads the pasted list. */
  function parseList(text) {
    var lines = String(text).split(/\r?\n/);
    var globals = { before: null, after: null, bufferLines: [], start: 0, headEnd: -1 };
    var episodes = [], bad = [], cur = null, sec = "skip";

    function touch(i) { if (cur) cur.lastLine = i; }

    lines.forEach(function (raw, i) {
      var line = raw.trim(), m;
      if (!line) return;

      if (/^buffer/i.test(line)) {
        var ci = line.indexOf(":"), n = ci < 0 ? NaN : parseFloat(line.slice(ci + 1));
        if (!isFinite(n) || n < 0) { bad.push({ n: i + 1, text: line }); return; }
        var w = line.slice(0, ci).toLowerCase(), hb = /before/.test(w), ha = /after/.test(w);
        var target = cur || globals;
        if (hb && !ha) target.before = n; else if (ha && !hb) target.after = n; else { target.before = n; target.after = n; }
        target.bufferLines.push(i); target.headEnd = Math.max(target.headEnd, i); touch(i);
        return;
      }
      if ((m = line.match(/^runtime\s*:\s*(.+)$/i))) {
        var rt = parseTime(m[1]);
        if (!(isFinite(rt) && rt > 0) || !cur) { bad.push({ n: i + 1, text: line }); return; }
        cur.runtime = rt; cur.runtimeLine = i; cur.headEnd = Math.max(cur.headEnd, i); touch(i);
        return;
      }
      if ((m = line.match(/^(?:video|file)\s*:\s*(.+)$/i))) {
        if (!cur) { bad.push({ n: i + 1, text: line }); return; }
        cur.video = m[1].trim(); cur.videoLine = i; cur.headEnd = Math.max(cur.headEnd, i); touch(i);
        return;
      }
      if (SKIP_HEAD.test(line)) { sec = "skip"; if (cur) { if (cur.skipHeaderLine < 0) cur.skipHeaderLine = i; touch(i); } return; }
      if (OTHER_HEAD.test(line)) { sec = "other"; if (cur) { if (cur.otherHeaderLine < 0) cur.otherHeaderLine = i; touch(i); } return; }

      if ((m = line.match(RANGE_RE))) {
        var s = parseTime(m[2]), e = parseTime(m[3]);
        if (!(isFinite(s) && isFinite(e) && s < e)) { bad.push({ n: i + 1, text: line }); return; }
        if (!cur) { cur = newEpisode(episodes.length, i); episodes.push(cur); sec = "skip"; }
        var rawDesc = (m[4] || "").trim(), d = rawDesc, lv = null, tags = [];
        var mm = d.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
        if (mm) {
          d = mm[1].trim();
          var parts = mm[2].split(",").map(function (x) { return x.trim(); }).filter(Boolean);
          if (parts.length && /^(low|mid|medium|high)$/i.test(parts[0])) {
            var l = parts.shift().toLowerCase(); lv = l === "medium" ? "mid" : l;
          }
          tags = parts;
        }
        cur.ranges.push({ line: i, sec: sec, s: s, e: e, desc: d || "Range", rawDesc: rawDesc, lv: lv, tags: tags });
        touch(i);
        return;
      }

      var isTitle = !/^[*•\-–]/.test(line) && (/:\s*$/.test(line) || episodeCode(line) || (!cur && episodes.length === 0));
      if (isTitle) {
        cur = newEpisode(episodes.length, i); episodes.push(cur); sec = "skip";
        cur.titleLine = i; cur.headEnd = i;
        cur.title = line.replace(/:\s*$/, "");
        var sp = splitTitle(cur.title); cur.show = sp.show; cur.code = sp.code; cur.name = sp.name;
        return;
      }
      bad.push({ n: i + 1, text: line });
    });

    var seen = {};
    episodes.forEach(function (ep) {
      if (!ep.code) ep.code = "";
      ep.label = ep.code || ("Episode " + (ep.index + 1));
      ep.ranges.forEach(function (r) {
        var k = ep.index + "|" + r.sec + "|" + r.desc;
        seen[k] = (seen[k] || 0) + 1;
        r.key = k + "|" + seen[k];
      });
    });
    return { lines: lines, globals: globals, episodes: episodes, bad: bad };
  }

  /* ---------- folder listings ---------- */

  /** Reads a pasted folder listing (dir /b, tree /f, ls) into file names with episode codes. */
  function parseFileList(text) {
    var names = String(text).split(/\r?\n/).map(function (l) {
      return l.replace(/^[\s│├└─┬┌┐┘┴┼|+\\`\-]+/, "").trim();
    }).filter(Boolean);
    var vids = names.filter(function (n) { return VIDEO_EXT.test(n); });
    if (!vids.length) vids = names.filter(function (n) { return episodeCode(n); });
    return vids.map(function (n) { return { name: n, code: episodeCode(n) }; });
  }

  /** Maps episode index to the file whose code matches. */
  function matchFiles(episodes, files) {
    var out = {};
    episodes.forEach(function (ep) {
      if (!ep.code) return;
      var hits = files.filter(function (f) { return f.code === ep.code; });
      if (hits.length) out[ep.index] = { name: hits[0].name, count: hits.length };
    });
    return out;
  }

  /* ---------- editing the pasted text ---------- */

  function rebuild(lines, del, repl, anchor, inserts) {
    var out = [];
    if (anchor === -1) Array.prototype.push.apply(out, inserts);
    lines.forEach(function (l, i) {
      if (!del[i]) out.push(repl[i] !== undefined ? repl[i] : l);
      if (i === anchor) Array.prototype.push.apply(out, inserts);
    });
    return out.join("\n");
  }

  function target(parsed, epIndex) { return epIndex < 0 ? parsed.globals : parsed.episodes[epIndex]; }

  /**
   * Changes header values for one episode (epIndex >= 0) or for the list defaults (epIndex -1).
   * edits: { title, runtime (seconds or null), before, after, video } with only the keys you want to change.
   */
  function editHeader(text, epIndex, edits) {
    var parsed = parseList(text), ep = target(parsed, epIndex);
    if (!ep) return text;
    var lines = parsed.lines.slice(), del = {}, repl = {}, ins = [];
    var anchor = epIndex < 0 ? -1 : (ep.titleLine >= 0 ? ep.titleLine : ep.start - 1);

    if (epIndex >= 0 && "title" in edits) {
      var t = String(edits.title || "").trim();
      if (ep.titleLine >= 0) repl[ep.titleLine] = t + ":";
      else ins.push(t + ":");
    }
    if (epIndex >= 0 && "runtime" in edits) {
      var line = edits.runtime ? "Runtime: " + formatClock(edits.runtime) : null;
      if (ep.runtimeLine >= 0) { if (line) repl[ep.runtimeLine] = line; else del[ep.runtimeLine] = true; }
      else if (line) ins.push(line);
    }
    if ("before" in edits || "after" in edits) {
      var b = "before" in edits ? edits.before : ep.before, a = "after" in edits ? edits.after : ep.after;
      ep.bufferLines.forEach(function (i) { del[i] = true; });
      if (b !== null && a !== null && b === a) ins.push("Buffer before and after: " + secondsText(b));
      else { if (b !== null) ins.push("Buffer before: " + secondsText(b)); if (a !== null) ins.push("Buffer after: " + secondsText(a)); }
    }
    if (epIndex >= 0 && "video" in edits) {
      var v = String(edits.video || "").trim();
      if (ep.videoLine >= 0) { if (v) repl[ep.videoLine] = "Video: " + v; else del[ep.videoLine] = true; }
      else if (v) ins.push("Video: " + v);
    }
    return rebuild(lines, del, repl, anchor, ins);
  }

  /** Replaces the show name in every episode title. */
  function setShow(text, show) {
    var parsed = parseList(text), lines = parsed.lines.slice();
    show = String(show || "").trim();
    parsed.episodes.forEach(function (ep) {
      if (ep.titleLine < 0) return;
      var sp = splitTitle(ep.title);
      lines[ep.titleLine] = (sp.code ? joinTitle(show, sp.code, sp.name) : (show + (ep.title && ep.title !== sp.show ? " - " + ep.title : ""))) + ":";
    });
    return lines.join("\n");
  }

  function rangeLine(s, e, rawDesc) {
    return "* " + formatTime(s) + "-" + formatTime(e) + (rawDesc ? ": " + rawDesc : "");
  }

  /** Adds a range to an episode. sec is "skip" or "other". */
  function addRange(text, epIndex, range) {
    var parsed = parseList(text), ep = parsed.episodes[epIndex];
    if (!ep) return text;
    var lines = parsed.lines.slice(), note = String(range.desc || "").trim() || "Range";
    var newLine = rangeLine(range.s, range.e, note);
    var secRanges = ep.ranges.filter(function (r) { return r.sec === range.sec; });
    var del = {}, repl = {}, ins, anchor;
    if (secRanges.length) {
      anchor = Math.max.apply(null, secRanges.map(function (r) { return r.line; })); ins = [newLine];
    } else if (range.sec === "skip") {
      anchor = ep.headEnd; ins = ["", "Skip-", newLine];
    } else {
      anchor = ep.otherHeaderLine >= 0 ? ep.otherHeaderLine : ep.lastLine;
      ins = ep.otherHeaderLine >= 0 ? [newLine] : ["", "Others-", newLine];
    }
    return rebuild(lines, del, repl, anchor, ins);
  }

  /** Removes one range line. */
  function removeRange(text, lineIndex) {
    var lines = String(text).split(/\r?\n/);
    if (lineIndex < 0 || lineIndex >= lines.length) return text;
    lines.splice(lineIndex, 1);
    return lines.join("\n");
  }

  /** Rewrites the times of one range line, keeping its note. */
  function updateRange(text, lineIndex, s, e) {
    var lines = String(text).split(/\r?\n/), m = lines[lineIndex] && lines[lineIndex].trim().match(RANGE_RE);
    if (!m) return text;
    lines[lineIndex] = rangeLine(s, e, (m[4] || "").trim());
    return lines.join("\n");
  }

  var api = {
    parseTime: parseTime, formatTime: formatTime, formatClock: formatClock, episodeCode: episodeCode,
    splitTitle: splitTitle, joinTitle: joinTitle, parseList: parseList, parseFileList: parseFileList, matchFiles: matchFiles,
    editHeader: editHeader, setShow: setShow, addRange: addRange, removeRange: removeRange, updateRange: updateRange
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.SPB = root.SPB || {}; root.SPB.parser = api; }
})(typeof window !== "undefined" ? window : this);
