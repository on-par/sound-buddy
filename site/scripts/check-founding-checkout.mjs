// The site's `prebuild` gate (#1528): refuses to build a live-mode site
// without a real Founding Payment Link configured. See
// scripts/lib/founding-checkout-config.mjs for the pure check.
import { checkFoundingCheckoutConfig } from './lib/founding-checkout-config.mjs';

const problems = checkFoundingCheckoutConfig(process.env);

if (problems.length) {
  console.error('✖ Founding checkout is not configured — refusing to build the live site:');
  for (const problem of problems) console.error('  ' + problem);
  process.exit(1);
}

const mode = process.env.PUBLIC_SITE_MODE?.trim() === 'live' ? 'live' : 'waitlist';
console.log(`✓ Founding checkout config OK (${mode})`);
