import cardsJson from "@/data/cards.json";
import type { Card } from "@/lib/types";
import { AdminApp } from "@/components/admin/AdminApp";
import { AdminGate } from "@/components/admin/AdminGate";

export default function AdminPage() {
  return (
    <AdminGate>
      <AdminApp bundled={cardsJson as unknown as Card[]} />
    </AdminGate>
  );
}
