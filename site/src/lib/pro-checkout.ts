export const PLACEHOLDER_PRO_MONTHLY_URL: string = 'https://buy.stripe.com/sound-buddy-pro-monthly';
export const PLACEHOLDER_PRO_ANNUAL_URL: string = 'https://buy.stripe.com/sound-buddy-pro-annual';

export function monthlyCheckoutUrl(env: Record<string, string | undefined>): string {
  return env.PUBLIC_PRO_MONTHLY_CHECKOUT_URL?.trim() || PLACEHOLDER_PRO_MONTHLY_URL;
}

export function annualCheckoutUrl(env: Record<string, string | undefined>): string {
  return env.PUBLIC_PRO_ANNUAL_CHECKOUT_URL?.trim() || PLACEHOLDER_PRO_ANNUAL_URL;
}
