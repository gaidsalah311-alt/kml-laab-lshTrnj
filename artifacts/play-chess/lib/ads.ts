export type AdPlacement = 'banner' | 'hint' | 'undo' | 'interstitial';
export type AdMode = 'placeholder';

export const AD_MODE: AdMode = 'placeholder';

export async function showRewardedAd(_placement: 'hint' | 'undo'): Promise<boolean> {
  // The production ad SDK is intentionally not bundled yet. This keeps the
  // flow testable and makes the adapter replaceable when a provider is chosen.
  await new Promise((resolve) => setTimeout(resolve, 350));
  return true;
}

export function shouldShowInterstitial(completedGames: number): boolean {
  return completedGames > 0 && completedGames % 3 === 0;
}