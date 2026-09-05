import type { SupplierName } from "@hotel-rate-comparator/shared";

/**
 * A small, fixed hotel catalog per city.
 *
 * Design choices:
 *   - Both suppliers carry the same hotels but at different prices.
 *     This mirrors the real world (MakeMyTrip vs Goibibo for the same property).
 *   - Prices are in INR and fixed, not random. Every call with the same city
 *     returns the same result.
 *   - Unknown cities return an empty array — this is intentional so
 *     the "empty" scenario can also be triggered by searching a city
 *     that isn't in the catalog.
 */

interface CatalogHotel {
  hotelId: string;
  name: string;
  priceA: number; // Supplier A's rate (INR)
  priceB: number; // Supplier B's rate (INR)
}

const CATALOG: Record<string, CatalogHotel[]> = {
  mumbai: [
    {
      hotelId: "mum-1",
      name: "The Taj Mahal Palace",
      priceA: 12500,
      priceB: 11800,
    },
    {
      hotelId: "mum-2",
      name: "Marine Drive Suites",
      priceA: 8200,
      priceB: 8900,
    },
    { hotelId: "mum-3", name: "Bandra Bay Hotel", priceA: 6500, priceB: 6500 },
  ],
  delhi: [
    {
      hotelId: "del-1",
      name: "The Imperial New Delhi",
      priceA: 11000,
      priceB: 10200,
    },
    {
      hotelId: "del-2",
      name: "Connaught Place Inn",
      priceA: 6800,
      priceB: 5900,
    },
  ],
  goa: [
    {
      hotelId: "goa-1",
      name: "Calangute Beach Resort",
      priceA: 4200,
      priceB: 4800,
    },
    {
      hotelId: "goa-2",
      name: "Panjim Heritage Hotel",
      priceA: 3500,
      priceB: 3800,
    },
    {
      hotelId: "goa-3",
      name: "Anjuna Cliff Villa",
      priceA: 5500,
      priceB: 5200,
    },
  ],
  bangalore: [
    {
      hotelId: "blr-1",
      name: "MG Road Business Hotel",
      priceA: 7800,
      priceB: 7200,
    },
    {
      hotelId: "blr-2",
      name: "Indiranagar Boutique",
      priceA: 5500,
      priceB: 5900,
    },
  ],
};

/**
 * Returns the cheapest hotel for a given supplier and city.
 *
 * The workflow ultimately picks the single cheapest across suppliers,
 * so each supplier returns only its best-priced option for the city.
 * This keeps the mock simple while still exercising the comparison logic.
 */
export function getCheapestHotelForCity(
  supplier: SupplierName,
  city: string,
): { hotelId: string; name: string; price: number } | null {
  const normalized = city.trim().toLowerCase();
  const hotels = CATALOG[normalized];

  if (!hotels || hotels.length === 0) {
    return null;
  }

  let cheapest: { hotelId: string; name: string; price: number } | null = null;

  for (const h of hotels) {
    const price = supplier === "SupplierA" ? h.priceA : h.priceB;
    if (cheapest === null || price < cheapest.price) {
      cheapest = { hotelId: h.hotelId, name: h.name, price };
    }
  }

  return cheapest;
}

/**
 * Returns all hotels for a given supplier and city.
 * Used by the mock supplier endpoint.
 */
export function getHotelsForCity(
  supplier: SupplierName,
  city: string,
): Array<{ hotelId: string; name: string; price: number }> {
  const normalized = city.trim().toLowerCase();
  const hotels = CATALOG[normalized];

  if (!hotels || hotels.length === 0) {
    return [];
  }

  return hotels.map((h) => ({
    hotelId: h.hotelId,
    name: h.name,
    price: supplier === "SupplierA" ? h.priceA : h.priceB,
  }));
}

/** Cities that exist in the catalog, exported for tests and documentation. */
export const KNOWN_CITIES = Object.keys(CATALOG);
