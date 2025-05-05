import fs from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";
import { minimatch } from "minimatch";
import ignore from "ignore";
import { FileInfo } from "../../types";
import { LoggerService } from "../logger";
import { hasFileChanged, updateFileHash } from "../cache/fileHashCache";

interface CrawlResult {
    files: FileInfo[];
    unchanged?: number; // Count of unchanged files that were skipped
}

/**
 * Asynchronously crawl files in a local directory
 * @param directory Local directory path
 * @param includePatterns File patterns to include (e.g., ["*.py", "*.js"])
 * @param excludePatterns File patterns to exclude (e.g., ["tests/*"])
 * @param maxFileSize Maximum file size (bytes)
 * @param useRelativePaths Whether to use paths relative to the directory
 * @param progressCallback Optional callback for reporting progress
 * @param incrementalProcessing Whether to use incremental processing (skip unchanged files)
 * @param workspaceId Workspace identifier for incremental processing
 * @returns {Promise<CrawlResult>} Object containing file paths and contents
 */
export async function crawlLocalFilesAsync(
    directory: string,
    includePatterns?: string[],
    excludePatterns?: string[],
    maxFileSize?: number,
    useRelativePaths: boolean = true,
    progressCallback?: (current: number, total: number, path: string) => void,
    incrementalProcessing: boolean = false,
    workspaceId?: string,
): Promise<CrawlResult> {
    const logger = LoggerService.getInstance();

    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
        throw new Error(`Directory does not exist: ${directory}`);
    }

    const filesList: FileInfo[] = [];
    const pendingFiles: { path: string; relativePath: string }[] = [];

    // --- Load .gitignore ---
    const gitignorePath = path.join(directory, ".gitignore");
    let gitignoreSpec: ReturnType<typeof ignore> | null = null;

    if (existsSync(gitignorePath)) {
        try {
            const gitignoreContent = await fs.readFile(gitignorePath, "utf-8");
            const gitignorePatterns = gitignoreContent.split("\n");
            gitignoreSpec = ignore().add(gitignorePatterns);
            logger.info(`Loaded .gitignore patterns from ${gitignorePath}`);
        } catch (e) {
            logger.warn(`Unable to read or parse .gitignore file ${gitignorePath}: ${e}`);
        }
    }
    // --- End loading .gitignore ---

    // First pass: collect all file paths to process
    await collectFilePaths(directory, directory, useRelativePaths);

    // Second pass: process files in batches to avoid memory issues
    const batchSize = 50; // Process 50 files at a time
    const totalFiles = pendingFiles.length;
    let unchangedCount = 0;

    // Validate workspace ID for incremental processing
    if (incrementalProcessing && !workspaceId) {
        logger.warn(
            "Incremental processing requested but no workspace ID provided. Using directory name as workspace ID.",
        );
        workspaceId = path.basename(directory);
    }

    for (let i = 0; i < pendingFiles.length; i += batchSize) {
        const batch = pendingFiles.slice(i, i + batchSize);
        const results = await Promise.all(
            batch.map(async (fileInfo, index) => {
                try {
                    // Report progress if callback provided
                    if (progressCallback) {
                        progressCallback(i + index, totalFiles, fileInfo.path);
                    }

                    const stats = await fs.stat(fileInfo.path);

                    // Skip if file is too large
                    if (maxFileSize && stats.size > maxFileSize) {
                        return null;
                    }

                    // Check if file has changed (for incremental processing)
                    if (incrementalProcessing && workspaceId) {
                        const fileChanged = await hasFileChanged(workspaceId, fileInfo.path);

                        if (!fileChanged) {
                            // File hasn't changed, skip processing
                            unchangedCount++;
                            logger.debug(`Skipping unchanged file: ${fileInfo.path}`);
                            return null;
                        }
                    }

                    // Read file content
                    const content = await fs.readFile(fileInfo.path, "utf-8");

                    // Update file hash for incremental processing
                    if (incrementalProcessing && workspaceId) {
                        await updateFileHash(workspaceId, fileInfo.path, content);
                    }

                    return { path: fileInfo.relativePath, content };
                } catch (e) {
                    logger.warn(`Unable to read file ${fileInfo.path}: ${e}`);
                    return null;
                }
            }),
        );

        // Add valid results to filesList
        results.filter(Boolean).forEach(result => {
            if (result) {
                filesList.push(result);
            }
        });
    }

    return {
        files: filesList,
        unchanged: incrementalProcessing ? unchangedCount : undefined,
    };

    // Helper function to collect all file paths recursively
    async function collectFilePaths(rootDir: string, currentPath: string, useRelativePaths: boolean) {
        const items = await fs.readdir(currentPath);

        for (const item of items) {
            const itemPath = path.join(currentPath, item);
            const stats = await fs.stat(itemPath);

            // Get relative path
            const relPath = useRelativePaths ? path.relative(rootDir, itemPath) : itemPath;

            // --- Exclusion checks ---
            let excluded = false;

            // 1. First check .gitignore
            if (gitignoreSpec && gitignoreSpec.ignores(relPath)) {
                excluded = true;
            }

            // 2. If not excluded by .gitignore, check standard exclusion patterns
            if (!excluded && excludePatterns) {
                for (const pattern of excludePatterns) {
                    if (minimatch(relPath, pattern)) {
                        excluded = true;
                        break;
                    }
                }
            }

            // If it's a directory and not excluded, traverse recursively
            if (stats.isDirectory() && !excluded) {
                await collectFilePaths(rootDir, itemPath, useRelativePaths);
                continue;
            }

            // If not a file or already excluded, skip
            if (!stats.isFile() || excluded) {
                continue;
            }

            // Check inclusion patterns
            let included = false;
            if (!includePatterns || includePatterns?.includes("*")) {
                included = true;
            } else {
                for (const pattern of includePatterns) {
                    if (minimatch(relPath, pattern)) {
                        included = true;
                        break;
                    }
                }
            }

            // If not included, skip
            if (!included) {
                continue;
            }

            // Add to pending files list
            pendingFiles.push({ path: itemPath, relativePath: relPath });
        }
    }
}
