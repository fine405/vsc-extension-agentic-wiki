import { Node } from "pocketflow";
import YAML from "yaml";

import { Abstraction, FileInfo, IdentifyAbstractionsPrepResult, SharedStore, NodeParams } from "../types";
import { callLlm } from "../services/llm";
import { getLanguageInstruction, getLanguageHint } from "../utils/languageUtils";
import { formatAbstractionListing } from "../utils/fileUtils";
import { LoggerService } from "../services/logger";
import { ProgressManager, ProcessStage } from "../services/progress/progressManager";

export default class IdentifyAbstractionsNode extends Node<SharedStore, NodeParams> {
    private logger = LoggerService.getInstance();
    private progressManager: ProgressManager = ProgressManager.getInstance();

    // Build LLM context and parameters
    async prep(shared: SharedStore): Promise<IdentifyAbstractionsPrepResult> {
        // Get the progress manager from params
        this.progressManager = (this._params.progressManager as ProgressManager) || ProgressManager.getInstance();

        // Start the identifying abstractions stage
        this.progressManager.startStage(ProcessStage.IDENTIFYING_ABSTRACTIONS);

        const filesData: FileInfo[] = shared.files || [];
        const projectName: string = shared.projectName || "Unknown Project";
        const language: string = shared.language || "english";
        const useCache: boolean = shared.useCache !== undefined ? shared.useCache : true;
        const maxAbstractionNum: number = shared.maxAbstractionNum || 10;

        if (filesData.length === 0) {
            throw new Error("Cannot identify abstractions because there is no file data.");
        }

        this.progressManager.updateStageProgress(10, "Preparing file context for analysis...");

        const { context, fileInfo } = this.createLlmContext(filesData);
        const fileListingForPrompt = formatAbstractionListing(fileInfo);

        this.progressManager.updateStageProgress(30, "Context prepared, ready to identify abstractions");

        return {
            context,
            fileListingForPrompt,
            fileCount: filesData.length,
            projectName,
            language,
            useCache,
            maxAbstractionNum,
            apiKey: shared.llmApiKey,
            model: shared.llmModel,
        };
    }

    // Call LLM to identify abstractions and validate results
    async exec(preRes: IdentifyAbstractionsPrepResult): Promise<Abstraction[]> {
        const { context, fileListingForPrompt, fileCount, projectName, language, useCache, maxAbstractionNum } = preRes;
        this.logger.info("Using LLM to identify abstractions...");

        this.progressManager.updateStageProgress(40, "Building prompt for abstraction identification...");

        const prompt = this.buildPrompt(projectName, context, language, maxAbstractionNum, fileListingForPrompt);

        this.progressManager.updateStageProgress(50, "Calling LLM to identify abstractions...");

        // Pass the extension context from flow parameters if available
        const response = await callLlm(prompt, {
            useCache,
            llmApiKey: preRes.apiKey,
            context: this._params.context,
            model: preRes.model,
        });

        this.progressManager.updateStageProgress(80, "Validating LLM response...");

        const validatedAbstractions = this.parseAndValidateResponse(response, fileCount);

        this.logger.info(`Identified ${validatedAbstractions.length} abstractions.`);
        this.progressManager.updateStageProgress(100, `Identified ${validatedAbstractions.length} abstractions`);

        return validatedAbstractions;
    }

    // Store results in shared storage
    async post(shared: SharedStore, _: unknown, execRes: Abstraction[]): Promise<string | undefined> {
        shared.abstractions = execRes;

        // Complete the stage
        this.progressManager.completeStage();

        return undefined;
    }

    private createLlmContext(filesData: FileInfo[]) {
        const contextParts: string[] = [];
        const fileInfo: Array<{ index: number; path: string }> = [];

        filesData.forEach((file, index) => {
            contextParts.push(`--- File Index ${index}: ${file.path} ---\n${file.content}\n\n`);
            fileInfo.push({ index, path: file.path });
        });

        return {
            context: contextParts.join(""),
            fileInfo,
        };
    }

