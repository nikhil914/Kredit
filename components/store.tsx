"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { DICTS, type DictKey, type Locale } from "@/lib/i18n";
import {
  DEFAULT_SPEND,
  EMPTY_SPEND,
  computeRewards,
  isEligible,
  matchesFilters,
  sortCards,
  totalSpend,
  type FilterState,
  type RewardBreakdown,
} from "@/lib/cards";
import type {
  Card,
  CardTypeFilter,
  EcosystemTag,
  FeeFilter,
  MonthlySpend,
  SortKey,
} from "@/lib/types";

export const MAX_COMPARE = 3;

interface State extends FilterState {
  sort: SortKey;
  compare: string[];
  compareOpen: boolean;
  calculatorOpen: boolean;
  spend: MonthlySpend;
  locale: Locale;
  toast: string | null;
}

type Action =
  | { type: "salary"; value: number }
  | { type: "cardType"; value: CardTypeFilter }
  | { type: "toggleFee"; value: FeeFilter }
  | { type: "toggleTag"; value: EcosystemTag }
  | { type: "query"; value: string }
  | { type: "sort"; value: SortKey }
  | { type: "toggleCompare"; id: string }
  | { type: "clearCompare" }
  | { type: "compareOpen"; value: boolean }
  | { type: "calculatorOpen"; value: boolean }
  | { type: "spend"; key: keyof MonthlySpend; value: number }
  | { type: "setSpend"; value: MonthlySpend }
  | { type: "locale"; value: Locale }
  | { type: "toast"; value: string | null }
  | { type: "resetFilters" };

const initialState: State = {
  salary: 15000,
  cardType: "all",
  fees: [],
  tags: [],
  query: "",
  sort: "recommended",
  compare: [],
  compareOpen: false,
  calculatorOpen: false,
  spend: EMPTY_SPEND,
  locale: "en",
  toast: null,
};

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case "salary":
      return { ...state, salary: a.value };
    case "cardType":
      return { ...state, cardType: a.value };
    case "toggleFee":
      return { ...state, fees: toggle(state.fees, a.value) };
    case "toggleTag":
      return { ...state, tags: toggle(state.tags, a.value) };
    case "query":
      return { ...state, query: a.value };
    case "sort":
      return { ...state, sort: a.value };
    case "toggleCompare": {
      if (state.compare.includes(a.id)) {
        const compare = state.compare.filter((x) => x !== a.id);
        return { ...state, compare, compareOpen: state.compareOpen && compare.length >= 2 };
      }
      if (state.compare.length >= MAX_COMPARE) return { ...state, toast: "maxCompare" };
      return { ...state, compare: [...state.compare, a.id] };
    }
    case "clearCompare":
      return { ...state, compare: [], compareOpen: false };
    case "compareOpen":
      return { ...state, compareOpen: a.value };
    case "calculatorOpen": {
      // First open pre-fills a typical profile so results show instantly.
      if (!a.value) return { ...state, calculatorOpen: false };
      const spend = totalSpend(state.spend) === 0 ? DEFAULT_SPEND : state.spend;
      return { ...state, calculatorOpen: true, spend, sort: "net_value" };
    }
    case "spend": {
      const spend = { ...state.spend, [a.key]: Math.max(0, a.value || 0) };
      return { ...state, spend, sort: "net_value" };
    }
    case "setSpend":
      return { ...state, spend: a.value, sort: "net_value" };
    case "locale":
      return { ...state, locale: a.value };
    case "toast":
      return { ...state, toast: a.value };
    case "resetFilters":
      return {
        ...state,
        salary: initialState.salary,
        cardType: "all",
        fees: [],
        tags: [],
        query: "",
      };
  }
}

interface Ctx {
  state: State;
  dispatch: React.Dispatch<Action>;
  t: (k: DictKey) => string;
  allCards: Card[];
  /** Cards after hard filters, sorted (ineligible ones last). */
  visible: Card[];
  eligibleCount: number;
  rewards: Map<string, RewardBreakdown>;
  isEligible: (c: Card) => boolean;
  hasSpend: boolean;
  activeFilterCount: number;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ cards, children }: { cards: Card[]; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Locale: restore remembered choice, mirror to <html lang dir>.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("locale");
      if (saved === "ar" || saved === "en") dispatch({ type: "locale", value: saved });
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.lang = state.locale;
    document.documentElement.dir = state.locale === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem("locale", state.locale);
    } catch {}
  }, [state.locale]);

  useEffect(() => {
    if (!state.toast) return;
    const id = setTimeout(() => dispatch({ type: "toast", value: null }), 2400);
    return () => clearTimeout(id);
  }, [state.toast]);

  const t = useCallback((k: DictKey) => DICTS[state.locale][k] ?? k, [state.locale]);

  const hasSpend = totalSpend(state.spend) > 0;

  const rewards = useMemo(
    () => new Map(cards.map((c) => [c.id, computeRewards(c, state.spend)])),
    [cards, state.spend],
  );

  const visible = useMemo(() => {
    const filtered = cards.filter((c) => matchesFilters(c, state));
    return sortCards(filtered, state.sort, state.salary, state.spend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, state.cardType, state.fees, state.tags, state.query, state.sort, state.salary, state.spend]);

  const eligible = useCallback((c: Card) => isEligible(c, state.salary), [state.salary]);

  const value: Ctx = {
    state,
    dispatch,
    t,
    allCards: cards,
    visible,
    eligibleCount: visible.filter(eligible).length,
    rewards,
    isEligible: eligible,
    hasSpend,
    activeFilterCount:
      (state.cardType !== "all" ? 1 : 0) +
      state.fees.length +
      state.tags.length +
      (state.salary !== initialState.salary ? 1 : 0),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
