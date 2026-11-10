/*
 * VLC Parental Cut: the prompt you give an AI together with a subtitle file.
 * Plain script. Browser: window.SPB.prompt. Node: require().
 */
(function (root) {
  "use strict";

  var DEFAULTS = {
    criteria: "romantic scenes, sexual talk and double meanings",
    keep: "swearing"
  };

  function buildPrompt(opts) {
    var criteria = (opts && opts.criteria || "").trim() || DEFAULTS.criteria;
    var keep = (opts && opts.keep || "").trim();
    var lines = [
      "I am attaching the subtitle file (.srt) of a video. Build a skip list for it, so I can watch the video with some content removed.",
      "",
      "Skip: " + criteria + ".",
      keep ? "Do not skip: " + keep + " (unless it sits inside a scene that is skipped anyway)." : "",
      "",
      "How to work:",
      "1. Read the whole subtitle file, line by line. Judge scenes in context; do not rely on keyword searches alone.",
      "2. Skip whole scenes. A range starts at the first subtitle line of the scene and ends at the last one. Small talk inside a scene belongs to the scene. Merge ranges that are less than 10 seconds apart.",
      "3. Use the subtitle file's own timestamps, written as m:ss.s (for example 3:30.9), from the start of the first line to the end of the last line. Do not add padding; my tool adds a buffer.",
      "4. Give each range a level. Low = mild or ambiguous. Mid = clear. High = explicit.",
      "5. Keep every description short and category-only, with no spoilers and no details of what happens (for example \"A long romantic scene.\"). I do not want to know what happens.",
      "6. Put clear matches under Skip-. Put borderline items you were unsure about under Others-.",
      "7. If I attach more than one subtitle file, write one block per file, separated by a blank line.",
      "",
      "Reply with only the list, in one code block, in exactly this format and nothing else:",
      "",
      "Show name - S01E02 (Episode title):",
      "",
      "Skip-",
      "* 3:30.9-3:52.1: Pregnancy talk between friends. (Mid, pregnancy talk)",
      "* 5:54.1-6:08.5: Double-meaning lines. (Low, double meaning)",
      "",
      "Others-",
      "* 0:33.0-0:40.5: One mild joke."
    ];
    return lines.filter(function (l, i) { return !(l === "" && lines[i - 1] === ""); }).join("\n").replace(/\n{3,}/g, "\n\n").replace(/^Do not skip: undefined.*\n/m, "");
  }

  var api = { buildPrompt: buildPrompt, DEFAULTS: DEFAULTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { root.SPB = root.SPB || {}; root.SPB.prompt = api; }
})(typeof window !== "undefined" ? window : this);
