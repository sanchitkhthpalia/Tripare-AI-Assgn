import { useState } from "react";
import type { SupplierScenario } from "@hotel-rate-comparator/shared";
import type { SearchParams } from "../hooks/useHotelSearch";

interface Props {
  onSearch: (params: SearchParams) => void;
  disabled: boolean;
}

// ── Preset scenarios for reviewers ──────────────────────────────

interface DemoPreset {
  label: string;
  description: string;
  city: string;
  scenarioA?: SupplierScenario;
  scenarioB?: SupplierScenario;
}

const PRESETS: DemoPreset[] = [
  {
    label: "Supplier A cheaper",
    description: "Goa — A: ₹3,500, B: ₹3,800",
    city: "Goa",
  },
  {
    label: "Supplier B cheaper",
    description: "Delhi — A: ₹6,800, B: ₹5,900",
    city: "Delhi",
  },
  {
    label: "Same rate (A wins)",
    description: "Mumbai — both ₹6,500, deterministic tiebreak",
    city: "Mumbai",
  },
  {
    label: "Supplier A fails",
    description: "A returns HTTP 500, B succeeds",
    city: "Goa",
    scenarioA: "error",
  },
  {
    label: "Supplier B times out",
    description: "A succeeds, B abandoned at the 5s budget",
    city: "Goa",
    scenarioB: "slow",
  },
  {
    label: "Supplier A retries",
    description: "A fails twice then succeeds on attempt 3",
    city: "Goa",
    scenarioA: "retry",
  },
  {
    label: "Both empty",
    description: "Both suppliers return no hotels",
    city: "Goa",
    scenarioA: "empty",
    scenarioB: "empty",
  },
  {
    label: "Both fail",
    description: "Both suppliers return server errors",
    city: "Goa",
    scenarioA: "error",
    scenarioB: "error",
  },
];

// ── Component ───────────────────────────────────────────────────

// Sensible defaults: check-in next week, 3-night stay
function defaultDates() {
  const today = new Date();
  const checkIn = new Date(today);
  checkIn.setDate(today.getDate() + 7);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkIn.getDate() + 3);
  return { checkIn: fmt(checkIn), checkOut: fmt(checkOut) };
}

// Local date parts — toISOString() shifts the date east of Greenwich.
function fmt(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function SearchForm({ onSearch, disabled }: Props) {
  const defaults = defaultDates();
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState(defaults.checkIn);
  const [checkOut, setCheckOut] = useState(defaults.checkOut);
  const [showDemo, setShowDemo] = useState(false);
  const [scenarioA, setScenarioA] = useState<SupplierScenario | "">("");
  const [scenarioB, setScenarioB] = useState<SupplierScenario | "">("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!city.trim()) return;
    submitSearch(
      city.trim(),
      checkIn,
      checkOut,
      scenarioA || undefined,
      scenarioB || undefined,
    );
  };

  const submitSearch = (
    c: string,
    ci: string,
    co: string,
    sa?: SupplierScenario,
    sb?: SupplierScenario,
  ) => {
    const scenarios =
      sa || sb
        ? { ...(sa ? { supplierA: sa } : {}), ...(sb ? { supplierB: sb } : {}) }
        : undefined;
    onSearch({ city: c, checkIn: ci, checkOut: co, scenarios });
  };

  const runPreset = (preset: DemoPreset) => {
    const ci = checkIn;
    const co = checkOut;
    setCity(preset.city);
    setScenarioA(preset.scenarioA ?? "");
    setScenarioB(preset.scenarioB ?? "");
    submitSearch(preset.city, ci, co, preset.scenarioA, preset.scenarioB);
  };

  return (
    <form className="search-card" onSubmit={handleSubmit}>
      <div className="search-fields">
        <div className="field">
          <label htmlFor="city" className="field-label">
            Destination
          </label>
          <input
            id="city"
            type="text"
            className="field-input"
            placeholder="e.g. Goa"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={disabled}
            autoComplete="off"
            required
          />
          <span className="field-hint">Mumbai, Delhi, Goa, Bangalore</span>
        </div>

        <div className="field">
          <label htmlFor="checkIn" className="field-label">
            Check-in
          </label>
          <input
            id="checkIn"
            type="date"
            className="field-input"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            disabled={disabled}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="checkOut" className="field-label">
            Check-out
          </label>
          <input
            id="checkOut"
            type="date"
            className="field-input"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            min={checkIn}
            disabled={disabled}
            required
          />
        </div>
      </div>

      <div className="search-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={disabled || !city.trim()}
        >
          Compare Rates
        </button>
      </div>

      {/* ── Demo section ─────────────────────────────────────── */}

      <button
        type="button"
        className="demo-toggle"
        onClick={() => setShowDemo(!showDemo)}
        aria-expanded={showDemo}
      >
        {showDemo ? "▾ Hide demo scenarios" : "▸ Demo scenarios"}
      </button>

      {showDemo && (
        <div className="demo-panel" role="region" aria-label="Demo scenarios">
          <div className="demo-label">
            Quick presets — click to run a scenario immediately
          </div>

          <div className="preset-grid">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="preset-btn"
                onClick={() => runPreset(preset)}
                disabled={disabled}
                title={preset.description}
              >
                <span className="preset-label">{preset.label}</span>
                <span className="preset-desc">{preset.description}</span>
              </button>
            ))}
          </div>

          <div className="divider" />

          <div className="demo-label">
            Custom — set individual supplier behavior
          </div>
          <div className="demo-fields">
            <div className="field">
              <label htmlFor="scenarioA" className="field-label">
                Supplier A
              </label>
              <select
                id="scenarioA"
                className="demo-select"
                value={scenarioA}
                onChange={(e) =>
                  setScenarioA(e.target.value as SupplierScenario | "")
                }
                disabled={disabled}
              >
                <option value="">Default</option>
                <option value="normal">Normal</option>
                <option value="slow">Slow (6s — exceeds 5s budget)</option>
                <option value="empty">Empty response</option>
                <option value="error">Server error</option>
                <option value="retry">Retry (fail then succeed)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="scenarioB" className="field-label">
                Supplier B
              </label>
              <select
                id="scenarioB"
                className="demo-select"
                value={scenarioB}
                onChange={(e) =>
                  setScenarioB(e.target.value as SupplierScenario | "")
                }
                disabled={disabled}
              >
                <option value="">Default</option>
                <option value="normal">Normal</option>
                <option value="slow">Slow (6s — exceeds 5s budget)</option>
                <option value="empty">Empty response</option>
                <option value="error">Server error</option>
                <option value="retry">Retry (fail then succeed)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
