/* Run with: node tests/run.js  (no dependencies) */
"use strict";
var assert = require("assert");
var P = require("../js/parser");
var L = require("../js/playlist");
var Q = require("../js/prompt");

var passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { console.error("FAIL " + name + "\n     " + e.message); process.exitCode = 1; }
}

var SAMPLE = [
  "Example Show - S01E02 (Second Episode):",
  "Runtime: 24:10",
  "Buffer before and after: 1s",
  "",
  "Skip-",
  "* 3:30.9-3:52.1: Pregnancy talk between friends. (Mid, pregnancy talk)",
  "* 5:54.1-6:08.5: Double-meaning lines. (Low, double meaning)",
  "",
  "Others-",
  "* 0:33.0-0:40.5: One mild joke.",
  "",
  "Example Show - S01E03 (Third):",
  "Skip-",
  "* 1:00-1:30: Something. (High, explicit, tag two)"
].join("\n");

test("parseTime accepts m:ss.s, h:mm:ss and seconds", function () {
  assert.strictEqual(P.parseTime("3:30.9"), 210.9);
  assert.strictEqual(P.parseTime("1:02:03"), 3723);
  assert.strictEqual(P.parseTime("45"), 45);
  assert.ok(isNaN(P.parseTime("abc")));
  assert.ok(isNaN(P.parseTime("1:")));
  assert.ok(isNaN(P.parseTime("")));
});

test("formatTime and formatClock", function () {
  assert.strictEqual(P.formatTime(210.9), "3:30.9");
  assert.strictEqual(P.formatTime(33), "0:33.0");
  assert.strictEqual(P.formatTime(59.96), "1:00.0");
  assert.strictEqual(P.formatTime(3723), "1:02:03.0");
  assert.strictEqual(P.formatClock(1621), "27:01");
  assert.strictEqual(P.formatClock(3723), "1:02:03");
});

test("episode codes from titles and file names", function () {
  assert.strictEqual(P.episodeCode("Mo.S02E05.Thank.You.Jesus.1080p.mkv"), "S02E05");
  assert.strictEqual(P.episodeCode("show s1e2"), "S01E02");
  assert.strictEqual(P.episodeCode("Show 2x05 title.mkv"), "S02E05");
  assert.strictEqual(P.episodeCode("nothing here"), "");
  assert.strictEqual(P.episodeCode("Movie.2160p.x265.mkv"), "");
});

test("parses two episodes with sections, levels and tags", function () {
  var r = P.parseList(SAMPLE);
  assert.strictEqual(r.episodes.length, 2);
  assert.strictEqual(r.bad.length, 0);
  var a = r.episodes[0];
  assert.strictEqual(a.show, "Example Show");
  assert.strictEqual(a.code, "S01E02");
  assert.strictEqual(a.name, "Second Episode");
  assert.strictEqual(a.runtime, 1450);
  assert.strictEqual(a.before, 1); assert.strictEqual(a.after, 1);
  assert.strictEqual(a.ranges.length, 3);
  assert.deepStrictEqual(a.ranges.map(function (x) { return x.sec; }), ["skip", "skip", "other"]);
  assert.strictEqual(a.ranges[0].lv, "mid");
  assert.deepStrictEqual(a.ranges[0].tags, ["pregnancy talk"]);
  assert.strictEqual(a.ranges[0].desc, "Pregnancy talk between friends.");
  assert.strictEqual(a.ranges[2].lv, null);
  var b = r.episodes[1];
  assert.strictEqual(b.code, "S01E03");
  assert.deepStrictEqual(b.ranges[0].tags, ["explicit", "tag two"]);
  assert.strictEqual(b.ranges[0].lv, "high");
});

test("buffer directives: before, after, both, and list-wide defaults", function () {
  var r = P.parseList("Buffer before and after: 2s\nBuffer after: 3\nShow - S01E01 (A):\nBuffer before: 0.5s\n*1:00-1:10");
  assert.strictEqual(r.globals.before, 2); assert.strictEqual(r.globals.after, 3);
  assert.strictEqual(r.episodes[0].before, 0.5); assert.strictEqual(r.episodes[0].after, null);
});

test("reports lines it cannot read and ignores blank lines", function () {
  var r = P.parseList("Show - S01E01 (A):\nSkip-\n*1:00-0:30: reversed\nrandom words\n*2:00-2:30: ok");
  assert.strictEqual(r.episodes[0].ranges.length, 1);
  assert.deepStrictEqual(r.bad.map(function (b) { return b.n; }), [3, 4]);
});

test("a range with no title starts an unnamed episode", function () {
  var r = P.parseList("* 1:00-1:10: x");
  assert.strictEqual(r.episodes.length, 1);
  assert.strictEqual(r.episodes[0].label, "Episode 1");
});

