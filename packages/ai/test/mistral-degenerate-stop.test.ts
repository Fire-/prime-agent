import { describe, expect, it, vi } from "vitest";
import { getFixtureModel } from "./fixture-models.js";

const { activeStream } = vi.hoisted(() => ({ activeStream: { current: null as AsyncIterable<unknown> | null } }));

const { degenerateWithUsage, degenerateWithoutUsage, healthyStream } = vi.hoisted(() => {
	// Degenerate stops (pi#9674 family): GLM on Mistral ends with finish_reason
	// "stop" while billing zero completion tokens and emitting no visible content.
	const delta = (content: unknown, finishReason: string | null = null, usage?: unknown) => ({
		data: {
			id: "chatcmpl-degenerate",
			choices: [{ index: 0, delta: { role: "assistant", content }, finishReason }],
			...(usage === undefined ? {} : { usage }),
		},
	});
	const thinking = [{ type: "thinking", thinking: [{ type: "text", text: "internal reasoning only" }] }];
	const iterator = (chunks: unknown[]) => ({
		async *[Symbol.asyncIterator]() {
			yield* chunks;
		},
	});
	return {
		degenerateWithUsage: iterator([
			delta(thinking),
			delta("", "stop", { promptTokens: 318925, completionTokens: 0, totalTokens: 318925 }),
		]),
		degenerateWithoutUsage: iterator([delta(thinking), delta("", "stop")]),
		healthyStream: iterator([
			delta("Visible answer."),
			delta("", "stop", { promptTokens: 100, completionTokens: 5, totalTokens: 105 }),
		]),
	};
});

vi.mock("@mistralai/mistralai", () => ({
	HTTPClient: class {
		constructor(public options: unknown) {}
	},
	Mistral: class {
		chat = {
			stream: async () => activeStream.current,
		};
	},
}));

import { streamMistral } from "../src/providers/mistral.js";

const runStream = async () => {
	const model = getFixtureModel<"mistral-conversations">("mistral", "mistral-small-2603");
	if (!model) throw new Error("missing mistral fixture model");
	return streamMistral(
		model,
		{ messages: [{ role: "user", content: "hello", timestamp: 1 }] },
		{
			apiKey: "test-key",
		},
	).result();
};

const failureDiagnostic = (result: { diagnostics?: Array<{ type: string; details?: { kind?: string } }> }) =>
	result.diagnostics?.find((entry) => entry.type === "provider_stream_failure");

describe("Mistral degenerate stop detection", () => {
	it("fails a zero-completion-token stop as a retryable degenerate stream", async () => {
		activeStream.current = degenerateWithUsage;
		const result = await runStream();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("degenerate");
		expect(failureDiagnostic(result)?.details?.kind).toBe("degenerate_stop");
	});

	it("fails a no-usage stop with no visible content as degenerate", async () => {
		activeStream.current = degenerateWithoutUsage;
		const result = await runStream();
		expect(result.stopReason).toBe("error");
		expect(failureDiagnostic(result)?.details?.kind).toBe("degenerate_stop");
	});

	it("lets healthy stops through", async () => {
		activeStream.current = healthyStream;
		const result = await runStream();
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "Visible answer." }]);
	});
});
