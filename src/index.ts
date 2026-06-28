import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { analyzeAudio } from "./analyze/index.js";
import { buildReport, buildSummaryTable } from "./report.js";
import { getEngineerRead } from "./engineer.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: sound-buddy <path-to-audio-file>");
    console.error("  Example: npx tsx src/index.ts path/to/audio.mp3");
    process.exit(1);
  }

  const filePath = resolve(args[0]);

  if (!existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`\nAnalyzing ${filePath}...`);
  console.log("");

  let analysis;
  try {
    analysis = await analyzeAudio(filePath);
  } catch (err) {
    console.error("Analysis failed:", err);
    process.exit(1);
  }

  // Print summary table
  console.log("=== Raw Measurements ===");
  console.log(buildSummaryTable(analysis));
  console.log("");

  // Build the full report for the LLM
  const report = buildReport(analysis);

  console.log("--- Audio Engineer's Read ---");
  console.log("");

  try {
    await getEngineerRead(report);
  } catch (err) {
    console.error("\nLLM analysis failed:", err);
    process.exit(1);
  }

  console.log("");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
