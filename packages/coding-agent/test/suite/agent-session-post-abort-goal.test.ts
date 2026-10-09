import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, it } from "vitest";

import { createHarness, type Harness } from "./harness.js";

describe("post-abort input admission with an active goal", () => {
	const harnesses: Harness[] = [];

	it("accepts a prompt after requestAbort settles with a goal active", async () => {
		const sessionRef: { requestAbort?: () => void } = {};
		const harness = await createHarness({
			initialGoal: { objective: "explore the gist author's repos" },
			tools: [
				{
					name: "aborting_tool",
					description: "aborts the run from inside the tool",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						sessionRef.requestAbort?.();
						return { output: "aborted" };
					},
				} as never,
			],
		});
		harnesses.push(harness);
		sessionRef.requestAbort = () => harness.session.requestAbort();

		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("aborting_tool", {})]),
			fauxAssistantMessage("ok, reading stuff"),
		]);

		const inFlight = harness.session.prompt("go explore");
		await inFlight.catch(() => undefined);
		await harness.session.waitForIdle();

		await harness.session.prompt("sorry, I just meant for reading stuff");
	});
});