test("section headers are case-insensitive and accept ':' or '-'", function () {
  var r = P.parseList("Show - S01E01 (A):\nOTHERS:\n*1:00-1:10\nskip-\n*2:00-2:10\nOptional -\n*3:00-3:10");
  assert.deepStrictEqual(r.episodes[0].ranges.map(function (x) { return x.sec; }), ["other", "skip", "other"]);
});

test("folder listings: dir /b, tree /f and tree /a", function () {
  var files = P.parseFileList([
    "index.html", "    Mo S02 - Skip Guide.html",
    "+---Season 2", "|   Mo.S02E01.Oso.mkv", "|   \\---Mo.S02E02.Gone.Fishing.mkv",
    "├── Mo.S02E03.Yes.Chef.mkv", "server.py", "Mo.S02E05.Thank.You.Jesus.1080p.mkv"
  ].join("\n"));
  assert.deepStrictEqual(files.map(function (f) { return f.code; }), ["S02E01", "S02E02", "S02E03", "S02E05"]);
  assert.strictEqual(files[1].name, "Mo.S02E02.Gone.Fishing.mkv");
});

test("matches files to episodes by code", function () {
  var r = P.parseList(SAMPLE);
  var m = P.matchFiles(r.episodes, P.parseFileList("Example.Show.S01E02.mkv\nExample.Show.S01E03.mkv\nExample.Show.S01E03.alt.mkv"));
  assert.strictEqual(m[0].name, "Example.Show.S01E02.mkv");
  assert.strictEqual(m[1].count, 2);
});

test("editHeader changes runtime, buffers and title, and inserts missing lines", function () {
  var t = P.editHeader(SAMPLE, 0, { runtime: 1500, before: 2, after: 0.5, title: "Example Show - S01E02 (Renamed)" });
  var r = P.parseList(t);
  assert.strictEqual(r.episodes[0].runtime, 1500);
  assert.strictEqual(r.episodes[0].before, 2); assert.strictEqual(r.episodes[0].after, 0.5);
  assert.strictEqual(r.episodes[0].name, "Renamed");
  assert.strictEqual(r.episodes[0].ranges.length, 3);
  var t2 = P.editHeader(SAMPLE, 1, { runtime: 1200, video: "Example.S01E03.mkv" });
  var r2 = P.parseList(t2);
  assert.strictEqual(r2.episodes[1].runtime, 1200);
  assert.strictEqual(r2.episodes[1].video, "Example.S01E03.mkv");
  assert.strictEqual(r2.episodes[1].ranges.length, 1);
  var t3 = P.editHeader(t2, 1, { runtime: null, video: "" });
  assert.strictEqual(P.parseList(t3).episodes[1].runtime, null);
  assert.strictEqual(P.parseList(t3).episodes[1].video, "");
});

test("editHeader sets list-wide defaults at the top", function () {
  var t = P.editHeader("Show - S01E01 (A):\n*1:00-1:10", -1, { before: 1, after: 1 });
  var r = P.parseList(t);
  assert.strictEqual(r.globals.before, 1);
  assert.strictEqual(r.episodes.length, 1);
  assert.strictEqual(r.episodes[0].ranges.length, 1);
});

test("setShow renames every episode and keeps codes and names", function () {
  var r = P.parseList(P.setShow(SAMPLE, "My Series"));
  assert.deepStrictEqual(r.episodes.map(function (e) { return e.show; }), ["My Series", "My Series"]);
  assert.deepStrictEqual(r.episodes.map(function (e) { return e.code; }), ["S01E02", "S01E03"]);
  assert.strictEqual(r.episodes[0].name, "Second Episode");
});

test("addRange puts a range in the right section", function () {
  var r = P.parseList(P.addRange(SAMPLE, 0, { s: 700, e: 720, desc: "New one", sec: "skip" }));
  var secs = r.episodes[0].ranges.map(function (x) { return x.sec + ":" + x.desc; });
  assert.deepStrictEqual(secs, ["skip:Pregnancy talk between friends.", "skip:Double-meaning lines.", "skip:New one", "other:One mild joke."]);
  var r2 = P.parseList(P.addRange(SAMPLE, 1, { s: 10, e: 20, desc: "Maybe", sec: "other" }));
  assert.strictEqual(r2.episodes[1].ranges[1].sec, "other");
  var r3 = P.parseList(P.addRange("Show - S01E01 (A):\nOthers-\n*5:00-5:10: x", 0, { s: 1, e: 2, desc: "first skip", sec: "skip" }));
  assert.deepStrictEqual(r3.episodes[0].ranges.map(function (x) { return x.sec; }), ["skip", "other"]);
});

