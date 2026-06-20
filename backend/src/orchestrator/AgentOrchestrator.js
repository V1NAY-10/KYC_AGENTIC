import { ToolRegistry } from '../tools/ToolRegistry.js';
import { whisperTool }       from '../tools/whisper.tool.js';
import { geoLookupTool }     from '../tools/geoLookup.tool.js';
import { panValidationTool } from '../tools/panValidation.tool.js';
import { emiCalculatorTool } from '../tools/emiCalculator.tool.js';
import { fraudScorerTool }   from '../tools/fraudScorer.tool.js';
import { ocrTool }           from '../tools/ocr.tool.js';

/**
 * AgentOrchestrator — Setup and coordination layer.
 *
 * Responsibilities:
 *   1. Register all tools into the ToolRegistry at startup
 *   2. (Future) Set up BullMQ queues and workers for async agent jobs
 *
 * Call setupAgentOrchestrator() ONCE during server startup (in server.js).
 * After that, agents and tools are ready.
 *
 * Why not BullMQ yet?
 *   The current architecture handles async agents via native Promise (fire-and-forget).
 *   BullMQ can be layered in when you need:
 *     - Persistent retries that survive server restarts
 *     - Multiple worker processes
 *     - Dead-letter queues for failed jobs
 *     - Job monitoring dashboard (Bull Board)
 *   All the groundwork is in place — just uncomment the BullMQ section below.
 */
export function setupAgentOrchestrator() {
  // ── Register tools ────────────────────────────────────────────────────────
  ToolRegistry.register(whisperTool);
  ToolRegistry.register(geoLookupTool);
  ToolRegistry.register(panValidationTool);
  ToolRegistry.register(emiCalculatorTool);
  ToolRegistry.register(fraudScorerTool);
  ToolRegistry.register(ocrTool);

  const toolCount = ToolRegistry.getAll().length;
  console.log(`🔧 Agent orchestrator ready — ${toolCount} tools registered:`);
  ToolRegistry.getAll().forEach(t => console.log(`   • ${t.name}`));

  // ── FUTURE: BullMQ queues ─────────────────────────────────────────────────
  // Uncomment when ready to add persistent async job queues:
  //
  // import { Queue, Worker } from 'bullmq';
  // import { getRedis } from '../config/redis.js';
  // import { FraudAgent } from '../agents/FraudAgent.js';
  // import { CreditAgent } from '../agents/CreditAgent.js';
  //
  // const connection = getRedis();
  //
  // export const fraudQueue  = new Queue('fraud-analysis',  { connection });
  // export const creditQueue = new Queue('credit-check',    { connection });
  //
  // const fraudWorker = new Worker('fraud-analysis', async (job) => {
  //   const agent = new FraudAgent();
  //   return agent.run(job.data);
  // }, { connection, concurrency: 5 });
  //
  // const creditWorker = new Worker('credit-check', async (job) => {
  //   const agent = new CreditAgent();
  //   return agent.run(job.data);
  // }, { connection, concurrency: 3 });
  //
  // fraudWorker.on('failed',  (job, err) => console.error('[FraudWorker] Job failed:', err));
  // creditWorker.on('failed', (job, err) => console.error('[CreditWorker] Job failed:', err));
}