    private buildPrompt(
        projectName: string,
        context: string,
        language: string,
        maxAbstractionNum: number,
        fileListingForPrompt: string,
    ): string {
        // Use utility functions for language handling
        const languageInstruction = getLanguageInstruction(language, ["name", "description"]);
        const nameLangHint = getLanguageHint(language, " (value in");
        const descLangHint = getLanguageHint(language, " (value in");

        return `
For the project \`${projectName}\`:

Codebase Context:
${context}

${languageInstruction}Analyze the codebase context.
Identify the top 5-${maxAbstractionNum} core most important abstractions to help those new to the codebase.

For each abstraction, provide:
1. A concise \`name\`${nameLangHint}.
2. A beginner-friendly \`description\` explaining what it is with a simple analogy, in around 100 words${descLangHint}.
3. A list of relevant \`file_indices\` (integers) using the format \`idx # path/comment\`.

List of file indices and paths present in the context:
${fileListingForPrompt}

Format the output as a YAML list of dictionaries:

\`\`\`yaml
- name: |
    Query Processing${nameLangHint}
  description: |
    Explains what the abstraction does.
    It's like a central dispatcher routing requests.${descLangHint}
  file_indices:
    - 0 # path/to/file1.ts
    - 3 # path/to/related.ts
- name: |
    Query Optimization${nameLangHint}
  description: |
    Another core concept, similar to a blueprint for objects.${descLangHint}
  file_indices:
    - 5 # path/to/another.js
# ... up to ${maxAbstractionNum} abstractions
\`\`\``;
    }

    private parseAndValidateResponse(response: string, fileCount: number): Abstraction[] {
        let yamlStr = "";
        try {
            yamlStr = response.trim().split("```yaml")[1].split("```")[0].trim();
        } catch (error) {
            throw new Error(`Unable to extract YAML content from LLM response: ${response}`);
        }

        let rawAbstractions: any;
        try {
            rawAbstractions = YAML.parse(yamlStr);
        } catch (error: any) {
            throw new Error(`YAML parsing failed: ${error.message}\nYAML content:\n${yamlStr}`);
        }

        if (!Array.isArray(rawAbstractions)) {
            throw new Error(`LLM output is not a list (array). Actual type: ${typeof rawAbstractions}`);
        }

        return this.validateAbstractions(rawAbstractions, fileCount);
    }

    private validateAbstractions(rawAbstractions: any[], fileCount: number): Abstraction[] {
        const validatedAbstractions: Abstraction[] = [];

        for (const item of rawAbstractions) {
            if (typeof item !== "object" || item === null) {
                console.warn(`Skipping invalid abstraction item (not an object): ${JSON.stringify(item)}`);
                continue;
            }

            if (
                !item.name ||
                typeof item.name !== "string" ||
                !item.description ||
                typeof item.description !== "string" ||
                !item.file_indices ||
                !Array.isArray(item.file_indices)
            ) {
                throw new Error(
                    `Abstraction item missing required keys (name, description, file_indices) or type error: ${JSON.stringify(item)}`,
                );
            }

            const validatedIndices = this.validateFileIndices(item.file_indices, fileCount, item.name);

            validatedAbstractions.push({
                name: item.name.trim(),
                description: item.description.trim(),
                files: validatedIndices,
            });
        }

        if (validatedAbstractions.length === 0 && rawAbstractions.length > 0) {
            throw new Error("All abstraction items returned from LLM are invalid.");
        }

        return validatedAbstractions;
    }

    private validateFileIndices(rawIndices: any[], fileCount: number, abstractionName: string): number[] {
        const validatedIndices: Set<number> = new Set(); // Use Set to remove duplicates

        for (const idxEntry of rawIndices) {
            let idx: number | null = null;
            try {
                if (typeof idxEntry === "number") {
                    idx = idxEntry;
                } else if (typeof idxEntry === "string") {
                    // Try to match "number # comment" or just number
                    const match = idxEntry.match(/^\s*(\d+)/);
                    if (match) {
                        idx = parseInt(match[1], 10);
                    } else {
                        throw new Error(`Cannot parse index from string '${idxEntry}'`);
                    }
                } else {
                    throw new Error(`Invalid index entry type: ${typeof idxEntry}`);
                }

                if (idx === null || isNaN(idx) || idx < 0 || idx >= fileCount) {
                    throw new Error(`Invalid file index ${idx}. Valid range is 0 to ${fileCount - 1}.`);
                }
                validatedIndices.add(idx);
            } catch (error: any) {
                // Wrap error message, provide more context
                throw new Error(
                    `Failed to parse file index for abstraction "${abstractionName}": entry '${idxEntry}', error: ${error.message}`,
                );
            }
        }
        // Sort and convert to array
        return Array.from(validatedIndices).sort((a, b) => a - b);
    }
}
