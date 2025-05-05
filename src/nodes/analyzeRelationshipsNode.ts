import YAML from "yaml";
import { Node } from "pocketflow";
import {
    Abstraction,
    FileInfo,
    SharedStore,
    AnalyzeRelationshipsPrepResult,
    RelationshipsResult,
    Relationship,
    NodeParams,
} from "../types";
import { callLlm } from "../services/llm";
import { getLanguageInstruction, getLanguageHint, getLanguageListNote } from "../utils/languageUtils";
import { formatFileContent, formatAbstractionListing } from "../utils/fileUtils";
import { LoggerService } from "../services/logger";
import { ProgressManager, ProcessStage } from "../services/progress/progressManager";

export default class AnalyzeRelationshipsNode extends Node<SharedStore, NodeParams> {
    private logger = LoggerService.getInstance();
    private progressManager: ProgressManager = ProgressManager.getInstance();

    /**
     * Prepare context and data needed for relationship analysis
     */
    async prep(shared: SharedStore): Promise<AnalyzeRelationshipsPrepResult> {
        // Get the progress manager from params
        this.progressManager = (this._params.progressManager as ProgressManager) || ProgressManager.getInstance();

        // Start the analyzing relationships stage
        this.progressManager.startStage(ProcessStage.ANALYZING_RELATIONSHIPS);

        const abstractions: Abstraction[] = shared.abstractions || [];
        const filesData: FileInfo[] = shared.files || [];
        const projectName: string = shared.projectName || "Unknown Project";
        const language: string = shared.language || "english";
        const useCache: boolean = shared.useCache !== undefined ? shared.useCache : true;

        this.progressManager.updateStageProgress(10, "Preparing abstraction context...");

        // Create context with abstraction names, indices, descriptions, and relevant file snippets
        let context = "Identified Abstractions:\n";
        const allRelevantIndices = new Set<number>();
        const abstractionInfoForPrompt: Array<{ index: number; name: string }> = [];

        // Process each abstraction
        for (let i = 0; i < abstractions.length; i++) {
            const abstr = abstractions[i];
            // Use 'files' that directly includes indices
            const fileIndicesStr = abstr.files.join(", ");

            // Abstraction name and description might be translated
            const infoLine = `- Index ${i}: ${abstr.name} (Relevant file indices: [${fileIndicesStr}])\n  Description: ${abstr.description}`;
            context += infoLine + "\n";

            // Also use potentially translated names here
            abstractionInfoForPrompt.push({ index: i, name: abstr.name });

            // Collect all relevant file indices
            abstr.files.forEach(idx => allRelevantIndices.add(idx));
        }

        this.progressManager.updateStageProgress(30, "Collecting relevant file snippets...");

        // Add relevant file snippets
        context += "\nRelevant File Snippets (Referenced by Index and Path):\n";

        // Format file content using utility function
        context += formatFileContent(filesData, Array.from(allRelevantIndices).sort());

        this.progressManager.updateStageProgress(50, "Context prepared for relationship analysis");

        return {
            context,
            abstractionListing: formatAbstractionListing(abstractionInfoForPrompt),
            projectName,
            language,
            useCache,
            numAbstractions: abstractions.length,
            apiKey: shared.llmApiKey!,
            model: shared.llmModel,
        };
    }

    /**
     * Execute relationship analysis
     */
    async exec(prepRes: AnalyzeRelationshipsPrepResult): Promise<RelationshipsResult> {
        const { context, abstractionListing, projectName, language, useCache, numAbstractions } = prepRes;

        this.logger.info("Using LLM to analyze relationships...");
        this.progressManager.updateStageProgress(60, "Building prompt for relationship analysis...");

        // Build prompt
        const prompt = this.buildPrompt(projectName, abstractionListing, context, language);

        this.progressManager.updateStageProgress(70, "Calling LLM to analyze relationships...");

        // Call LLM with extension context
        const response = await callLlm(prompt, {
            useCache,
            llmApiKey: prepRes.apiKey,
            context: this._params.context,
            model: prepRes.model,
        });

        this.progressManager.updateStageProgress(90, "Validating relationship data...");

        // Parse and validate response
        const result = this.parseAndValidateResponse(response, numAbstractions);

        this.logger.info("Project summary and relationship details generated.");
        this.progressManager.updateStageProgress(
            100,
            `Identified ${result.details.length} relationships between abstractions`,
        );

        return result;
    }

    /**
     * Process results and store in shared storage
     */
    async post(shared: SharedStore, _: unknown, execRes: RelationshipsResult): Promise<string | undefined> {
        // Structure is now {"summary": str, "details": [{"from": int, "to": int, "label": str}]}
        // summary and label might be translated
        shared.relationships = execRes;

        // Complete the stage
        this.progressManager.completeStage();

        return undefined;
    }

