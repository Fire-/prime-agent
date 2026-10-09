import { describe, expect, it, vi } from "vitest";
import { getFixtureModel } from "./fixture-models.js";

const { fakeMistralStream } = vi.hoisted(() => {
	// Chunk shape captured from a zai-glm stream on api.mistral.ai (issue
	// earendil-works/pi#8387): the tool call spans multiple deltas and only
	// the first carries the id; continuations carry just the index.
	const chunks = [
		{
			data: {
				id: "chatcmpl-96338eed",
				choices: [{ index: 0, delta: { role: "assistant", content: "" }, finishReason: null }],
			},
		},
		{
			data: {
				id: "chatcmpl-96338eed",
				choices: [
					{
						index: 0,
						delta: {
							role: "assistant",
							content: "",
							toolCalls: [
								{
									id: "chatcmpl-tool-a17da0167495e4ee",
									index: 0,
									function: { name: "read", arguments: '{"path": "update' },
								},
							],
						},
						finishReason: null,
					},
				],
			},
		},
		{
			data: {
				id: "chatcmpl-96338eed",
				choices: [
					{
						index: 0,
						delta: {
							role: "assistant",
							content: "",
							toolCalls: [
								{
									index: 0,
									function: { name: "", arguments: '.sh"}' },
								},
							],
						},
						finishReason: null,
					},
				],
			},
		},
		{
			data: {
				id: "chatcmpl-96338eed",
				choices: [{ index: 0, delta: { role: "assistant", content: "" }, finishReason: "tool_calls" }],
			},
		},
	];

	const fakeMistralStream = {
		async *[Symbol.asyncIterator]() {
			for (const chunk of chunks) {
				yield chunk;
			}
		},
	};
	return { fakeMistralStream };
});

vi.mock("@mistralai/mistralai", () => ({
	Mistral: class {
		chat = {
			stream: async () => fakeMistralStream,
		};
	},
}));

import { streamMistral } from "../src/providers/mistral.js";

describe("Mistral fragmented tool call merging", () => {
	it("merges indexed tool call continuation chunks into one tool call", async () => {
		const model = getFixtureModel<"mistral-conversations">("mistral", "mistral-small-2603");
		if (!model) throw new Error("missing mistral fixture model");

		const toolCallStarts: number[] = [];
		const stream = streamMistral(
			model,
			{ messages: [{ role: "user", content: "read update.sh", timestamp: 1 }] },
			{ apiKey: "test-key" },
		);
		for await (const event of stream) {
			if (event.type === "toolcall_start") {
				toolCallStarts.push(event.contentIndex);
			}
		}
		const result = await stream.result();

		expect(result.stopReason).toBe("toolUse");
		expect(toolCallStarts).toHaveLength(1);
		const toolCalls = result.content.filter((block) => block.type === "toolCall");
		expect(toolCalls).toHaveLength(1);
		const toolCall = toolCalls[0];
		if (toolCall.type !== "toolCall") throw new Error("expected toolCall");
		expect(toolCall.id).toBe("chatcmpl-tool-a17da0167495e4ee");
		expect(toolCall.name).toBe("read");
		expect(toolCall.arguments).toEqual({ path: "update.sh" });
	});
});
