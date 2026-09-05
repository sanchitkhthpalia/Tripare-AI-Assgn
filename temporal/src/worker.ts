import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities/fetchSupplier";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "hotel-search";

async function main(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("./workflows/hotelSearch"),
    activities,
  });

  console.log(`Temporal worker started on task queue "${TASK_QUEUE}"`);
  console.log(`Connected to Temporal server at ${TEMPORAL_ADDRESS}`);

  await worker.run();
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
