import { BatchNode } from "pocketflow";
import { callLlm } from "../services/llm";
import { ChapterInfo, ChapterItem, SharedStore, NodeParams } from "../types";
import { getContentForIndices } from "../utils";
import { getChapterLanguageContext, capitalizeFirstLetter } from "../utils/languageUtils";
import { formatContentMap, createSafeFilename } from "../utils/fileUtils";
import { LoggerService } from "../services/logger";
import { ProgressManager, ProcessStage } from "../services/progress/progressManager";

interface WriteChaptersNodePrepResult {
    itemsToProcess: ChapterItem[];
    shared: SharedStore;
}

export default class WriteChaptersNode extends BatchNode<SharedStore, NodeParams> {
    private chaptersWrittenSoFar: string[] = [];
    private logger = LoggerService.getInstance();
    private progressManager: ProgressManager = ProgressManager.getInstance();
    private totalChapters: number = 0;
    private completedChapters: number = 0;

    async prep(shared: SharedStore): Promise<WriteChaptersNodePrepResult> {
        // Get the progress manager from params
        this.progressManager = (this._params.progressManager as ProgressManager) || ProgressManager.getInstance();

        // Start the writing chapters stage
        this.progressManager.startStage(ProcessStage.WRITING_CHAPTERS);

        // Validate API key
        const apiKey = this._params.llmApiKey as string;
        if (!apiKey) {
            this.logger.error("API key is not set. Chapter generation may fail.");
            this.progressManager.updateStageProgress(5, "Warning: API key is not set");
        } else {
            this.logger.info("API key is set");
            this.progressManager.updateStageProgress(5, "API key validated");
        }

        // Validate model
        const model = this._params.llmModel as string;
        if (!model) {
            this.logger.warn("LLM model is not specified. Using default model.");
            this.progressManager.updateStageProgress(7, "Warning: Using default LLM model");
        } else {
            this.logger.info(`Using LLM model: ${model}`);
            this.progressManager.updateStageProgress(7, `Using model: ${model}`);
        }

        // Validate required data is present
        if (!shared.chapterOrder || shared.chapterOrder.length === 0) {
            this.logger.error("Chapter order is empty or undefined. This will cause issues in chapter generation.");
            // Initialize with empty array to prevent errors
            shared.chapterOrder = [];
        }

        if (!shared.abstractions || shared.abstractions.length === 0) {
            this.logger.error(
                "Abstractions array is empty or undefined. This will cause issues in chapter generation.",
            );
            // Initialize with empty array to prevent errors
            shared.abstractions = [];
        }

        const chapterOrder = shared.chapterOrder;
        const abstractions = shared.abstractions;
        const filesData = shared.files || [];
        const language = shared.language || "english";

        // Log key information for debugging
        this.logger.info(`Chapter order length: ${chapterOrder.length}`);
        this.logger.info(`Abstractions length: ${abstractions.length}`);
        this.logger.info(`Files data length: ${filesData.length}`);

        // Reset temporary storage
        this.chaptersWrittenSoFar = [];
        this.completedChapters = 0;

        this.progressManager.updateStageProgress(10, "Preparing chapter structure...");

        // Create complete list of all chapters
        const allChapters: string[] = [];
        const chapterFilenames: Record<number, ChapterInfo> = {};

        for (let i = 0; i < chapterOrder.length; i++) {
            const abstractionIndex = chapterOrder[i];

            if (abstractionIndex >= 0 && abstractionIndex < abstractions.length) {
                const chapterNum = i + 1;
                const chapterName = abstractions[abstractionIndex].name; // Name may be translated

                // Create safe filename (from potentially translated name)
                const filename = createSafeFilename(chapterName, i);

                // Use link format (with potentially translated name)
                allChapters.push(`${chapterNum}. [${chapterName}](${filename})`);

                // Store mapping from chapter index to filename, for links
                chapterFilenames[abstractionIndex] = {
                    num: chapterNum,
                    name: chapterName,
                    filename: filename,
                };
            }
        }

        // Create formatted string containing all chapters
        const fullChapterListing = allChapters.join("\n");

        this.progressManager.updateStageProgress(20, "Collecting related file content for each chapter...");

        const itemsToProcess: ChapterItem[] = [];

        for (let i = 0; i < chapterOrder.length; i++) {
            const abstractionIndex = chapterOrder[i];

            if (abstractionIndex >= 0 && abstractionIndex < abstractions.length) {
                const abstractionDetails = abstractions[abstractionIndex]; // Contains potentially translated name/description

                // Directly use 'files' (list of indices)
                const relatedFileIndices = abstractionDetails.files || [];

                // Use helper function to get content, passing indices
                const relatedFilesContentMap = getContentForIndices(filesData, relatedFileIndices);

                // Get previous chapter info for transitions (using potentially translated names)
                let prevChapter = null;
                if (i > 0) {
                    const prevIdx = chapterOrder[i - 1];
                    prevChapter = chapterFilenames[prevIdx];
                }

                // Get next chapter info for transitions (using potentially translated names)
                let nextChapter = null;
                if (i < chapterOrder.length - 1) {
                    const nextIdx = chapterOrder[i + 1];
                    nextChapter = chapterFilenames[nextIdx];
                }

                itemsToProcess.push({
                    chapterNum: i + 1,
                    abstractionIndex: abstractionIndex,
                    abstractionDetails: abstractionDetails, // Has potentially translated name/description
                    relatedFilesContentMap: relatedFilesContentMap,
                    projectName: shared.projectName || "Unknown Project", // Add project name
                    fullChapterListing: fullChapterListing, // Add complete chapter list (using potentially translated names)
                    chapterFilenames: chapterFilenames, // Add chapter filename mapping (using potentially translated names)
                    prevChapter: prevChapter, // Add previous chapter info (using potentially translated names)
                    nextChapter: nextChapter, // Add next chapter info (using potentially translated names)
                    language: language, // Add language for multilingual support
                });
            } else {
                this.logger.warn(`Abstraction index ${abstractionIndex} in chapter order is invalid. Skipping.`);
            }
        }

        this.totalChapters = itemsToProcess.length;
        this.logger.info(`Preparing to write ${itemsToProcess.length} chapters...`);
        this.progressManager.updateStageProgress(30, `Ready to write ${itemsToProcess.length} chapters`);

        return {
            itemsToProcess,
            shared,
        }; // Iterable object for BatchNode
    }

