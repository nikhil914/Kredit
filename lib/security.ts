/**
 * Render-time guards for card data. cards.json can change through the admin,
 * the CLI import, or a direct commit, so the public site never trusts it:
 * links must be https:// and card colours must be plain hex.
 */
import type { Card } from "./types";
import { isSafeHttpsUrl } from "./validate";

const HEX = /^#[0-9a-f]{6}$/i;

/** True when any link on the card would be unsafe to put in an href. */
export function hasUnsafeUrl(card: Card): boolean {
  const urls = [...(card.source_urls ?? []), ...(card.apply_url ? [card.apply_url] : [])];
  return urls.some((u) => !isSafeHttpsUrl(u));
}

export function sanitizeCard(card: Card): Card {
  const source_urls = (Array.isArray(card.source_urls) ? card.source_urls : []).filter(isSafeHttpsUrl);
  const next: Card = { ...card, source_urls, apply_url: isSafeHttpsUrl(card.apply_url) ? card.apply_url : null };
  if (card.art && !(HEX.test(card.art.from) && HEX.test(card.art.to))) delete next.art;
  return next;
}

export const sanitizeCards = (cards: Card[]) => cards.map(sanitizeCard);
