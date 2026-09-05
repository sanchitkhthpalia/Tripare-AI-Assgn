import { useRef } from "react";
import { useHotelSearch } from "./hooks/useHotelSearch";
import { SearchForm } from "./components/SearchForm";
import { SearchResult } from "./components/SearchResult";

export function App() {
  const { state, search, cancel, reset } = useHotelSearch();
  const lastSearchRef = useRef({ city: "", checkIn: "", checkOut: "" });

  const isSearching = state.phase === "searching";

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <span className="header-logo">Tripare</span>
          <span className="header-badge">Rate Comparator</span>
        </div>
      </header>

      <main className="main">
        <div className="hero">
          <h1 className="hero-title">Hotel Rate Comparison</h1>
          <p className="hero-subtitle">
            Compare rates across multiple suppliers to find the best available
            price for your stay.
          </p>
        </div>

        <SearchForm
          onSearch={(params) => {
            lastSearchRef.current = {
              city: params.city,
              checkIn: params.checkIn,
              checkOut: params.checkOut,
            };
            search(params);
          }}
          disabled={isSearching}
        />

        <SearchResult
          state={state}
          city={lastSearchRef.current.city}
          checkIn={lastSearchRef.current.checkIn}
          checkOut={lastSearchRef.current.checkOut}
          onCancel={cancel}
          onReset={reset}
        />
      </main>
    </>
  );
}