    async exec(item: ChapterItem): Promise<string> {
        try {
            // This runs for each item prepared above
            const abstractionName = item.abstractionDetails.name || "Unknown"; // Name may be translated
            const abstractionDescription = item.abstractionDetails.description || "No description available"; // Description may be translated
            const chapterNum = item.chapterNum;
            const projectName = item.projectName || "Unknown Project";
            const language = item.language || "english";

            // Update progress for this chapter
            const progressPercent = 30 + Math.floor((this.completedChapters / this.totalChapters) * 60);
            this.progressManager.updateStageProgress(
                progressPercent,
                `Writing Chapter ${chapterNum}/${this.totalChapters}: ${abstractionName}...`,
            );

            this.logger.info(`Using LLM to write Chapter ${chapterNum}: ${abstractionName}...`);

            // Log key information for debugging
            this.logger.info(`Chapter ${chapterNum} details:`);
            this.logger.info(`  Name: ${abstractionName}`);
            this.logger.info(`  Description length: ${abstractionDescription.length} characters`);
            this.logger.info(`  Related files: ${Object.keys(item.relatedFilesContentMap).length} files`);
            this.logger.info(`  Language: ${language}`);
            this.logger.info(`  Project name: ${projectName}`);

            // Prepare file context string from mapping using utility function
            const fileContextStr = formatContentMap(item.relatedFilesContentMap);

            // Get summary of chapters written before this one
            // Use temporary instance variable
            const previousChaptersSummary = this.chaptersWrittenSoFar.join("\n---\n");

            // Use utility function to get language context
            const {
                languageInstruction,
                conceptDetailsNote,
                structureNote,
                prevSummaryNote,
                instructionLangNote,
                mermaidLangNote,
                codeCommentNote,
                linkLangNote,
                toneNote,
            } = getChapterLanguageContext(language);

            const prompt = `
    ${languageInstruction}Write a very beginner-friendly tutorial chapter (in Markdown format) for project \`${projectName}\` about the concept: "${abstractionName}". This is Chapter ${chapterNum}.

    Concept details${conceptDetailsNote}:
    - Name: ${abstractionName}
    - Description:
    ${abstractionDescription}

    Complete tutorial structure${structureNote}:
    ${item.fullChapterListing}

    Context from previous chapters${prevSummaryNote}:
    ${previousChaptersSummary || "This is the first chapter."}

    Related code snippets (code itself remains unchanged):
    ${fileContextStr || "No specific code snippets provided for this abstraction."}

    Chapter guidelines (generate content in ${capitalizeFirstLetter(language)} unless otherwise specified):
    - Start with a clear title (e.g., \`# Chapter ${chapterNum}: ${abstractionName}\`). Use the provided concept name.

    - If this is not the first chapter, begin with a brief transition referencing the previous chapter${instructionLangNote}, using appropriate Markdown links and its name${linkLangNote}.

    - Start with high-level motivation, explaining what problem this abstraction solves${instructionLangNote}. Begin with a central use case from a concrete example. The entire chapter should guide readers through how to solve this use case. Make it very concise and beginner-friendly.

    - If the abstraction is complex, break it down into key concepts. Explain each concept one by one in a very beginner-friendly way${instructionLangNote}.

    - Explain how to use this abstraction to solve the use case${instructionLangNote}. Provide example inputs and outputs for code snippets (if the output is not a value, describe at a high level what will happen${instructionLangNote}).

    - Each code block should be less than 10 lines! If longer code blocks are needed, break them down into smaller parts and explain them one by one. Actively simplify code to minimize it. Use comments${codeCommentNote} to skip unimportant implementation details. Each code block should be followed by a beginner-friendly explanation${instructionLangNote}.

    - Describe the internal implementation to help understand the underlying principles${instructionLangNote}. First provide a non-code or light-code walkthrough explaining what happens step by step when the abstraction is called${instructionLangNote}. Consider using a simple sequenceDiagram with virtual examples - keep it minimal, with at most 5 participants to ensure clarity. If participant names have spaces, use: \`participant QP as Query Processing\`.${mermaidLangNote}.

    - Then dive into the code of the internal implementation, referencing files. Provide example code blocks, but make them equally simple and beginner-friendly. Explain${instructionLangNote}.

    - Important: When you need to reference other core abstractions covered in other chapters, always use appropriate Markdown links, like: [Chapter Title](filename.md). Use the complete tutorial structure above to find the correct filenames and chapter titles${linkLangNote}. Translate the surrounding text.

    - Use mermaid diagrams to illustrate complex concepts (\`\`\`mermaid\`\`\` format).${mermaidLangNote}.

    - Use analogies and examples extensively throughout${instructionLangNote} to help beginners understand.

    - End the chapter with a brief conclusion summarizing what was learned${instructionLangNote} and provide a transition to the next chapter${instructionLangNote}. If there is a next chapter, use an appropriate Markdown link: [Next Chapter Title](next_chapter_filename)${linkLangNote}.

    - Ensure the tone is friendly and easy for newcomers to understand${toneNote}.

    - Output only the Markdown content for this chapter.

    Now, directly provide a super beginner-friendly Markdown output (no need for \`\`\`markdown\`\`\` tags):
    `;

            this.logger.info("Calling LLM to generate chapter content...");

            // Check if API key is set
            const apiKey = this._params.llmApiKey as string;
            if (!apiKey) {
                this.logger.error("API key is not set. Cannot call LLM API.");
                throw new Error("API key is not set. Please configure your API key in the extension settings.");
            }

            this.logger.info("API key is set");
            this.logger.info(`Using model: ${this._params.llmModel || "default model"}`);
            this.logger.info(`Cache enabled: ${this._params.useCache ? "yes" : "no"}`);

            let chapterContent = "";
            try {
                // Check if we should force ignore cache
                const useCache = this._params.useCache !== undefined ? (this._params.useCache as boolean) : true;

                this.logger.info(`Using cache: ${useCache ? "yes" : "no (forced generation)"}`);

                chapterContent = await callLlm(prompt, {
                    useCache: useCache,
                    llmApiKey: apiKey,
                    context: this._params.context,
                    model: this._params.llmModel as string,
                });
                this.logger.info(`Received chapter content (${chapterContent.length} characters)`);

                // Verify that we actually got content
                if (!chapterContent || chapterContent.trim().length === 0) {
                    throw new Error("LLM returned empty content");
                }
            } catch (llmError) {
                this.logger.error(
                    `LLM API call failed: ${llmError instanceof Error ? llmError.message : String(llmError)}`,
                );

                // Generate fallback content without using LLM
                this.logger.info("Generating fallback content without using LLM");
                chapterContent = this.generateFallbackContent(
                    abstractionName,
                    abstractionDescription,
                    chapterNum,
                    item,
                );
                this.logger.info(`Generated fallback content (${chapterContent.length} characters)`);
            }

            // Basic validation/cleanup
            const actualHeading = `# Chapter ${chapterNum}: ${abstractionName}`; // Use potentially translated name

            let finalContent = chapterContent;
            if (!chapterContent.trim().startsWith(`# Chapter ${chapterNum}`)) {
                // If missing or incorrect, add title, try to preserve content
                const lines = chapterContent.trim().split("\n");

                if (lines.length > 0 && lines[0].trim().startsWith("#")) {
                    // If there's some kind of title, replace it
                    lines[0] = actualHeading;
                    finalContent = lines.join("\n");
                } else {
                    // Otherwise, add to the front
                    finalContent = `${actualHeading}\n\n${chapterContent}`;
                }
            }

            // Add the generated content to our temporary list for context in the next iteration
            this.chaptersWrittenSoFar.push(finalContent);

            // Update completed chapters count
            this.completedChapters++;

            return finalContent; // Return Markdown string (may be translated)
        } catch (error) {
            // Handle any errors that occur during chapter generation
            this.logger.error(
                `Error generating chapter ${item.chapterNum}: ${error instanceof Error ? error.message : String(error)}`,
            );

            // Create a placeholder chapter with error information
            const errorChapter =
                `# Chapter ${item.chapterNum}: ${item.abstractionDetails.name || "Unknown"}\n\n` +
                `There was an error generating this chapter: ${error instanceof Error ? error.message : String(error)}\n\n` +
                `Please try regenerating the tutorial or check the logs for more information.`;

            // Still add to written chapters so we have context for future chapters
            this.chaptersWrittenSoFar.push(errorChapter);
            this.completedChapters++;

            return errorChapter;
        }
    }

