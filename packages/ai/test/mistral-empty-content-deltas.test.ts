import { describe, expect, it, vi } from "vitest";
import { getFixtureModel } from "./fixture-models.js";

const { fakeStream } = vi.hoisted(() => {
	// pi#9674: GLM models on Mistral send empty content deltas around thinking
	// bursts; opening a block for them splits reasoning across blocks.
	const delta = (content: unknown, finishReason: string | null = null) => ({
		data: { id: "chatcmpl-empty", choices: [{ index: 0, delta: { role: "assistant", content }, finishReason }] },
	});
	const chunks = [
		delta([{ type: "thinking", thinking: [{ type: "text", text: "first part," }] }]),
		delta(""),
		delta([
			{ type: "thinking", thinking: [{ type: "text", text: " second part." }] },
			{ type: "text", text: "Reading." },
		]),
		delta("", "stop"),
	];
	return {
		fakeStream: {
			async *[Symbol.asyncIterator]() {
				yield* chunks;
			},
		},
	};
});

vi.mock("@mistralai/mistralai", () => ({
	HTTPClient: class {
		constructor(public options: unknown) {}
	},
	Mistral: class {
		chat = {
			stream: async () => fakeStream,
		};
	},
}));

import { streamMistral } from "../src/providers/mistral.js";

describe("Mistral empty content deltas", () => {
	it("ignores empty deltas so thinking is not split", async () => {
		const model = getFixtureModel<"mistral-conversations">("mistral", "mistral-small-2603");
		if (!model) throw new Error("missing mistral fixture model");
		const result = await streamMistral(
			model,
			{ messages: [{ role: "user", content: "read update.sh", timestamp: 1 }] },
			{ apiKey: "test-key" },
		).result();
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "first part, second part." },
			{ type: "text", text: "Reading." },
		]);
	});
});
