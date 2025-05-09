import fs from "fs";
import path from "path";
import { Node } from "pocketflow";

import { SharedStore, NodeParams } from "../types";

interface ChapterFile {
    filename: string;
    content: string;
}

interface CombineTutorialNodePrepResult {
    outputPath: string;
    indexContent: string;
    chapterFiles: ChapterFile[];
}

export default class CombineTutorialNode extends Node<SharedStore, NodeParams> {
    async prep(shared: SharedStore): Promise<CombineTutorialNodePrepResult> {
        const projectName = shared.projectName;
        const outputBaseDir = shared.outputDir;
        const outputPath = path.join(outputBaseDir, projectName || "tutorial");

        // Get potentially translated data
        const relationshipsData = shared.relationships; // {"summary": str, "details": [{"from": int, "to": int, "label": str}]} -> summary/label may be translated
        const chapterOrder = shared.chapterOrder; // indices
        const abstractions = shared.abstractions; // list of dictionaries -> name/description may be translated
        const chaptersContent = shared.chapters; // list of strings -> content may be translated

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

        const chapterFiles: ChapterFile[] = [];
        // Generate chapter links according to determined order, using potentially translated names
        for (let i = 0; i < chapterOrder.length; i++) {
            const abstractionIndex = chapterOrder[i];
            // Ensure index is valid and we have corresponding content
            if (0 <= abstractionIndex && abstractionIndex < abstractions.length && i < chaptersContent.length) {
                const abstractionName = abstractions[abstractionIndex].name; // Potentially translated name
                // Clean potentially translated name for filename
                const safeName = abstractionName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
                const filename = `${(i + 1).toString().padStart(2, "0")}_${safeName}.md`;
                indexContent += `${i + 1}. [${abstractionName}](${filename})\n`; // Use potentially translated name in link text

                // Add attribution to chapter content (using English fixed string)
                let chapterContent = chaptersContent[i]; // Potentially translated content
                if (!chapterContent.endsWith("\n\n")) {
                    chapterContent += "\n\n";
                }
                // Keep fixed strings in English
                chapterContent += `---\n\nGenerated by [AI Codebase Knowledge Builder](https://github.com/The-Pocket/Tutorial-Codebase-Knowledge)`;

                // Store filename and corresponding content
                chapterFiles.push({ filename, content: chapterContent });
            } else {
                console.log(
                    `Warning: Mismatch between chapter order, abstractions, or content at index ${i} (abstraction index ${abstractionIndex}). Skipping file generation for this entry.`,
                );
            }
        }

        // Add attribution to index content (using English fixed string)
        indexContent += `\n\n---\n\nGenerated by [AI Codebase Knowledge Builder](https://github.com/The-Pocket/Tutorial-Codebase-Knowledge)`;

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

        console.log(`Combining tutorial into directory: ${outputPath}`);
        // Use fs.promises to ensure directory creation is done asynchronously
        fs.mkdirSync(outputPath, { recursive: true });

        // Write index.md first to ensure it's at the top of the directory listing
        const indexFilepath = path.join(outputPath, "index.md");
        fs.writeFileSync(indexFilepath, indexContent, { encoding: "utf-8" });
        console.log(`  - Wrote ${indexFilepath}`);

        // Write other chapters in parallel
        await Promise.all(
            chapterFiles.map(async chapterInfo => {
                const chapterFilepath = path.join(outputPath, chapterInfo.filename);
                fs.writeFileSync(chapterFilepath, chapterInfo.content, { encoding: "utf-8" });
                console.log(`  - Wrote ${chapterFilepath}`);
            }),
        );

        return outputPath;
    }

    /**
     * Handle follow-up operations
     */
    async post(
        shared: SharedStore,
        prepRes: CombineTutorialNodePrepResult,
        execRes: string,
    ): Promise<string | undefined> {
        shared.finalOutputDir = execRes; // Store output path
        console.log(`\nTutorial generation complete! Files are in: ${execRes}`);
        return undefined;
    }
}