    private extractYamlFromResponse(response: string): string {
        try {
            return response.trim().split("```yaml")[1].split("```")[0].trim();
        } catch (error) {
            throw new Error(`Failed to extract YAML content from LLM response: ${response}`);
        }
    }

    private validateRelationshipsData(data: any): boolean {
        if (!data || typeof data !== "object") {
            throw new Error("LLM output is not an object");
        }

        if (!("summary" in data) || !("relationships" in data)) {
            throw new Error("LLM output is missing required keys ('summary', 'relationships')");
        }

        if (typeof data.summary !== "string") {
            throw new Error("summary is not a string");
        }

        if (!Array.isArray(data.relationships)) {
            throw new Error("relationships is not an array");
        }

        return true;
    }

    private validateRelationships(relationshipsData: any, numAbstractions: number): Relationship[] {
        const validatedRelationships: Relationship[] = [];

        for (const rel of relationshipsData.relationships) {
            // Check required keys
            if (
                !rel ||
                typeof rel !== "object" ||
                !("from_abstraction" in rel) ||
                !("to_abstraction" in rel) ||
                !("label" in rel)
            ) {
                throw new Error(
                    `Missing keys (expected from_abstraction, to_abstraction, label) in relationship item: ${JSON.stringify(rel)}`,
                );
            }

            // Validate label is string
            if (typeof rel.label !== "string") {
                throw new Error(`Relationship label is not a string: ${JSON.stringify(rel)}`);
            }

            // Validate indices
            try {
                const fromIdx = parseInt(String(rel.from_abstraction).split("#")[0].trim());
                const toIdx = parseInt(String(rel.to_abstraction).split("#")[0].trim());

                if (!(0 <= fromIdx && fromIdx < numAbstractions) || !(0 <= toIdx && toIdx < numAbstractions)) {
                    throw new Error(
                        `Invalid indices in relationship: from=${fromIdx}, to=${toIdx}. Maximum index is ${numAbstractions - 1}.`,
                    );
                }

                validatedRelationships.push({
                    from: fromIdx,
                    to: toIdx,
                    label: rel.label, // Potentially translated label
                });
            } catch (error) {
                throw new Error(`Failed to parse indices from relationship: ${JSON.stringify(rel)}`);
            }
        }

        return validatedRelationships;
    }

    private parseAndValidateResponse(response: string, numAbstractions: number): RelationshipsResult {
        const yamlStr = this.extractYamlFromResponse(response);

        let relationshipsData: any;
        try {
            relationshipsData = YAML.parse(yamlStr);
        } catch (error: any) {
            throw new Error(`YAML parsing failed: ${error.message}\nYAML content:\n${yamlStr}`);
        }

        this.validateRelationshipsData(relationshipsData);
        const validatedRelationships = this.validateRelationships(relationshipsData, numAbstractions);

        return {
            summary: relationshipsData.summary,
            details: validatedRelationships,
        };
    }

    private buildPrompt(projectName: string, abstractionListing: string, context: string, language: string): string {
        // Use utility functions for language handling
        const languageInstruction = getLanguageInstruction(language, ["summary", "label"]);
        const langHint = getLanguageHint(language);
        const listLangNote = getLanguageListNote(language);

        return `
      Based on the following abstractions and relevant code snippets from the project \`${projectName}\`:

      List of Abstraction Indices and Names${listLangNote}:
      ${abstractionListing}

      Context (Abstractions, Descriptions, Code):
      ${context}

      ${languageInstruction}Please provide:
      1. A high-level \`summary\` of the project's main purpose and functionality in a few beginner-friendly sentences${langHint}. Use markdown formatting with **bold** and *italic* text to highlight important concepts.
      2. A list (\`relationships\`) describing the key interactions between these abstractions. For each relationship, specify:
          - \`from_abstraction\`: Index of the source abstraction (e.g., \`0 # AbstractionName1\`)
          - \`to_abstraction\`: Index of the target abstraction (e.g., \`1 # AbstractionName2\`)
          - \`label\`: A brief label for the interaction **in just a few words**${langHint} (e.g., "Manages", "Inherits", "Uses").
          Ideally the relationship should be backed by one abstraction calling or passing parameters to another.
          Simplify the relationship and exclude those non-important ones.

      IMPORTANT: Make sure EVERY abstraction is involved in at least ONE relationship (either as source or target). Each abstraction index must appear at least once across all relationships.

      Format the output as YAML:

      \`\`\`yaml
      summary: |
        A brief, simple explanation of the project${langHint}.
        Can span multiple lines with **bold** and *italic* for emphasis.
      relationships:
        - from_abstraction: 0 # AbstractionName1
          to_abstraction: 1 # AbstractionName2
          label: "Manages"${langHint}
        - from_abstraction: 2 # AbstractionName3
          to_abstraction: 0 # AbstractionName1
          label: "Provides config"${langHint}
        # ... other relationships
      \`\`\`

      Now, provide the YAML output:`;
    }
}
