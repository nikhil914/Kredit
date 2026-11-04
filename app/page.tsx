import cardsJson from "@/data/cards.json";
import type { Card } from "@/lib/types";
import { StoreProvider } from "@/components/store";
import { Comparator } from "@/components/Comparator";

// Swap this import for the scraper's output (same schema) when it lands.
const cards = (cardsJson as unknown as Card[]).filter((c) => !c.hidden);

export default function Home() {
  return (
    <StoreProvider cards={cards}>
      <Comparator />
    </StoreProvider>
  );
}
