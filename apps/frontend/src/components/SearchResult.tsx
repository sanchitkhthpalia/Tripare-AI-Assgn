import type {
  SearchState,
  CompletedState,
  FailedState,
} from "@hotel-rate-comparator/shared";
import { SupplierComparison } from "./SupplierComparison";

interface Props {
  state: SearchState;
  city: string;
  checkIn: string;
  checkOut: string;
  onCancel: () => void;
  onReset: () => void;
}

export function SearchResult({
  state,
  city,
  checkIn,
  checkOut,
  onCancel,
  onReset,
}: Props) {
  switch (state.phase) {
    case "idle":
      return null;

    case "searching":
      return <SearchingView onCancel={onCancel} />;

    case "completed":
      return (
        <CompletedView
          state={state}
          city={city}
          checkIn={checkIn}
          checkOut={checkOut}
          onReset={onReset}
        />
      );

    case "failed":
      return <FailedView state={state} onReset={onReset} />;

    case "cancelled":
      return <CancelledView onReset={onReset} />;
  }
}

// ── Searching ───────────────────────────────────────────────────

function SearchingView({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="loading-card" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true">
        <div className="loading-dot" />
        <div className="loading-dot" />
        <div className="loading-dot" />
      </div>
      <div className="loading-text">Querying suppliers…</div>
      <div className="loading-subtext">
        Comparing rates across Supplier A and Supplier B
      </div>
      <button
        type="button"
        className="btn btn-cancel"
        onClick={onCancel}
        aria-label="Cancel search"
      >
        Cancel Search
      </button>
    </div>
  );
}

// ── Completed ───────────────────────────────────────────────────

function CompletedView({
  state,
  city,
  checkIn,
  checkOut,
  onReset,
}: {
  state: CompletedState;
  city: string;
  checkIn: string;
  checkOut: string;
  onReset: () => void;
}) {
  const { result, selectedSupplier, reason, suppliers, warnings, durationMs } =
    state;

  // ── No results ────────────────────────────────────────────────
  if (!result) {
    const badgeClass =
      warnings.length > 0 ? "result-badge-partial" : "result-badge-empty";
    return (
      <div className="result-card">
        <div className={`result-badge ${badgeClass}`}>
          {warnings.length > 0 ? "⚠ Partial Failure" : "∅ No Results"}
        </div>
        <div className="info-content">
          <div className="info-title">No hotels found</div>
          <div className="info-message">{reason}</div>
        </div>
        {warnings.length > 0 && <Warnings warnings={warnings} />}
        <SupplierComparison
          supplierA={suppliers.supplierA}
          supplierB={suppliers.supplierB}
          winner={null}
        />
        <div className="divider" />
        <div style={{ textAlign: "center" }}>
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Search Again
          </button>
        </div>
      </div>
    );
  }

  // ── Has a result ──────────────────────────────────────────────
  const hasWarnings = warnings.length > 0;
  const badgeClass = hasWarnings
    ? "result-badge-partial"
    : "result-badge-success";
  const badgeText = hasWarnings
    ? "⚠ Best Available Rate"
    : "✓ Best Available Rate";

  return (
    <div className="result-card">
      <div className={`result-badge ${badgeClass}`}>{badgeText}</div>

      <div className="result-hotel-name">{result.name}</div>
      <div className="result-price">
        ₹{result.price.toLocaleString("en-IN")}
        <span className="result-price-unit">/ night</span>
      </div>
      <div className="result-supplier">
        from {selectedSupplier?.replace("Supplier", "Supplier ")}
      </div>

      <div className="result-context">
        {city} · {formatDateRange(checkIn, checkOut)}
      </div>

      <div className="result-reason">{reason}</div>

      {hasWarnings && <Warnings warnings={warnings} />}

      <SupplierComparison
        supplierA={suppliers.supplierA}
        supplierB={suppliers.supplierB}
        winner={selectedSupplier}
      />

      <div className="result-duration">
        Compared in {durationMs.toLocaleString()}ms
      </div>

      <div className="divider" />
      <div style={{ textAlign: "center" }}>
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Search Again
        </button>
      </div>
    </div>
  );
}

// ── Failed ──────────────────────────────────────────────────────

function FailedView({
  state,
  onReset,
}: {
  state: FailedState;
  onReset: () => void;
}) {
  return (
    <div className="result-card">
      <div className="result-badge result-badge-error">✗ Search Failed</div>
      <div className="error-content">
        <div className="error-title">Unable to complete the search</div>
        <div className="error-message">{state.error.message}</div>
      </div>
      {state.suppliers && (
        <SupplierComparison
          supplierA={state.suppliers.supplierA}
          supplierB={state.suppliers.supplierB}
          winner={null}
        />
      )}
      <div className="divider" />
      <div style={{ textAlign: "center" }}>
        <button type="button" className="btn btn-primary" onClick={onReset}>
          Try Again
        </button>
      </div>
    </div>
  );
}

// ── Cancelled ───────────────────────────────────────────────────

function CancelledView({ onReset }: { onReset: () => void }) {
  return (
    <div className="result-card">
      <div className="result-badge result-badge-cancelled">
        — Search Cancelled
      </div>
      <div className="info-content">
        <div className="info-title">Search was cancelled</div>
        <div className="info-message">
          The rate comparison was stopped before it completed.
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Search Again
        </button>
      </div>
    </div>
  );
}

// ── Shared pieces ───────────────────────────────────────────────

function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <>
      {warnings.map((w, i) => (
        <div key={i} className="warning-banner" role="alert">
          <span className="warning-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="warning-text">{w}</span>
        </div>
      ))}
    </>
  );
}

function formatDateRange(checkIn: string, checkOut: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const start = new Date(checkIn + "T00:00:00").toLocaleDateString(
    "en-US",
    opts,
  );
  const end = new Date(checkOut + "T00:00:00").toLocaleDateString(
    "en-US",
    opts,
  );
  return `${start} – ${end}`;
}