    /**
     * Generate emergency placeholder content when no content is available
     * This is used when no chapter content was generated at all
     */
    private generateEmergencyPlaceholder(
        chapterNum: number,
        abstractionName: string,
        abstractionDescription: string,
        abstractionIndex: number,
    ): string {
        // Create a basic emergency placeholder
        let content = `# Chapter ${chapterNum}: ${abstractionName}\n\n`;
        content += `## Emergency Placeholder Content\n\n`;
        content += `This chapter content could not be generated properly. This is an emergency placeholder.\n\n`;
        content += `### Abstraction Details\n\n`;
        content += `- **Name**: ${abstractionName}\n`;
        content += `- **Index**: ${abstractionIndex}\n`;
        content += `- **Description**: ${abstractionDescription}\n\n`;
        content += `### Troubleshooting\n\n`;
        content += `Please check the following:\n\n`;
        content += `1. Ensure your OpenRouter API key is valid\n`;
        content += `2. Check that the selected LLM model is available\n`;
        content += `3. Try regenerating the tutorial\n`;
        content += `4. If the issue persists, try using a different model\n\n`;

        return content;
    }

    /**
     * Generate fallback content without using LLM
     * This is used when the LLM API call fails
     */
    private generateFallbackContent(
        abstractionName: string,
        abstractionDescription: string,
        chapterNum: number,
        item: ChapterItem,
    ): string {
        // Create a basic chapter structure with the available information
        let content = `# Chapter ${chapterNum}: ${abstractionName}\n\n`;

        // Add description
        content += `## Overview\n\n${abstractionDescription}\n\n`;

        // Add related files section if available
        if (Object.keys(item.relatedFilesContentMap).length > 0) {
            content += "## Related Files\n\n";
            content += "This concept is related to the following files:\n\n";

            for (const filePath of Object.keys(item.relatedFilesContentMap)) {
                content += `- \`${filePath}\`\n`;
            }
            content += "\n";
        }

        // Add a note about this being fallback content
        content += "## Note\n\n";
        content +=
            "This chapter content was automatically generated as fallback content due to an issue with the LLM API call. ";
        content += "It contains basic information about the concept but may lack detailed explanations. ";
        content +=
            "Please try regenerating the tutorial with a valid API key and model to get more comprehensive content.\n\n";

        // Add navigation links if available
        if (item.prevChapter) {
            content += `← [Previous: ${item.prevChapter.name}](${item.prevChapter.filename})\n\n`;
        }

        if (item.nextChapter) {
            content += `→ [Next: ${item.nextChapter.name}](${item.nextChapter.filename})\n\n`;
        }

        return content;
    }

