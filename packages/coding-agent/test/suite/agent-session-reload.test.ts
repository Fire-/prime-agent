import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseSessionSlashCommand } from "../../src/core/slash-commands.js";
import { createHarness, getAssistantTexts, getMessageText, type Harness } from "./harness.js";

describe("AgentSession /reload session command", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("parses /reload as a session command", () => {
		const command = parseSessionSlashCommand("/reload");
		expect(command?.name).toBe("reload");
		expect(parseSessionSlashCommand("/reload now")?.name).toBe("reload");
	});

	it("reloads settings, MCP, and the runtime, then settles with a result row", async () => {
		const harness = await createHarness({});
		harnesses.push(harness);
		harness.setResponses([]);
		const reloadSpy = vi.spyOn(harness.settingsManager, "reload");

		await harness.session.prompt("/reload");

		expect(reloadSpy).toHaveBeenCalledTimes(1);
		const resultRow = harness.session.messages.find(
			(message) =>
				message.role === "custom" &&
				(message as { customType?: string }).customType === "session_slash_command_result",
		);
		expect(resultRow).toBeDefined();
		expect(getMessageText(resultRow)).toBe("Reloaded settings, MCP servers, and runtime.");

		// reload() resets the API-provider registry down to the built-ins, which
		// drops the test faux registration; re-register it under the same api id
		// so the rebuilt runtime can stream the follow-up turn.
		const freshFaux = registerFauxProvider({ api: harness.faux.api });
		try {
			freshFaux.setResponses([fauxAssistantMessage("post-reload reply")]);
			await harness.session.prompt("still there?");
			expect(getAssistantTexts(harness).at(-1)).toBe("post-reload reply");
		} finally {
			freshFaux.unregister();
		}
	});
});
