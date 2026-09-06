// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKOUT_URL_ENV_VARS, checkoutUrl, type CheckoutPlan } from './checkout';

const CONFIG_FILE = 'checkout-urls.json';

/** Capture only public checkout configuration before the app bundle is signed. */
export function writePackagedCheckoutConfig(resourcesPath: string, env: NodeJS.ProcessEnv): void {
  const config: Record<string, string> = {};
  for (const plan of Object.keys(CHECKOUT_URL_ENV_VARS) as CheckoutPlan[]) {
    const value = checkoutUrl(plan, undefined, env);
    const url = URL.parse(value);
    if (!url || url.protocol !== 'https:' || url.host !== 'buy.stripe.com' ||
        url.pathname.startsWith('/test_') || url.username || url.password) {
      throw new Error(`Set ${CHECKOUT_URL_ENV_VARS[plan]} to a live Stripe Payment Link before packaging.`);
    }
    config[CHECKOUT_URL_ENV_VARS[plan]] = value;
  }
  writeFileSync(join(resourcesPath, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
}

/** Installed apps use signed resources, never the customer's shell configuration. */
export function packagedCheckoutUrl(resourcesPath: string, plan?: string, email?: string): string {
  try {
    const config: NodeJS.ProcessEnv = JSON.parse(readFileSync(join(resourcesPath, CONFIG_FILE), 'utf8'));
    return checkoutUrl(plan, email, config);
  } catch {
    throw new Error('Checkout is unavailable in this installation. Please download the latest Sound Buddy from https://soundbuddy.online/download or contact support@soundbuddy.online.');
  }
}
