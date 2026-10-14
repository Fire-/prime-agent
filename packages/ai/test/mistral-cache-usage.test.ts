import { afterEach, describe, expect, it, vi } from "vitest";
import { streamMistral } from "../src/providers/mistral.js";
import { getFixtureModel } from "./fixture-models.js";

// The SDK's inbound zod schema strips cache fields (prompt_tokens_details) from
// usage, so streamMistral tees the raw SSE body and re-applies the wire numbers.
const sseBody = [
	'data: {"id":"cache-test","object":"chat.completion.chunk","created":1,"model":"mistral-small","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}',
	"",
	'data: {"id":"cache-test","object":"chat.completion.chunk","created":1,"model":"mistral-small","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":100,"completion_tokens":2,"total_tokens":102,"prompt_tokens_details":{"cached_tokens":60}}}',
	"",
	"data: [DONE]",
	"",
].join("\n");

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Mistral raw cache usage capture", () => {
	it("recovers cached prompt tokens the SDK schema strips", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(sseBody, { status: 200, headers: { "content-type": "text/event-stream" } })),
		);
		const model = getFixtureModel<"mistral-conversations">("mistral", "mistral-small-2603");
		if (!model) throw new Error("missing mistral fixture model");
		const result = await streamMistral(
			model,
			{ messages: [{ role: "user", content: "hello", timestamp: 1 }] },
			{
				apiKey: "test-key",
			},
		).result();
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "Hi" }]);
		expect(result.usage).toMatchObject({
			input: 40,
			output: 2,
			cacheRead: 60,
			cacheWrite: 0,
			totalTokens: 102,
		});
	});
});
