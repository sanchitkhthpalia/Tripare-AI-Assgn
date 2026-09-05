import type { SupplierStatusSummary } from "@hotel-rate-comparator/shared";

interface Props {
  supplierA: SupplierStatusSummary;
  supplierB: SupplierStatusSummary;
  winner: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  ok: "supplier-status-ok",
  empty: "supplier-status-empty",
  error: "supplier-status-error",
  timeout: "supplier-status-timeout",
};

export function SupplierComparison({ supplierA, supplierB, winner }: Props) {
  return (
    <div
      className="supplier-comparison"
      role="group"
      aria-label="Supplier comparison"
    >
      <SupplierCard summary={supplierA} isWinner={winner === "SupplierA"} />
      <SupplierCard summary={supplierB} isWinner={winner === "SupplierB"} />
    </div>
  );
}

function SupplierCard({
  summary,
  isWinner,
}: {
  summary: SupplierStatusSummary;
  isWinner: boolean;
}) {
  const cardClass = `supplier-card${isWinner ? " supplier-card-winner" : ""}`;
  const statusClass = STATUS_CLASS[summary.status] ?? "";

  return (
    <div className={cardClass}>
      <div className="supplier-name">
        {summary.supplier.replace("Supplier", "Supplier ")}
      </div>
      <div className={`supplier-status ${statusClass}`}>
        {summary.statusLabel}
      </div>
      {summary.durationMs > 0 && (
        <div className="supplier-meta">{summary.durationMs}ms</div>
      )}
      {summary.retryNote && (
        <div className="supplier-retry-note">{summary.retryNote}</div>
      )}
    </div>
  );
}
