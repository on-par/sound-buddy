#!/usr/bin/env node
/**
 * benchmark.mjs — measure the analysis pipeline's wall-clock time, peak memory,
 * and failure modes on full-length service recordings and large multichannel
 * sessions. Answers issue #126 (spike): does a 90–120 min service analyze within
 * the <5 min cold-start target, and where does the pipeline break on big inputs?
 *
 * This is a throwaway-instrumentation harness — it does NOT touch production
 * code paths. It exercises the same three stages the app runs in parallel
 * (`analyzeAudio` = sox stat ‖ ffprobe ‖ spectrum.py) plus the multichannel
 * channel-split path (extractChannels → per-channel spectrum), measuring each
 * stage via _measure.py (getrusage peak RSS).
 *
 * Usage:
 *   node benchmark.mjs                       # default sweep, generated inputs
 *   node benchmark.mjs --durations 1,30,120  # stereo minutes to test
 *   node benchmark.mjs --channels 32 --channel-minutes 10
 *   node benchmark.mjs --file path/to/real.wav   # measure a real recording
 *   node benchmark.mjs --out results.json    # also write raw JSON
 *   node benchmark.mjs --keep                # keep generated temp files
 *
 * Stage wall-clock is measured with the stages running SEQUENTIALLY so each
 * stage's cost is isolated. In production they run in parallel via Promise.all,
 * so real end-to-end latency ≈ max(stage), not the sum — the report notes both.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEASURE = join(__dirname, "_measure.py");
const SPECTRUM = join(__dirname, "spectrum.py");

// ─── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    durations: [1, 5, 15, 30, 60, 90, 120],
    channels: 32,
    channelMinutes: 10,
    sampleRate: 48000,
    file: null,
    out: null,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--durations") opts.durations = argv[++i].split(",").map(Number);
    else if (a === "--channels") opts.channels = Number(argv[++i]);
    else if (a === "--channel-minutes") opts.channelMinutes = Number(argv[++i]);
    else if (a === "--sample-rate") opts.sampleRate = Number(argv[++i]);
    else if (a === "--file") opts.file = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--keep") opts.keep = true;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else { console.error(`unknown flag: ${a}`); process.exit(2); }
  }
  return opts;
}

function printHelp() {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n").filter((l) => l.startsWith(" *")).map((l) => l.slice(3)).join("\n"));
}

// ─── python interpreter with numpy/librosa ───────────────────────────────────
function resolvePython() {
  const candidates = [
    process.env.SOUND_BUDDY_PYTHON,
    join(__dirname, "..", "..", "..", ".venv", "bin", "python3"),
    "python3",
  ].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["-c", "import numpy, librosa"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  console.error("No python interpreter with numpy + librosa found. Set SOUND_BUDDY_PYTHON or create .venv.");
  process.exit(1);
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (b == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = b, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(v < 10 && u > 0 ? 2 : 1)} ${units[u]}`;
}
function fmtDur(s) {
  if (s == null) return "—";
  if (s < 60) return `${s.toFixed(1)}s`;
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  return `${m}m${String(total % 60).padStart(2, "0")}s`;
}

/**
 * Run `cmd args` under _measure.py; capture child stdout (for JSON), stderr,
 * wall-clock and peak RSS. Returns { ok, exit, wall_s, peak_rss_bytes, stdout,
 * stderr, error }.
 */