    async post(
        shared: SharedStore,
        _prepRes: WriteChaptersNodePrepResult,
        execResList: string[],
    ): Promise<string | undefined> {
        // Log the length of chapter order and chapter content for diagnostic purposes
        this.logger.info(`Chapter order length: ${shared.chapterOrder.length}`);
        this.logger.info(`Generated chapters length: ${execResList.length}`);

        // Validate that we have generated content
        if (execResList.length === 0) {
            this.logger.error("No chapter content was generated! This will cause issues in the next stage.");

            // Try to recover by generating placeholder content
            if (shared.chapterOrder.length > 0) {
                this.logger.info("Attempting to recover by generating placeholder content for each chapter");
                const placeholders: string[] = [];

                for (let i = 0; i < shared.chapterOrder.length; i++) {
                    const abstractionIndex = shared.chapterOrder[i];
                    if (abstractionIndex >= 0 && abstractionIndex < shared.abstractions.length) {
                        const abstractionName = shared.abstractions[abstractionIndex].name;
                        const abstractionDescription =
                            shared.abstractions[abstractionIndex].description || "No description available";

                        // Create a more detailed placeholder with the available information
                        const placeholder = this.generateEmergencyPlaceholder(
                            i + 1,
                            abstractionName,
                            abstractionDescription,
                            abstractionIndex,
                        );
                        placeholders.push(placeholder);
                        this.logger.info(`Generated emergency placeholder for Chapter ${i + 1}: ${abstractionName}`);
                    } else {
                        const placeholder = `# Chapter ${i + 1}: Unknown\n\n## Emergency Placeholder Content\n\nThis chapter could not be generated because the abstraction index ${abstractionIndex} is invalid.\n\nPlease try regenerating the tutorial or check your configuration.`;
                        placeholders.push(placeholder);
                        this.logger.info(
                            `Generated emergency placeholder for Chapter ${i + 1} with invalid abstraction index ${abstractionIndex}`,
                        );
                    }
                }

                // Use the placeholders instead
                shared.chapters = placeholders;
                this.logger.info(
                    `Created ${placeholders.length} emergency placeholder chapters to prevent empty content`,
                );
            } else {
                this.logger.error("Cannot recover: both chapter content and chapter order are empty");
                // Initialize with empty array to prevent null/undefined errors
                shared.chapters = [];
            }
        } else if (execResList.length < shared.chapterOrder.length) {
            // We have some content, but not for all chapters
            this.logger.warn(
                `Generated content for ${execResList.length} chapters, but chapter order has ${shared.chapterOrder.length} chapters`,
            );

            // Create placeholders for the missing chapters
            const fullContent = [...execResList];

            for (let i = execResList.length; i < shared.chapterOrder.length; i++) {
                const abstractionIndex = shared.chapterOrder[i];
                if (abstractionIndex >= 0 && abstractionIndex < shared.abstractions.length) {
                    const abstractionName = shared.abstractions[abstractionIndex].name;
                    const abstractionDescription =
                        shared.abstractions[abstractionIndex].description || "No description available";

                    // Create a placeholder for the missing chapter
                    const placeholder = this.generateEmergencyPlaceholder(
                        i + 1,
                        abstractionName,
                        abstractionDescription,
                        abstractionIndex,
                    );
                    fullContent.push(placeholder);
                    this.logger.info(`Generated placeholder for missing Chapter ${i + 1}: ${abstractionName}`);
                } else {
                    const placeholder = `# Chapter ${i + 1}: Unknown\n\n## Emergency Placeholder Content\n\nThis chapter could not be generated because the abstraction index ${abstractionIndex} is invalid.\n\nPlease try regenerating the tutorial or check your configuration.`;
                    fullContent.push(placeholder);
                    this.logger.info(
                        `Generated placeholder for missing Chapter ${i + 1} with invalid abstraction index ${abstractionIndex}`,
                    );
                }
            }

            // Use the combined content
            shared.chapters = fullContent;
            this.logger.info(
                `Using ${execResList.length} generated chapters and ${fullContent.length - execResList.length} placeholder chapters`,
            );
        } else {
            // Log the mapping between abstraction indices and chapter content
            this.logger.info("Chapter mapping:");
            for (let i = 0; i < shared.chapterOrder.length && i < execResList.length; i++) {
                const abstractionIndex = shared.chapterOrder[i];
                const chapterContent = execResList[i].substring(0, 50) + "..."; // Only record the first 50 characters
                this.logger.info(
                    `  Chapter ${i + 1}: Abstraction index ${abstractionIndex}, Content: ${chapterContent}`,
                );
            }

            // execResList contains generated Markdown for each chapter, in order
            shared.chapters = execResList;
            this.logger.info(`Successfully stored ${execResList.length} chapters in shared state`);
        }

        // Clean up temporary instance variable
        this.chaptersWrittenSoFar = [];

        this.logger.info(`Completed writing ${shared.chapters.length} chapters.`);
        this.progressManager.updateStageProgress(100, `Completed writing ${shared.chapters.length} chapters`);

        // Complete the stage
        this.progressManager.completeStage();

        return undefined;
    }
}
