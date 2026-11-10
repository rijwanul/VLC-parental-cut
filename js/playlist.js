/*
 * VLC Parental Cut: turns skip ranges into VLC playlist parts, builds the .m3u text and packs files into a zip.
 * Plain script. Browser: window.SPB.playlist. Node: require().
 */
(function (root) {
  "use strict";

  var P = typeof module !== "undefined" && module.exports ? require("./parser") : root.SPB.parser;

  /**
   * ranges: [{s, e}] in seconds, exactly as listed (no buffer).
   * opts: { before, after, run, gap }. Ranges closer than `gap` seconds are merged, and parts shorter than `gap` are dropped.
   * Returns { merged, parts, skipped } where parts are the stretches that still play. The last part has e = null (plays to the end).
   */
  function computeParts(ranges, opts) {
    var before = Math.max(0, opts.before || 0), after = Math.max(0, opts.after || 0);
    var run = opts.run, gap = opts.gap === undefined ? 2 : opts.gap;
    var act = ranges.map(function (r) {
      return { s: Math.max(0, r.s - before), e: Math.min(run, r.e + after) };
    }).filter(function (r) { return r.e > r.s; });
    act.sort(function (a, b) { return a.s - b.s; });

    var merged = [];
    act.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r.s - last.e < gap) { if (r.e > last.e) last.e = r.e; }
      else merged.push({ s: r.s, e: r.e });
    });

    var parts = [], pos = 0;
    merged.forEach(function (m) {
      if (m.s - pos >= gap) parts.push({ s: pos, e: m.s });
      pos = m.e;
    });
    if (run - pos >= gap) parts.push({ s: pos, e: null });

    var skipped = merged.reduce(function (a, m) { return a + (m.e - m.s); }, 0);
    return { merged: merged, parts: parts, skipped: skipped };
  }

  /** The .m3u text for VLC. */
  function buildM3U(parts, opts) {
    var video = (opts.video || "").trim() || "VIDEO_FILE_NAME.mkv", label = opts.label || "Part";
    var out = ["#EXTM3U"];
    parts.forEach(function (p, i) {
      out.push("#EXTINF:-1," + label + " part " + (i + 1) + " (" + P.formatClock(p.s) + " - " + (p.e === null ? "end" : P.formatClock(p.e)) + ")");
      out.push("#EXTVLCOPT:start-time=" + p.s.toFixed(1));
      if (p.e !== null) out.push("#EXTVLCOPT:stop-time=" + p.e.toFixed(1));
      out.push(video);
    });
    return out.join("\n") + "\n";
  }

  /** Replaces characters Windows does not allow in file names. */
  function safeName(name, fallback) {
    var n = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim();
    return n || fallback || "playlist.m3u";
  }

  /** Playlist file name from a pattern such as "{code}_clean.m3u". */
  function playlistName(pattern, vars) {
    var n = String(pattern || "{code}_clean.m3u").replace(/\{(code|show|name)\}/g, function (_, k) { return (vars[k] || "").replace(/\s+/g, "_"); });
    n = n.replace(/^[_\-\s]+/, "");
    n = safeName(n, "playlist.m3u");
    if (!/\.m3u8?$/i.test(n)) n += ".m3u";
    return n;
  }

  /* ---------- zip (stored, UTF-8 names) ---------- */
  var CRC = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /** files: [{name, text}] to a Uint8Array holding a .zip. */
  function makeZip(files) {
    var enc = new TextEncoder(), items = files.map(function (f) {
      var nb = enc.encode(f.name), db = enc.encode(f.text);
      return { nb: nb, db: db, crc: crc32(db), off: 0 };
    });
    var size = 22;
    items.forEach(function (it) { size += 30 + it.nb.length + it.db.length + 46 + it.nb.length; });
    var buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf), o = 0;
    var now = new Date(), date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    function w16(v) { dv.setUint16(o, v, true); o += 2; }
    function w32(v) { dv.setUint32(o, v, true); o += 4; }

    items.forEach(function (it) {
      it.off = o;
      w32(0x04034b50); w16(20); w16(0x0800); w16(0); w16(0); w16(date);
      w32(it.crc); w32(it.db.length); w32(it.db.length); w16(it.nb.length); w16(0);
      u8.set(it.nb, o); o += it.nb.length; u8.set(it.db, o); o += it.db.length;
    });
    var cd = o;
    items.forEach(function (it) {
      w32(0x02014b50); w16(20); w16(20); w16(0x0800); w16(0); w16(0); w16(date);
      w32(it.crc); w32(it.db.length); w32(it.db.length); w16(it.nb.length);
      w16(0); w16(0); w16(0); w16(0); w32(0); w32(it.off);
      u8.set(it.nb, o); o += it.nb.length;
    });
    var cdSize = o - cd;
    w32(0x06054b50); w16(0); w16(0); w16(items.length); w16(items.length); w32(cdSize); w32(cd); w16(0);
    return u8;
  }

  var api = { computeParts: computeParts, buildM3U: buildM3U, safeName: safeName, playlistName: playlistName, makeZip: makeZip };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.SPB = root.SPB || {}; root.SPB.playlist = api; }
})(typeof window !== "undefined" ? window : this);
