import { describe, it, expect } from "vitest";
import {
  getHotelsForCity,
  getCheapestHotelForCity,
  KNOWN_CITIES,
} from "../../apps/backend/src/suppliers/catalog";

describe("Hotel Catalog", () => {
  // ---------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------

  it("returns the same hotels for the same city and supplier on repeated calls", () => {
    const first = getHotelsForCity("SupplierA", "Mumbai");
    const second = getHotelsForCity("SupplierA", "Mumbai");
    expect(first).toEqual(second);
  });

  it("is case-insensitive for city names", () => {
    const lower = getHotelsForCity("SupplierA", "mumbai");
    const upper = getHotelsForCity("SupplierA", "Mumbai");
    const mixed = getHotelsForCity("SupplierA", "MUMBAI");
    expect(lower).toEqual(upper);
    expect(upper).toEqual(mixed);
  });

  it("trims whitespace from city names", () => {
    const trimmed = getHotelsForCity("SupplierA", "mumbai");
    const padded = getHotelsForCity("SupplierA", "  mumbai  ");
    expect(trimmed).toEqual(padded);
  });

  // ---------------------------------------------------------------
  // Known cities return hotels
  // ---------------------------------------------------------------

  it("returns non-empty arrays for all known cities", () => {
    for (const city of KNOWN_CITIES) {
      const hotelsA = getHotelsForCity("SupplierA", city);
      const hotelsB = getHotelsForCity("SupplierB", city);
      expect(hotelsA.length).toBeGreaterThan(0);
      expect(hotelsB.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------
  // Different prices per supplier
  // ---------------------------------------------------------------

  it("returns different prices for the same city from different suppliers", () => {
    // At least one city must have different prices — this is what makes
    // the comparison meaningful.
    let foundDifference = false;

    for (const city of KNOWN_CITIES) {
      const hotelsA = getHotelsForCity("SupplierA", city);
      const hotelsB = getHotelsForCity("SupplierB", city);

      for (const hotelA of hotelsA) {
        const hotelB = hotelsB.find((h) => h.hotelId === hotelA.hotelId);
        if (hotelB && hotelA.price !== hotelB.price) {
          foundDifference = true;
        }
      }
    }

    expect(foundDifference).toBe(true);
  });

  it("same hotel IDs from both suppliers for the same city", () => {
    for (const city of KNOWN_CITIES) {
      const idsA = getHotelsForCity("SupplierA", city)
        .map((h) => h.hotelId)
        .sort();
      const idsB = getHotelsForCity("SupplierB", city)
        .map((h) => h.hotelId)
        .sort();
      expect(idsA).toEqual(idsB);
    }
  });

  // ---------------------------------------------------------------
  // Unknown cities
  // ---------------------------------------------------------------

  it("returns empty array for unknown cities", () => {
    expect(getHotelsForCity("SupplierA", "atlantis")).toEqual([]);
    expect(getHotelsForCity("SupplierB", "mars")).toEqual([]);
  });

  // ---------------------------------------------------------------
  // getCheapestHotelForCity
  // ---------------------------------------------------------------

  it("returns the cheapest hotel for a known city", () => {
    const cheapest = getCheapestHotelForCity("SupplierA", "mumbai");
    expect(cheapest).not.toBeNull();

    const allHotels = getHotelsForCity("SupplierA", "mumbai");
    const minPrice = Math.min(...allHotels.map((h) => h.price));
    expect(cheapest!.price).toBe(minPrice);
  });

  it("returns null for an unknown city", () => {
    expect(getCheapestHotelForCity("SupplierA", "atlantis")).toBeNull();
  });

  // ---------------------------------------------------------------
  // Hotel data shape
  // ---------------------------------------------------------------

  it("every hotel has hotelId, name, and a positive price", () => {
    for (const city of KNOWN_CITIES) {
      for (const hotel of getHotelsForCity("SupplierA", city)) {
        expect(typeof hotel.hotelId).toBe("string");
        expect(hotel.hotelId.length).toBeGreaterThan(0);
        expect(typeof hotel.name).toBe("string");
        expect(hotel.name.length).toBeGreaterThan(0);
        expect(typeof hotel.price).toBe("number");
        expect(hotel.price).toBeGreaterThan(0);
      }
    }
  });
});
