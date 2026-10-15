import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.js";
import type { ExecuteResult } from "../src/core/kernel/index.js";
import { createIpythonToolDefinition, type IpythonKernelProvisioner } from "../src/core/tools/ipython.js";

interface RecordedUpdate {
	content: Array<{ type: string; text?: string }>;
	details?: { status?: string };
}

function makeDeferredManager(): {
	manager: unknown;
	release: () => void;
} {
	const deferred: { release: () => void } = { release: () => {} };
	const manager = {
		execute: (_code: string, options: { onStream?: (chunk: string, name: "stdout" | "stderr") => void }) => {
			options.onStream?.("partial output\n", "stdout");
			return new Promise<ExecuteResult>((resolve) => {
				deferred.release = () =>
					resolve({
						stdout: "",
						stderr: "",
						status: "ok",
						durationMs: 0,
					});
			});
		},
	};
	return { manager, release: () => deferred.release() };
}

describe("ipython tool silent-cell heartbeat", () => {
	it("emits still-running updates while a cell produces no output", async () => {
		vi.useFakeTimers();
		try {
			const { manager, release } = makeDeferredManager();
			const provisioner = {
				ensure: async () => manager,
			} as unknown as IpythonKernelProvisioner;
			const definition = createIpythonToolDefinition("/tmp", { provisioner });
			const updates: RecordedUpdate[] = [];
			assertDefinition(definition);

			const promise = definition.execute(
				"call-1",
				{ code: "pass" },
				undefined,
				(update) => updates.push(update as RecordedUpdate),
				undefined as unknown as ExtensionContext,
			);

			await vi.advanceTimersByTimeAsync(30_000);
			const heartbeat = updates.find((update) => update.content[0]?.text?.includes("still running"));
			expect(heartbeat).toBeDefined();
			expect(heartbeat?.content[0]?.text).toContain("partial output\n");
			expect(heartbeat?.content[0]?.text).toContain("(30s elapsed)");

			release();
			await promise;
			const countAfterCompletion = updates.length;
			await vi.advanceTimersByTimeAsync(120_000);
			expect(updates.length).toBe(countAfterCompletion);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not heartbeat while output is streaming", async () => {
		vi.useFakeTimers();
		try {
			let streamInterval: ReturnType<typeof setInterval> | undefined;
			const manager = {
				execute: (_code: string, options: { onStream?: (chunk: string, name: "stdout" | "stderr") => void }) => {
					return new Promise<ExecuteResult>((resolve) => {
						streamInterval = setInterval(() => options.onStream?.("tick\n", "stdout"), 1_000);
						setTimeout(() => {
							clearInterval(streamInterval);
							resolve({ stdout: "", stderr: "", status: "ok", durationMs: 0 });
						}, 65_000);
					});
				},
			};
			const provisioner = {
				ensure: async () => manager,
			} as unknown as IpythonKernelProvisioner;
			const definition = createIpythonToolDefinition("/tmp", { provisioner });
			const updates: RecordedUpdate[] = [];
			assertDefinition(definition);

			const promise = definition.execute(
				"call-2",
				{ code: "pass" },
				undefined,
				(update) => updates.push(update as RecordedUpdate),
				undefined as unknown as ExtensionContext,
			);
			await vi.advanceTimersByTimeAsync(65_000);
			await promise;
			expect(updates.find((update) => update.content[0]?.text?.includes("still running"))).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});

function assertDefinition(definition: ReturnType<typeof createIpythonToolDefinition>): void {
	if (!definition.execute) {
		throw new Error("ipython tool definition must expose execute");
	}
}