function measure(python, cmd, args, { timeoutMs = 20 * 60 * 1000 } = {}) {
  const metricsPath = join(mkdtempSync(join(tmpdir(), "sb-metric-")), "m.json");
  const r = spawnSync(python, [MEASURE, metricsPath, cmd, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: timeoutMs,
  });
  let metrics = {};
  try { metrics = JSON.parse(readFileSync(metricsPath, "utf8")); } catch { /* child died before writing */ }
  rmSync(dirname(metricsPath), { recursive: true, force: true });

  const failure =
    r.error?.code === "ETIMEDOUT" ? "timeout"
      : r.error?.code === "ENOBUFS" ? "stdout-maxBuffer-exceeded"
      : (r.status ?? metrics.exit) !== 0 ? `exit-${r.status ?? metrics.exit}`
      : null;

  return {
    ok: failure === null,
    failure,
    exit: r.status ?? metrics.exit ?? null,
    wall_s: metrics.wall_s ?? null,
    peak_rss_bytes: metrics.peak_rss_bytes ?? null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

// ─── input generation ─────────────────────────────────────────────────────────
function genStereo(path, seconds, sampleRate) {
  // Sine mix (not silence) so spectrum classification does real work.
  const r = spawnSync("sox", [
    "-n", "-r", String(sampleRate), "-c", "2", "-b", "16", path,
    "synth", String(seconds), "sine", "200", "sine", "440", "sine", "1000",
    "vol", "0.6",
  ], { encoding: "utf8", timeout: 30 * 60 * 1000 });
  if (r.status !== 0) throw new Error(`sox generate failed: ${r.stderr}`);
}

function genMultichannel(path, channels, seconds, sampleRate) {
  const r = spawnSync("sox", [
    "-n", "-r", String(sampleRate), "-c", String(channels), "-b", "16", path,
    "synth", String(seconds), "sine", "200-2000", "vol", "0.5",
  ], { encoding: "utf8", timeout: 30 * 60 * 1000 });
  if (r.status !== 0) throw new Error(`sox generate (${channels}ch) failed: ${r.stderr}`);
}

// ─── stage runners (mirror packages/audio-engine/src/analyze/*) ───────────────
function stageSox(python, file) {
  return measure(python, "sox", [file, "-n", "stat"]);
}
function stageFfprobe(python, file) {
  return measure(python, "ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
}
function stageSpectrum(python, file) {
  const res = measure(python, python, [SPECTRUM, file]);
  // spectrum.ts caps execFile stdout at 1 MiB (maxBuffer). Record output size so
  // we can say definitively whether long files risk overflowing that buffer.
  res.stdout_bytes = Buffer.byteLength(res.stdout, "utf8");
  res.maxbuffer_1mib_ok = res.stdout_bytes < 1024 * 1024;
  // spectrum.py catches load errors and prints {"error": ...} with exit 1.
  if (res.stdout.includes('"error"')) {
    try { res.py_error = JSON.parse(res.stdout).error; } catch { /* ignore */ }
  }
  return res;
}

// ─── main ───────────────────────────────────────────────────────────────────
const opts = parseArgs(process.argv.slice(2));
const python = resolvePython();
const workdir = mkdtempSync(join(tmpdir(), "sb-bench-"));
const results = { meta: {}, stereo: [], multichannel: null };

console.log(`benchmark: python=${python}`);
console.log(`benchmark: workdir=${workdir}\n`);

function analyzeOne(label, file) {
  const size = statSync(file).size;
  console.log(`\n── ${label}  (${fmtBytes(size)}) ──`);
  const sox = stageSox(python, file);
  console.log(`   sox stat    ${fmtDur(sox.wall_s).padStart(8)}  peak ${fmtBytes(sox.peak_rss_bytes).padStart(9)}  ${sox.failure ?? "ok"}`);
  const ff = stageFfprobe(python, file);
  console.log(`   ffprobe     ${fmtDur(ff.wall_s).padStart(8)}  peak ${fmtBytes(ff.peak_rss_bytes).padStart(9)}  ${ff.failure ?? "ok"}`);
  const spec = stageSpectrum(python, file);
  console.log(`   spectrum.py ${fmtDur(spec.wall_s).padStart(8)}  peak ${fmtBytes(spec.peak_rss_bytes).padStart(9)}  out ${fmtBytes(spec.stdout_bytes)}  ${spec.failure ?? "ok"}`);
  const walls = [sox.wall_s, ff.wall_s, spec.wall_s].filter((x) => x != null);
  const parallel = walls.length ? Math.max(...walls) : null;
  const serial = walls.reduce((a, b) => a + b, 0);
  return { label, file_bytes: size, sox, ffprobe: ff, spectrum: spec, parallel_wall_s: parallel, serial_wall_s: serial };
}

try {
  if (opts.file) {
    results.meta.mode = "real-file";
    results.stereo.push(analyzeOne(`file:${opts.file}`, opts.file));
  } else {
    results.meta.mode = "generated";
    // Stereo sweep.
    for (const min of opts.durations) {
      const file = join(workdir, `stereo-${min}min.wav`);
      process.stdout.write(`generating ${min} min stereo … `);
      genStereo(file, min * 60, opts.sampleRate);
      console.log("done");
      const row = analyzeOne(`stereo ${min} min`, file);
      row.minutes = min;
      results.stereo.push(row);
      if (opts.out) writeFileSync(opts.out, JSON.stringify(results, null, 2));
      if (!opts.keep) rmSync(file, { force: true });
    }

    // Multichannel session: channel-split (ffmpeg pan) + per-channel spectrum,
    // mirroring extractChannels() → analyze each mono stem.
    const { channels, channelMinutes } = opts;
    const mcFile = join(workdir, `mc-${channels}ch-${channelMinutes}min.wav`);
    process.stdout.write(`\ngenerating ${channelMinutes} min × ${channels}ch … `);
    genMultichannel(mcFile, channels, channelMinutes * 60, opts.sampleRate);
    console.log(`done (${fmtBytes(statSync(mcFile).size)})`);
    const mcSize = statSync(mcFile).size;
    console.log(`\n── multichannel ${channels}ch × ${channelMinutes} min ──`);
    const ffmc = stageFfprobe(python, mcFile);
    console.log(`   ffprobe(all) ${fmtDur(ffmc.wall_s).padStart(8)}  peak ${fmtBytes(ffmc.peak_rss_bytes)}`);
    // Split one channel to measure ffmpeg per-channel extraction cost.
    const chFile = join(workdir, "mc-ch0.wav");
    const split = measure(python, "ffmpeg", ["-i", mcFile, "-filter:a", "pan=mono|c0=c1", "-y", chFile]);
    console.log(`   ffmpeg split 1ch ${fmtDur(split.wall_s).padStart(8)}  peak ${fmtBytes(split.peak_rss_bytes)}  ${split.failure ?? "ok"}`);
    const specCh = split.ok ? stageSpectrum(python, chFile) : null;
    if (specCh) console.log(`   spectrum.py 1ch  ${fmtDur(specCh.wall_s).padStart(8)}  peak ${fmtBytes(specCh.peak_rss_bytes)}  ${specCh.failure ?? "ok"}`);
    results.multichannel = {
      channels, channelMinutes, file_bytes: mcSize,
      ffprobe: ffmc, split_one_channel: split, spectrum_one_channel: specCh,
      // Full session ≈ split(N) + spectrum(N) sequential (extractChannels loops).
      est_full_serial_s:
        split.wall_s != null && specCh?.wall_s != null
          ? (split.wall_s + specCh.wall_s) * channels
          : null,
    };
    if (!opts.keep) rmSync(mcFile, { force: true });
    if (!opts.keep) rmSync(chFile, { force: true });
  }

  if (opts.out) writeFileSync(opts.out, JSON.stringify(results, null, 2));
  console.log("\n" + renderMarkdown(results));
  if (opts.out) console.log(`\nraw JSON → ${opts.out}`);
} finally {
  if (!opts.keep) rmSync(workdir, { recursive: true, force: true });
}

// ─── markdown summary ─────────────────────────────────────────────────────────
function renderMarkdown(r) {
  const TARGET = 5 * 60; // <5 min cold-start
  let md = "### Stereo sweep\n\n";
  md += "| Duration | File size | sox | ffprobe | spectrum.py | spectrum peak RSS | JSON out | e2e (parallel) | <5min? |\n";
  md += "|---|---|---|---|---|---|---|---|---|\n";
  for (const row of r.stereo) {
    const e2e = row.parallel_wall_s;
    const ok = e2e != null && e2e < TARGET ? "✅" : e2e == null ? "⚠️ fail" : "❌";
    md += `| ${row.minutes != null ? row.minutes + " min" : row.label} | ${fmtBytes(row.file_bytes)} | ${fmtDur(row.sox.wall_s)} | ${fmtDur(row.ffprobe.wall_s)} | ${fmtDur(row.spectrum.wall_s)} | ${fmtBytes(row.spectrum.peak_rss_bytes)} | ${fmtBytes(row.spectrum.stdout_bytes)} | ${fmtDur(e2e)} | ${ok} |\n`;
  }
  if (r.multichannel) {
    const m = r.multichannel;
    md += `\n### Multichannel (${m.channels}ch × ${m.channelMinutes} min)\n\n`;
    md += `- ffprobe(all channels): ${fmtDur(m.ffprobe.wall_s)}, peak ${fmtBytes(m.ffprobe.peak_rss_bytes)}\n`;
    md += `- ffmpeg split 1 channel: ${fmtDur(m.split_one_channel.wall_s)}, peak ${fmtBytes(m.split_one_channel.peak_rss_bytes)}\n`;
    if (m.spectrum_one_channel)
      md += `- spectrum.py 1 channel: ${fmtDur(m.spectrum_one_channel.wall_s)}, peak ${fmtBytes(m.spectrum_one_channel.peak_rss_bytes)}\n`;
    md += `- **estimated full ${m.channels}ch session (serial split+spectrum): ${fmtDur(m.est_full_serial_s)}**\n`;
  }
  return md;
}
