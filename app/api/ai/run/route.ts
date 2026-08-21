import { generateBoundaryDesign } from "actions/ai/generate-boundary-design";
import { generateContractTestCases } from "actions/ai/generate-contract-test-cases";
import { generateContractTestScenarios } from "actions/ai/generate-contract-test-scenarios";
import { generateImplementationProfile } from "actions/ai/generate-implementation-profile";
import { generateInterfaceContracts } from "actions/ai/generate-interface-contracts";
import { generateProductOverview } from "actions/ai/generate-product-overview";
import { generateProjectSetup } from "actions/ai/generate-project-setup";
import { generateStructuralFragment } from "actions/ai/generate-structural-fragment";
import { generateTestCode } from "actions/ai/generate-test-code";
import { handleComment } from "actions/ai/handle-comment";
import { runWithThinkingSink } from "actions/lib/thinking-sink";
import type {
  AiTaskContract,
  AiTaskName,
  AiTaskRunner,
} from "lib/ai-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS: AiTaskRunner = {
  "generate-product-overview": generateProductOverview,
  "generate-structural-fragment": generateStructuralFragment,
  "generate-boundary-design": generateBoundaryDesign,
  "generate-implementation-profile": generateImplementationProfile,
  "generate-interface-contracts": generateInterfaceContracts,
  "generate-contract-test-scenarios": generateContractTestScenarios,
  "generate-contract-test-cases": generateContractTestCases,
  "generate-project-setup": generateProjectSetup,
  "generate-test-code": generateTestCode,
  "handle-comment": handleComment,
};

async function dispatch<Task extends AiTaskName>(
  task: Task,
  payload: AiTaskContract[Task]["params"],
): Promise<AiTaskContract[Task]["result"]> {
  return TASKS[task](payload);
}

interface RunRequestBody {
  task?: unknown;
  payload?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: RunRequestBody;
  try {
    body = await request.json() as RunRequestBody;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (
    typeof body.task !== "string" ||
    !Object.hasOwn(TASKS, body.task)
  ) {
    return Response.json({ error: "Unknown AI task." }, { status: 400 });
  }
  const task = body.task as AiTaskName;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        const result = await runWithThinkingSink(
          {
            onThinking: (text) => send("thinking", { text }),
            onSegment: () => send("segment", {}),
            signal: request.signal,
          },
          () => dispatch(task, body.payload as AiTaskContract[typeof task]["params"]),
        );
        send("result", { ok: true, result });
      } catch (error) {
        if (!request.signal.aborted) {
          send("result", {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
