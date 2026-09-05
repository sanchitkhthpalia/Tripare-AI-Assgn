import { Router } from "express";
import type { SupplierName } from "@hotel-rate-comparator/shared";
import { getHotelsForCity } from "../suppliers/catalog";
import {
  resolveScenario,
  parseScenario,
  parseAttempt,
} from "../suppliers/scenarios";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Creates a mock supplier router for the given supplier name and path prefix.
 *
 * GET /:prefix/hotels?city=...&checkIn=...&checkOut=...&scenario=...&attempt=...
 *
 * Query params:
 *   city      (required)  City to search
 *   checkIn   (required)  ISO date — accepted but not used for filtering
 *   checkOut  (required)  ISO date — accepted but not used for filtering
 *   scenario  (optional)  One of: normal, slow, empty, error, retry
 *   attempt   (optional)  Temporal activity attempt number (1-indexed),
 *                         forwarded by the activity for the retry scenario
 */
function createSupplierRouter(supplier: SupplierName, prefix: string): Router {
  const router = Router();

  router.get(`/${prefix}/hotels`, async (req, res) => {
    const city = req.query.city;

    if (typeof city !== "string" || city.trim().length === 0) {
      res.status(400).json({ error: "Missing required query param: city" });
      return;
    }

    const scenario = parseScenario(req.query.scenario);
    const attempt = parseAttempt(req.query.attempt);
    const hotels = getHotelsForCity(supplier, city);

    const resolution = resolveScenario(scenario, hotels, attempt);

    console.log(
      `[${supplier}] ${req.method} ${req.path} city=${city} scenario=${scenario} attempt=${attempt} → ${resolution.label}`,
    );

    // Apply delay (the only side effect in this handler)
    if (resolution.delayMs > 0) {
      await delay(resolution.delayMs);
    }

    res.status(resolution.statusCode).json({ hotels: resolution.hotels });
  });

  return router;
}

/**
 * Mounts both supplier routers on the given Express app.
 */
export function mountSupplierRoutes(app: {
  use: (router: Router) => void;
}): void {
  app.use(createSupplierRouter("SupplierA", "supplierA"));
  app.use(createSupplierRouter("SupplierB", "supplierB"));
}
