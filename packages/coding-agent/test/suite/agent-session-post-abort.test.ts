import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "./harness.js";

describe("post-abort input admission", () => {
	const harnesses: Harness[] = [];

	const makeAbortingTool = (requestAbort: () => void) =>
		({
			name: "aborting_tool",
			description: "aborts the run from inside the tool",
			parameters: { type: "object", properties: {} },
			execute: async () => {
				requestAbort();
				return { output: "aborted" };
			},
		}) as never;

	it("accepts a prompt after requestAbort settles", async () => {
		const sessionRef: { requestAbort?: () => void } = {};
		const harness = await createHarness({ tools: [makeAbortingTool(() => sessionRef.requestAbort?.())] });
		harnesses.push(harness);
		sessionRef.requestAbort = () => harness.session.requestAbort();

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("aborting_tool", {})]),
			fauxAssistantMessage("finished"),
		]);

		const inFlight = harness.session.prompt("do the thing");
		await inFlight.catch(() => undefined);
		await harness.session.waitForIdle();

		await harness.session.prompt("sorry, I just meant for reading stuff");
		const texts = harness.session.messages
			.filter((message) => message.role === "user")
			.map((message) =>
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join(""),
			);
		expect(texts).toContain("sorry, I just meant for reading stuff");
	});

	it("accepts a followUp after requestAbort settles", async () => {
		const harness = await createHarness({});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("working"), fauxAssistantMessage("ok")]);
		const inFlight = harness.session.prompt("do the thing");
		harness.session.requestAbort();
		await inFlight.catch(() => undefined);
		await harness.session.waitForIdle();

		await expect(harness.session.followUp("sorry, I just meant for reading stuff")).resolves.not.toThrow();
	});
});
