import { BANKS } from "@/lib/cards";
import type { Card } from "@/lib/types";

/** Realistic-proportion (ISO/IEC 7810 ID-1, 85.6 x 53.98mm) card artwork. */
export function CardArt({ card, size = "md" }: { card: Card; size?: "xs" | "sm" | "md" }) {
  const bank = BANKS[card.bank_name];
  const from = card.art?.from ?? bank?.color ?? "#0f1f4d";
  const to = card.art?.to ?? "#334155";
  const small = size !== "md";

  return (
    <div
      dir="ltr"
      className={`card-sheen relative aspect-[1.586] w-full overflow-hidden text-white shadow-lg shadow-slate-900/15 ring-1 ring-black/5 ${
        size === "xs" ? "rounded-md" : small ? "rounded-lg" : "rounded-2xl"
      }`}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      aria-hidden
    >
      {/* subtle guilloche rings */}
      <svg className="absolute -right-10 -top-10 size-48 opacity-15" viewBox="0 0 100 100" fill="none">
        {[18, 26, 34, 42, 50].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} stroke="white" strokeWidth="0.6" />
        ))}
      </svg>

      {size === "xs" ? (
        <div className="absolute start-1.5 top-1/2 h-2 w-2.5 -translate-y-1/2 rounded-[2px] bg-gradient-to-br from-amber-200 to-amber-400" />
      ) : (
      <div className={`absolute inset-0 flex flex-col justify-between ${small ? "p-2" : "p-4"}`}>
        <div className="flex items-start justify-between">
          <span className={`font-display font-bold tracking-tight ${small ? "text-[9px]" : "text-sm"}`}>
            {bank?.name ?? card.bank_name}
          </span>
          <span className={`font-semibold uppercase tracking-widest opacity-80 ${small ? "text-[7px]" : "text-[10px]"}`}>
            {card.tier}
          </span>
        </div>

        {/* EMV chip */}
        <div
          className={`rounded-[4px] bg-gradient-to-br from-amber-200 to-amber-400 ring-1 ring-amber-600/30 ${
            small ? "h-3 w-4" : "h-7 w-9"
          }`}
        />

        <div className="flex items-end justify-between">
          <span className={`max-w-[70%] truncate font-medium opacity-90 ${small ? "text-[7px]" : "text-[11px]"}`}>
            {card.card_name}
          </span>
          <NetworkMark network={card.network} small={small} />
        </div>
      </div>
      )}
    </div>
  );
}

function NetworkMark({ network, small }: { network: Card["network"]; small: boolean }) {
  if (!network) return null;
  if (network === "Mastercard") {
    return (
      <span className={`relative inline-flex ${small ? "h-3 w-5" : "h-6 w-10"}`}>
        <span className="absolute start-0 top-0 aspect-square h-full rounded-full bg-[#EB001B]" />
        <span className="absolute end-0 top-0 aspect-square h-full rounded-full bg-[#F79E1B] mix-blend-screen" />
      </span>
    );
  }
  return (
    <span className={`font-display font-extrabold italic tracking-tight ${small ? "text-[9px]" : "text-lg"}`}>
      {network.toUpperCase()}
    </span>
  );
}

export function BankMono({ card }: { card: Card }) {
  const bank = BANKS[card.bank_name];
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-xl text-[11px] font-bold text-white"
      style={{ background: bank?.color ?? "#0f1f4d" }}
      title={bank?.name}
    >
      {bank?.mono ?? card.bank_name.slice(0, 2)}
    </span>
  );
}
