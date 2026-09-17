import { describe, expect, it } from "vitest";
import {
    computeRecommendationRows,
    patchForSlots,
    recommendationHash,
    type RecommendationRowsInput,
} from "./recommendation-update.js";
import { MythrilApiConfig } from "./mythril-account.js";

describe("recommendationHash", () => {
    it("hashes the legacy bare-string and object wire shapes identically", () => {
        expect(recommendationHash({ openai: "gpt-5.4" }, "openai"))
            .toBe(recommendationHash({ openai: { assistantModel: "gpt-5.4" } }, "openai"));
        expect(recommendationHash({ openai: "gpt-5.4" }, "openai"))
            .toBe(recommendationHash({ openai: { assistantModel: { model: "gpt-5.4" } } }, "openai"));
    });

    it("is independent of task key order", () => {
        const a = { mythril: { assistantModel: "Auto", taskModels: { chatTitle: "lite", subagent: "lite" } } };
        const b = { mythril: { assistantModel: "Auto", taskModels: { subagent: "lite", chatTitle: "lite" } } };
        expect(recommendationHash(a, "mythril")).toBe(recommendationHash(b, "mythril"));
    });

    it("changes when the model, effort, or a task recommendation changes", () => {
        const base = recommendationHash({ openai: "gpt-5.4" }, "openai");
        expect(recommendationHash({ openai: "gpt-5.5" }, "openai")).not.toBe(base);
        expect(recommendationHash({ openai: { assistantModel: { model: "gpt-5.4", effort: "high" } } }, "openai")).not.toBe(base);
        expect(recommendationHash({ openai: { assistantModel: "gpt-5.4", taskModels: { chatTitle: "gpt-5.4-mini" } } }, "openai")).not.toBe(base);
    });

    it("treats an unrecognized effort as Auto once the wire shape is parsed", () => {
        const schema = MythrilApiConfig.shape.modelRecommendations;
        const lenient = schema.parse({ openai: { assistantModel: { model: "gpt-5.4", effort: "minimal" } } });
        expect(recommendationHash(lenient, "openai")).toBe(recommendationHash({ openai: "gpt-5.4" }, "openai"));
    });

    it("is null for a flavor with no recommendation", () => {
        expect(recommendationHash({ openai: "gpt-5.4" }, "ollama")).toBeNull();
        expect(recommendationHash(undefined, "openai")).toBeNull();
    });
});

describe("computeRecommendationRows", () => {
    const mythrilRecs = {
        mythril: {
            assistantModel: "Auto",
            taskModels: { knowledgeGraph: "Auto-background", chatTitle: "Auto-background", subagent: "Auto-background" },
        },
    };
    const listed = ["Auto", "Auto-background", "google/gemini-3.5-flash", "google/gemini-3.5-flash-lite"];

    function input(overrides: Partial<RecommendationRowsInput> = {}): RecommendationRowsInput {
        return {
            providerId: "mythril",
            flavor: "mythril",
            availableModelIds: listed,
            recommendations: mythrilRecs,
            assistantModel: { provider: "mythril", model: "google/gemini-3.5-flash" },
            taskModels: {},
            ...overrides,
        };
    }

    it("proposes the assistant and every differing task slot", () => {
        const rows = computeRecommendationRows(input());
        expect(rows.map((r) => r.slot)).toEqual(["assistantModel", "knowledgeGraph", "chatTitle", "subagent"]);
        expect(rows[0]).toEqual({
            slot: "assistantModel",
            current: { provider: "mythril", model: "google/gemini-3.5-flash" },
            recommended: { provider: "mythril", model: "Auto" },
        });
        expect(rows[1]).toEqual({
            slot: "knowledgeGraph",
            current: null,
            recommended: { provider: "mythril", model: "Auto-background" },
        });
    });

    it("is empty when the config already matches", () => {
        const rows = computeRecommendationRows(input({
            assistantModel: { provider: "mythril", model: "Auto" },
            taskModels: {
                knowledgeGraph: { provider: "mythril", model: "Auto-background" },
                chatTitle: { provider: "mythril", model: "Auto-background" },
                subagent: { provider: "mythril", model: "Auto-background" },
            },
        }));
        expect(rows).toEqual([]);
    });

    it("treats a task recommendation equal to the recommended assistant as inherit", () => {
        const recs = { openai: { assistantModel: "gpt-5.4", taskModels: { chatTitle: "gpt-5.4" } } };
        const rows = computeRecommendationRows(input({
            providerId: "openai",
            flavor: "openai",
            availableModelIds: ["gpt-5.4", "gpt-5.4-mini"],
            recommendations: recs,
            assistantModel: { provider: "openai", model: "gpt-5.4" },
            taskModels: { chatTitle: { provider: "openai", model: "gpt-5.4-mini" } },
        }));
        expect(rows).toEqual([{
            slot: "chatTitle",
            current: { provider: "openai", model: "gpt-5.4-mini" },
            recommended: null,
        }]);
    });

    it("skips recommendations the provider does not list instead of proposing inherit", () => {
        const rows = computeRecommendationRows(input({ availableModelIds: ["google/gemini-3.5-flash", "Auto"] }));
        expect(rows.map((r) => r.slot)).toEqual(["assistantModel"]);
    });

    it("leaves task overrides pinned to another provider alone", () => {
        const rows = computeRecommendationRows(input({
            taskModels: { knowledgeGraph: { provider: "ollama", model: "llama3" } },
        }));
        expect(rows.map((r) => r.slot)).toEqual(["assistantModel", "chatTitle", "subagent"]);
    });

    it("compares effort as part of the choice", () => {
        const recs = { openai: { assistantModel: { model: "gpt-5.4", effort: "high" as const } } };
        const rows = computeRecommendationRows(input({
            providerId: "openai",
            flavor: "openai",
            availableModelIds: ["gpt-5.4"],
            recommendations: recs,
            assistantModel: { provider: "openai", model: "gpt-5.4" },
        }));
        expect(rows).toEqual([{
            slot: "assistantModel",
            current: { provider: "openai", model: "gpt-5.4" },
            recommended: { provider: "openai", model: "gpt-5.4", effort: "high" },
        }]);
    });

    it("is empty when the assistant is on a different provider or the flavor has no recommendation", () => {
        expect(computeRecommendationRows(input({ assistantModel: { provider: "openai", model: "gpt-5.4" } }))).toEqual([]);
        expect(computeRecommendationRows(input({ flavor: "ollama" }))).toEqual([]);
    });
});

describe("patchForSlots", () => {
    const rows = computeRecommendationRows({
        providerId: "mythril",
        flavor: "mythril",
        availableModelIds: ["Auto", "Auto-background", "old", "lite"],
        recommendations: { mythril: { assistantModel: "Auto", taskModels: { chatTitle: "Auto-background", subagent: "Auto" } } },
        assistantModel: { provider: "mythril", model: "old" },
        taskModels: { subagent: { provider: "mythril", model: "lite" } },
    });

    it("writes only the checked slots; a checked inherit row clears the override", () => {
        expect(patchForSlots(rows, ["assistantModel", "subagent"])).toEqual({
            assistantModel: { provider: "mythril", model: "Auto" },
            taskModels: { subagent: null },
        });
    });

    it("ignores slots that have no row", () => {
        expect(patchForSlots(rows, ["knowledgeGraph"])).toEqual({});
        expect(patchForSlots(rows, [])).toEqual({});
    });
});
