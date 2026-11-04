import cardsJson from "@/data/cards.json";
import type { Card } from "@/lib/types";
import { AdminApp } from "@/components/admin/AdminApp";

export default function AdminPage() {
  return <AdminApp bundled={cardsJson as unknown as Card[]} />;
}
