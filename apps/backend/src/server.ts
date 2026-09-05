import express from "express";
import cors from "cors";
import { mountSupplierRoutes } from "./routes/suppliers";
import { searchRouter } from "./routes/search";

const app = express();
const PORT = parseInt(process.env.PORT ?? "4000", 10);

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
  }),
);
app.use(express.json({ limit: "10kb" }));

// Malformed JSON is a 400, not a 500.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        status: "error",
        searchId: "",
        error: {
          code: "VALIDATION_ERROR",
          message: "Request body is not valid JSON",
        },
      });
      return;
    }
    next(err);
  },
);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Mock supplier endpoints
mountSupplierRoutes(app);

// Search API
app.use(searchRouter);

const server = app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
  console.log(`  Search API:  POST http://localhost:${PORT}/api/search-hotels`);
  console.log(
    `  Supplier A:  GET  http://localhost:${PORT}/supplierA/hotels?city=mumbai`,
  );
  console.log(
    `  Supplier B:  GET  http://localhost:${PORT}/supplierB/hotels?city=mumbai`,
  );
  console.log(`  Scenarios:   ?scenario=normal|slow|empty|error|retry`);
});

// Global error handler to prevent stack trace leaks
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(
      JSON.stringify({ event: "unhandled_server_error", error: err.message }),
    );
    res.status(500).json({
      status: "error",
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred processing your request",
      },
    });
  },
);

export { app, server };
