import { Node } from "pocketflow";
import YAML from "yaml";
import { callLlm } from "../services/llm";
import { ChapterOrderPreResult, SharedStore, NodeParams } from "../types";
import { getLanguageListNote, capitalizeFirstLetter } from "../utils/languageUtils";
import { formatAbstractionListing } from "../utils/fileUtils";
import { LoggerService } from "../services/logger";
import { ProgressManager, ProcessStage } from "../services/progress/progressManager";

export default class OrderChaptersNode extends Node<SharedStore, NodeParams> {
    private logger = LoggerService.getInstance();
    private progressManager: ProgressManager = ProgressManager.getInstance();

    async prep(shared: SharedStore): Promise<ChapterOrderPreResult> {
        // Get the progress manager from params
        this.progressManager = (this._params.progressManager as ProgressManager) || ProgressManager.getInstance();

        // Start the ordering chapters stage
        this.progressManager.startStage(ProcessStage.ORDERING_CHAPTERS);

        const abstractions = shared.abstractions; // Names/descriptions may be translated
        const relationships = shared.relationships; // Summary/labels may be translated
        const projectName = shared.projectName || "";
        const language = shared.language || "english";
        const useCache = shared.useCache !== undefined ? shared.useCache : true;

        this.progressManager.updateStageProgress(20, "Preparing abstraction context for ordering...");

        // Prepare context for LLM
        const abstractionInfoForPrompt: Array<{ index: number; name: string }> = [];
        for (let i = 0; i < abstractions.length; i++) {
            abstractionInfoForPrompt.push({ index: i, name: abstractions[i].name }); // Use potentially translated names
        }
        const abstractionListing = formatAbstractionListing(abstractionInfoForPrompt);

        // Use potentially translated summary and labels
        let summaryNote = "";
        if (language.toLowerCase() !== "english") {
            summaryNote = ` (Note: Project Summary might be in ${capitalizeFirstLetter(language)})`;
        }

        let context = `Project Summary${summaryNote}:\n${relationships.summary}\n\n`;
        context += "Relationships (Indices refer to abstractions above):\n";
        for (const rel of relationships.details) {
            const fromName = abstractions[rel.from].name;
            const toName = abstractions[rel.to].name;
            // Use potentially translated 'label'
            context += `- From ${rel.from} (${fromName}) to ${rel.to} (${toName}): ${rel.label}\n`;
        }

        const listLangNote = getLanguageListNote(language);
        const apiKey = shared.llmApiKey;

        this.progressManager.updateStageProgress(40, "Context prepared for chapter ordering");

        return {
            abstractionListing,
            context,
            numAbstractions: abstractions.length,
            projectName,
            listLangNote,
            useCache,
            apiKey,
            model: shared.llmModel,
        };
    }

    async exec(prepRes: ChapterOrderPreResult): Promise<number[]> {
        const { abstractionListing, context, numAbstractions, projectName, listLangNote, useCache } = prepRes;

        this.logger.info("Determining chapter order using LLM...");
        this.progressManager.updateStageProgress(50, "Building prompt for chapter ordering...");

        // No need to change language in prompt instructions, just sort based on structure
        // Input names may be translated, hence the note
        const prompt = `
    Given the following project abstractions and their relationships for the project \`\`\`\` ${projectName} \`\`\`\`:

    Abstractions (Index # Name)${listLangNote}:
    ${abstractionListing}

    Context about relationships and project summary:
    ${context}

    If you are going to make a tutorial for \`\`\`\` ${projectName} \`\`\`\`, what is the best order to explain these abstractions, from first to last?
    Ideally, first explain those that are the most important or foundational, perhaps user-facing concepts or entry points. Then move to more detailed, lower-level implementation details or supporting concepts.

    Output the ordered list of abstraction indices, including the name in a comment for clarity. Use the format \`idx # AbstractionName\`.

    \`\`\`yaml
    - 2 # FoundationalConcept
    - 0 # CoreClassA
    - 1 # CoreClassB (uses CoreClassA)
    - ...
    \`\`\`

    Now, provide the YAML output:
    `;

        this.progressManager.updateStageProgress(60, "Calling LLM to determine chapter order...");

        const response = await callLlm(prompt, {
            llmApiKey: prepRes.apiKey,
            useCache,
            context: this._params.context,
            model: prepRes.model,
        });

        this.progressManager.updateStageProgress(80, "Validating chapter order...");

        // --- Validation ---
        const yamlStr = response.trim().split("```yaml")[1].split("```")[0].trim();
        const orderedIndicesRaw = YAML.parse(yamlStr) as any[];

        if (!Array.isArray(orderedIndicesRaw)) {
            throw new Error("LLM output is not a list");
        }

        const orderedIndices: number[] = [];
        const seenIndices = new Set<number>();

        for (const entry of orderedIndicesRaw) {
            try {
                let idx: number;

                if (typeof entry === "number") {
                    idx = entry;
                } else if (typeof entry === "string" && entry.includes("#")) {
                    idx = parseInt(entry.split("#")[0].trim(), 10);
                } else {
                    idx = parseInt(String(entry).trim(), 10);
                }

                if (!(0 <= idx && idx < numAbstractions)) {
                    throw new Error(`Invalid index ${idx} in ordered list. Max index is ${numAbstractions - 1}.`);
                }

                if (seenIndices.has(idx)) {
                    throw new Error(`Duplicate index ${idx} found in ordered list.`);
                }

                orderedIndices.push(idx);
                seenIndices.add(idx);
            } catch (error) {
                throw new Error(`Could not parse index from ordered list entry: ${entry}`);
            }
        }

        // Check if all abstractions are included
        if (orderedIndices.length !== numAbstractions) {
            const missingIndices = [...Array(numAbstractions).keys()].filter(i => !seenIndices.has(i));

            throw new Error(
                `Ordered list length (${orderedIndices.length}) does not match number of abstractions (${numAbstractions}). Missing indices: ${missingIndices}`,
            );
        }

        this.logger.info(`Determined chapter order (indices): ${orderedIndices}`);
        this.progressManager.updateStageProgress(
            100,
            `Determined optimal chapter order for ${orderedIndices.length} chapters`,
        );

        return orderedIndices; // Return list of indices
    }

    async post(shared: SharedStore, _: ChapterOrderPreResult, execRes: number[]): Promise<string | undefined> {
        // execRes is already the ordered index list
        shared.chapterOrder = execRes; // Index list

        // Complete the stage
        this.progressManager.completeStage();

        return undefined;
    }
}
