import fs from "fs";
import path from "path";
import { Node } from "pocketflow";
import * as vscode from "vscode";

import { SharedStore, NodeParams } from "../types";
import { LoggerService } from "../services/logger";
import { ProgressManager, ProcessStage } from "../services/progress/progressManager";

interface ChapterFile {
    filename: string;
    content: string;
}

interface CombineTutorialNodePrepResult {
    outputPath: string;
    indexContent: string;
    chapterFiles: ChapterFile[];
}

/**
 * Get the workspace directory
 * @returns The workspace directory path, or the current working directory if no workspace is open
 */
function getWorkspaceDir(): string {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return process.cwd();
}

export default class CombineTutorialNode extends Node<SharedStore, NodeParams> {
    private logger = LoggerService.getInstance();
    private progressManager: ProgressManager = ProgressManager.getInstance();

    async prep(shared: SharedStore): Promise<CombineTutorialNodePrepResult> {
        // Get the progress manager from params
        this.progressManager = (this._params.progressManager as ProgressManager) || ProgressManager.getInstance();

        // Start the combining tutorial stage
        this.progressManager.startStage(ProcessStage.COMBINING_TUTORIAL);

        const projectName = shared.projectName;
        const outputBaseDir = shared.outputDir;

        // Get the workspace directory
        const workspaceDir = getWorkspaceDir();
        this.logger.info(`Using workspace directory: ${workspaceDir}`);

        // Build the output directory path
        let finalOutputBaseDir = outputBaseDir;

        // If the output directory is a relative path, make it relative to the workspace directory
        if (!path.isAbsolute(outputBaseDir)) {
            finalOutputBaseDir = path.join(workspaceDir, outputBaseDir);
            this.logger.info(`Using output directory relative to workspace: ${finalOutputBaseDir}`);
        } else {
            this.logger.info(`Using absolute output directory: ${finalOutputBaseDir}`);
        }

        // Use a safe project name as the subdirectory
        const safeProjectName = (projectName || "tutorial").replace(/[^a-zA-Z0-9_-]/g, "_");
        const outputPath = path.join(finalOutputBaseDir, safeProjectName);

        this.logger.info(`Final output path: ${outputPath}`);

        this.progressManager.updateStageProgress(10, "Preparing tutorial content...");

        // Get potentially translated data
        const relationshipsData = shared.relationships; // {"summary": str, "details": [{"from": int, "to": int, "label": str}]} -> summary/label may be translated
        const chapterOrder = shared.chapterOrder; // indices
        const abstractions = shared.abstractions; // list of dictionaries -> name/description may be translated
        const chaptersContent = shared.chapters; // list of strings -> content may be translated

        this.progressManager.updateStageProgress(20, "Generating relationship diagram...");

        // --- Generate Mermaid diagram ---
        const mermaidLines: string[] = ["flowchart TD"];
        // Add nodes for each abstraction concept, using potentially translated names
        for (let i = 0; i < abstractions.length; i++) {
            const nodeId = `A${i}`;
            // Use potentially translated names, clean for Mermaid ID and labels
            const sanitizedName = abstractions[i].name.replace(/"/g, "");
            const nodeLabel = sanitizedName; // Only use cleaned name
            mermaidLines.push(`    ${nodeId}["${nodeLabel}"]`); // Node labels use potentially translated names
        }

        // Add edges for relationships, using potentially translated labels
        for (const rel of relationshipsData.details) {
            const fromNodeId = `A${rel.from}`;
            const toNodeId = `A${rel.to}`;
            // Use potentially translated labels, clean them
            let edgeLabel = rel.label.replace(/"/g, "").replace(/\n/g, " "); // Basic cleaning
            const maxLabelLen = 30;
            if (edgeLabel.length > maxLabelLen) {
                edgeLabel = edgeLabel.substring(0, maxLabelLen - 3) + "...";
            }
            mermaidLines.push(`    ${fromNodeId} -- "${edgeLabel}" --> ${toNodeId}`); // Edge labels use potentially translated labels
        }

        const mermaidDiagram = mermaidLines.join("\n");
        // --- End Mermaid ---

        this.progressManager.updateStageProgress(40, "Creating index page...");

        // --- Prepare index.md content ---
        let indexContent = `# Tutorial: ${projectName}\n\n`;
        indexContent += `${relationshipsData.summary}\n\n`; // Directly use potentially translated summary
        // Keep fixed strings in English

        // Add Mermaid diagram of relationships (diagram itself uses potentially translated names/labels)
        indexContent += "```mermaid\n";
        indexContent += mermaidDiagram + "\n";
        indexContent += "```\n\n";

        // Keep fixed strings in English
        indexContent += `## Chapters\n\n`;

        this.progressManager.updateStageProgress(60, "Preparing chapter files...");

        // First, log some debug information to help diagnose issues
        this.logger.info(`Chapter order length: ${chapterOrder.length}`);
        this.logger.info(`Abstractions length: ${abstractions.length}`);
        this.logger.info(`Chapters content length: ${chaptersContent.length}`);

        // Log the chapter order
        this.logger.info("Chapter order:");
        for (let i = 0; i < chapterOrder.length; i++) {
            const abstractionIndex = chapterOrder[i];
            if (0 <= abstractionIndex && abstractionIndex < abstractions.length) {
                const abstractionName = abstractions[abstractionIndex].name;
                this.logger.info(`  Chapter ${i + 1}: Abstraction index ${abstractionIndex}, Name: ${abstractionName}`);
            } else {
                this.logger.info(`  Chapter ${i + 1}: Invalid abstraction index ${abstractionIndex}`);
            }
        }

        // Log the first 50 characters of each chapter content
        this.logger.info("Chapter content:");
        for (let i = 0; i < chaptersContent.length; i++) {
            const content = chaptersContent[i].substring(0, 50) + "...";
            this.logger.info(`  Content ${i + 1}: ${content}`);
        }

        // Create a mapping from position index to chapter content
        // Note: The order of chaptersContent array should match the order of chapterOrder array
        // i.e., chaptersContent[i] corresponds to the abstraction specified by chapterOrder[i]
        const chapterContentMap: Map<number, string> = new Map();

        // Verify that the chapter content array length matches the chapter order array length
        if (chaptersContent.length !== chapterOrder.length) {
            this.logger.warn(
                `Warning: Chapters content length (${chaptersContent.length}) does not match chapter order length (${chapterOrder.length})`,
            );
        }

        const chapterFiles: ChapterFile[] = [];
        // First generate chapter links for the index page
        for (let i = 0; i < chapterOrder.length; i++) {
            const abstractionIndex = chapterOrder[i];
            // Ensure the abstraction index is valid
            if (0 <= abstractionIndex && abstractionIndex < abstractions.length) {
                const abstractionName = abstractions[abstractionIndex].name; // Potentially translated name
                // Clean potentially translated name for filename
                const safeName = abstractionName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
                const filename = `${(i + 1).toString().padStart(2, "0")}_${safeName}.md`;
                indexContent += `${i + 1}. [${abstractionName}](${filename})\n`; // Use potentially translated name in link text

                // Associate chapter content with position index
                if (i < chaptersContent.length) {
                    // Use position index as key, not abstraction index
                    // This ensures that chapterContentMap.get(i) returns chaptersContent[i]
                    chapterContentMap.set(i, chaptersContent[i]);
                } else {
                    this.logger.warn(
                        `No content available for chapter ${i + 1} (abstraction index ${abstractionIndex})`,
                    );
                }
            } else {
                this.logger.warn(`Invalid abstraction index ${abstractionIndex} at position ${i} in chapter order`);
            }
        }

        // Then generate chapter files
        for (let i = 0; i < chapterOrder.length; i++) {
            const abstractionIndex = chapterOrder[i];

            // Ensure the abstraction index is valid and has corresponding chapter content
            if (
                0 <= abstractionIndex &&
                abstractionIndex < abstractions.length &&
                chapterContentMap.has(i) // Use position index i instead of abstraction index
            ) {
                const abstractionName = abstractions[abstractionIndex].name; // Potentially translated name
                const safeName = abstractionName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
                const filename = `${(i + 1).toString().padStart(2, "0")}_${safeName}.md`;

                // Get the corresponding chapter content
                let chapterContent = chapterContentMap.get(i)!; // Use position index i

                // Log the first 50 characters of the chapter content for diagnostic purposes
                this.logger.info(`Chapter ${i + 1} content starts with: ${chapterContent.substring(0, 50)}...`);

                // Add attribution information
                if (!chapterContent.endsWith("\n\n")) {
                    chapterContent += "\n\n";
                }
                // Keep fixed strings in English
                chapterContent += `---\n\nGenerated by [AI Codebase Knowledge Builder](https://github.com/The-Pocket/Tutorial-Codebase-Knowledge)`;

                // Store filename and content
                chapterFiles.push({ filename, content: chapterContent });
                this.logger.info(`Prepared chapter file: ${filename} for abstraction index ${abstractionIndex}`);
            } else {
                this.logger.warn(
                    `Mismatch between chapter order, abstractions, or content at index ${i} (abstraction index ${abstractionIndex}). Skipping file generation for this entry.`,
                );

                // Log more detailed error information
                if (!(0 <= abstractionIndex && abstractionIndex < abstractions.length)) {
                    this.logger.error(
                        `Invalid abstraction index: ${abstractionIndex} is out of range [0, ${abstractions.length - 1}]`,
                    );
                }
                if (!chapterContentMap.has(i)) {
                    this.logger.error(`No content available for position index ${i}`);
                }
            }
        }

        // Add attribution to index content (using English fixed string)
        indexContent += `\n\n---\n\nGenerated by [AI Codebase Knowledge Builder](https://github.com/The-Pocket/Tutorial-Codebase-Knowledge)`;

        this.progressManager.updateStageProgress(80, "Tutorial content prepared");

        return {
            outputPath,
            indexContent,
            chapterFiles, // List of {"filename": str, "content": str}
        };
    }

    /**
     * Execute tutorial generation
     */
    async exec(prepRes: CombineTutorialNodePrepResult): Promise<string> {
        const { outputPath, indexContent, chapterFiles } = prepRes;

        this.logger.info(`Combining tutorial into directory: ${outputPath}`);
        this.progressManager.updateStageProgress(85, `Creating output directory: ${outputPath}`);

        try {
            // Log current working directory and output path information
            this.logger.info(`Current working directory: ${process.cwd()}`);
            this.logger.info(`Output path (absolute): ${path.resolve(outputPath)}`);

            // Ensure the parent directory of the output directory exists
            const parentDir = path.dirname(outputPath);
            this.logger.info(`Parent directory: ${parentDir}`);

            if (!fs.existsSync(parentDir)) {
                this.logger.info(`Parent directory does not exist, creating: ${parentDir}`);
                fs.mkdirSync(parentDir, { recursive: true });

                // Verify that the parent directory was created successfully
                if (fs.existsSync(parentDir)) {
                    this.logger.info(`Parent directory created successfully`);
                } else {
                    throw new Error(`Failed to create parent directory: ${parentDir}`);
                }
            } else {
                this.logger.info(`Parent directory already exists`);
            }

            // Create the output directory
            if (!fs.existsSync(outputPath)) {
                this.logger.info(`Creating output directory: ${outputPath}`);
                fs.mkdirSync(outputPath, { recursive: true });

                // Verify that the output directory was created successfully
                if (fs.existsSync(outputPath)) {
                    this.logger.info(`Output directory created successfully`);
                } else {
                    throw new Error(`Failed to create output directory: ${outputPath}`);
                }
            } else {
                this.logger.info(`Output directory already exists`);
            }

            this.progressManager.updateStageProgress(90, "Writing index file...");

            // Write index.md first to ensure it's at the top of the directory listing
            const indexFilepath = path.join(outputPath, "index.md");
            fs.writeFileSync(indexFilepath, indexContent, { encoding: "utf-8" });
            this.logger.info(`Wrote ${indexFilepath}`);

            this.progressManager.updateStageProgress(95, "Writing chapter files...");

            // Write other chapters in parallel
            await Promise.all(
                chapterFiles.map(async chapterInfo => {
                    const chapterFilepath = path.join(outputPath, chapterInfo.filename);
                    fs.writeFileSync(chapterFilepath, chapterInfo.content, { encoding: "utf-8" });
                    this.logger.info(`Wrote ${chapterFilepath}`);
                }),
            );

            this.progressManager.updateStageProgress(100, "All files written successfully");

            return outputPath;
        } catch (error) {
            this.logger.error(
                `Error writing tutorial files: ${error instanceof Error ? error.message : String(error)}`,
            );

            // Provide more detailed error information
            if (error instanceof Error) {
                if (error.message.includes("ENOENT")) {
                    const parentDir = path.dirname(outputPath);
                    this.logger.error(`ENOENT error details - Output path: ${outputPath}, Parent dir: ${parentDir}`);

                    // Try to check parent directory permissions
                    try {
                        if (fs.existsSync(parentDir)) {
                            // Parent directory exists, might be a permissions issue
                            this.logger.error(`Parent directory exists but may not be writable: ${parentDir}`);
                            throw new Error(
                                `Failed to create directory: ${outputPath}. The parent directory (${parentDir}) exists but may not be writable.`,
                            );
                        } else {
                            // Parent directory doesn't exist, might be a path issue
                            this.logger.error(`Parent directory does not exist: ${parentDir}`);

                            // Try to create an alternative directory in the workspace
                            const workspaceDir = getWorkspaceDir();

                            const tempOutputDir = path.join(workspaceDir, "agentic-wiki-output");
                            this.logger.info(
                                `Attempting to create alternative output directory in workspace: ${tempOutputDir}`,
                            );

                            if (!fs.existsSync(tempOutputDir)) {
                                fs.mkdirSync(tempOutputDir, { recursive: true });
                            }

                            throw new Error(
                                `Failed to create directory: ${outputPath}. ` +
                                    `The parent directory (${parentDir}) does not exist. ` +
                                    `Please try one of the following solutions:\n` +
                                    `1. Set the output directory to a relative path like "agentic-wiki" in the extension settings, which will create it in your workspace.\n` +
                                    `2. Set the output directory to "${tempOutputDir}" in the extension settings.\n` +
                                    `3. Manually create the directory "${parentDir}" and try again.`,
                            );
                        }
                    } catch (checkError) {
                        // If an error occurs during the check, use the original error
                        if (checkError instanceof Error && checkError.message !== error.message) {
                            throw checkError;
                        } else {
                            throw new Error(
                                `Failed to create directory: ${outputPath}. Please ensure the parent directory (${parentDir}) exists and is writable.`,
                            );
                        }
                    }
                } else if (error.message.includes("permission")) {
                    // Permission error
                    throw new Error(
                        `Permission denied when creating directory: ${outputPath}. Please check your file system permissions.`,
                    );
                } else {
                    // Other errors
                    throw new Error(
                        `Failed to write tutorial files: ${error.message}. Please check the output directory configuration.`,
                    );
                }
            } else {
                // Unknown error
                throw new Error(
                    `Failed to write tutorial files due to an unknown error. Please check the output directory configuration.`,
                );
            }
        }
    }

    /**
     * Handle follow-up operations
     */
    async post(shared: SharedStore, _: CombineTutorialNodePrepResult, execRes: string): Promise<string | undefined> {
        shared.finalOutputDir = execRes; // Store output path
        this.logger.info(`Tutorial generation complete! Files are in: ${execRes}`);

        // Complete the stage
        this.progressManager.completeStage();

        return undefined;
    }
}
