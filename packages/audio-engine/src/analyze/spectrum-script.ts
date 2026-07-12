// import.meta.url is ESM-only, so this lives outside the parser modules —
// tsconfig.cjs.json's CommonJS build of the parsers (#151) must not include it.
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

export const DEFAULT_SPECTRUM_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "spectrum.py",
);
