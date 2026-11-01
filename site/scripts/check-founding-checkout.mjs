// The site's `prebuild` gate (#1528): refuses to build a live-mode site
// without a real Founding Payment Link configured. See
// scripts/lib/founding-checkout-config.mjs for the pure check.
import { loadEnv } from 'vite';
import { checkFoundingCheckoutConfig } from './lib/founding-checkout-config.mjs';

const env = { ...loadEnv('production', process.cwd(), 'PUBLIC_'), ...process.env };
const problems = checkFoundingCheckoutConfig(env);

if (problems.length) {
  console.error('✖ Founding checkout is not configured — refusing to build the live site:');
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}

const mode = env.PUBLIC_SITE_MODE?.trim() === 'live' ? 'live' : 'waitlist';
console.log(`✓ Founding checkout config OK (${mode})`);