test("updateRange and removeRange", function () {
  var r = P.parseList(SAMPLE), line = r.episodes[0].ranges[1].line;
  var t = P.updateRange(SAMPLE, line, 355, 370);
  var r2 = P.parseList(t);
  assert.strictEqual(r2.episodes[0].ranges[1].s, 355);
  assert.strictEqual(r2.episodes[0].ranges[1].desc, "Double-meaning lines.");
  assert.strictEqual(r2.episodes[0].ranges[1].lv, "low");
  var r3 = P.parseList(P.removeRange(SAMPLE, line));
  assert.strictEqual(r3.episodes[0].ranges.length, 2);
});

test("computeParts applies buffers, merges close ranges and drops tiny parts", function () {
  var res = L.computeParts([{ s: 210.9, e: 232.1 }, { s: 354.1, e: 368.5 }], { before: 1, after: 1, run: 1450, gap: 2 });
  assert.strictEqual(res.parts.length, 3);
  assert.deepStrictEqual(res.parts[0], { s: 0, e: 209.9 });
  assert.ok(Math.abs(res.parts[1].s - 233.1) < 1e-9 && Math.abs(res.parts[1].e - 353.1) < 1e-9);
  assert.strictEqual(res.parts[2].e, null);
  var close = L.computeParts([{ s: 10, e: 20 }, { s: 21, e: 30 }], { run: 100, gap: 2 });
  assert.strictEqual(close.merged.length, 1);
  assert.strictEqual(close.parts.length, 2);
  var edge = L.computeParts([{ s: 0, e: 100 }], { run: 100, gap: 2 });
  assert.strictEqual(edge.parts.length, 0);
  var clamp = L.computeParts([{ s: 0.5, e: 99.5 }], { before: 5, after: 5, run: 100 });
  assert.deepStrictEqual(clamp.merged, [{ s: 0, e: 100 }]);
});

test("buildM3U writes start and stop times for each part", function () {
  var m = L.buildM3U([{ s: 0, e: 209.9 }, { s: 233.1, e: null }], { video: "v.mkv", label: "S01E02" });
  assert.strictEqual(m, "#EXTM3U\n#EXTINF:-1,S01E02 part 1 (0:00 - 3:29)\n#EXTVLCOPT:start-time=0.0\n#EXTVLCOPT:stop-time=209.9\nv.mkv\n#EXTINF:-1,S01E02 part 2 (3:53 - end)\n#EXTVLCOPT:start-time=233.1\nv.mkv\n");
  assert.ok(L.buildM3U([{ s: 0, e: null }], {}).indexOf("VIDEO_FILE_NAME.mkv") > 0);
});

test("playlist names are safe for Windows", function () {
  assert.strictEqual(L.playlistName("{code}_clean.m3u", { code: "S02E05" }), "S02E05_clean.m3u");
  assert.strictEqual(L.playlistName("{show} {code}.m3u", { show: "My Show", code: "S02E05" }), "My_Show S02E05.m3u");
  assert.strictEqual(L.playlistName("a:b?.m3u", {}), "a_b_.m3u");
  assert.strictEqual(L.playlistName("{code}", { code: "S01E01" }), "S01E01.m3u");
  assert.strictEqual(L.playlistName("{code}_clean.m3u", {}), "clean.m3u");
});

test("makeZip stores several files with correct CRCs", function () {
  var fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
  var z = L.makeZip([{ name: "a.m3u", text: "#EXTM3U\nhello\n" }, { name: "b é.m3u", text: "second" }]);
  var f = path.join(os.tmpdir(), "spb-test-" + process.pid + ".zip");
  fs.writeFileSync(f, Buffer.from(z));
  try {
    var out = cp.execSync("unzip -t " + JSON.stringify(f), { encoding: "utf8" });
    assert.ok(/No errors detected/.test(out), out);
    assert.strictEqual(cp.execSync("unzip -p " + JSON.stringify(f) + " a.m3u", { encoding: "utf8" }), "#EXTM3U\nhello\n");
  } catch (e) {
    if (/unzip/.test(String(e.message)) && /not found|ENOENT/.test(String(e.message))) { console.log("     (unzip not installed, skipped)"); }
    else throw e;
  } finally { try { fs.unlinkSync(f); } catch (e) {} }
});

test("prompt contains the user's wording and the format example", function () {
  var p = Q.buildPrompt({ criteria: "violence", keep: "" });
  assert.ok(p.indexOf("Skip: violence.") >= 0);
  assert.ok(p.indexOf("Do not skip") < 0);
  assert.ok(p.indexOf("Skip-") > 0 && p.indexOf("Others-") > 0);
  assert.ok(Q.buildPrompt({ keep: "swearing" }).indexOf("Do not skip: swearing") > 0);
  assert.ok(P.parseList(p.split("Show name - S01E02")[1] ? "Show name - S01E02" + p.split("Show name - S01E02")[1] : "").episodes.length >= 1);
});

console.log("\n" + passed + " tests passed" + (process.exitCode ? " (with failures)" : ""));
