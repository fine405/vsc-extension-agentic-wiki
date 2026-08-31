import fs from "fs";
import path from "path";
import { minimatch } from "minimatch";
import ignore from "ignore";
import { FileInfo } from "../../types";
import { LoggerService } from "../logger";

interface CrawlResult {
    files: FileInfo[];
}

/**
 * Crawl files in a local directory, using an interface similar to crawlGithubFiles
 * @param directory Local directory path
 * @param includePatterns File patterns to include (e.g., ["*.py", "*.js"])
 * @param excludePatterns File patterns to exclude (e.g., ["tests/*"])
 * @param maxFileSize Maximum file size (KB)
 * @param useRelativePaths Whether to use paths relative to the directory
 * @returns {CrawlResult} Object containing file paths and contents
 */
export function crawlLocalFiles(
    directory: string,
    includePatterns?: string[],
    excludePatterns?: string[],
    maxFileSize?: number,
    useRelativePaths: boolean = true,
): CrawlResult {
    const logger = LoggerService.getInstance();

    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        throw new Error(`Directory does not exist: ${directory}`);
    }

    const filesList: FileInfo[] = [];

    // --- Load .gitignore ---
    const gitignorePath = path.join(directory, ".gitignore");
    let gitignoreSpec: ReturnType<typeof ignore> | null = null;

    if (fs.existsSync(gitignorePath)) {
        try {
            const gitignorePatterns = fs.readFileSync(gitignorePath, "utf-8").split("\n");
            gitignoreSpec = ignore().add(gitignorePatterns);
            logger.info(`Loaded .gitignore patterns from ${gitignorePath}`);
        } catch (e) {
            logger.warn(`Unable to read or parse .gitignore file ${gitignorePath}: ${e}`);
        }
    }
    // --- End loading .gitignore ---

    // Recursively traverse directory
    function traverseDirectory(currentPath: string) {
        const items = fs.readdirSync(currentPath);

        for (const item of items) {
            const itemPath = path.join(currentPath, item);
            const stats = fs.statSync(itemPath);

            // Get relative path
            const relPath = useRelativePaths ? path.relative(directory, itemPath) : itemPath;

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
                traverseDirectory(itemPath);
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

            // Check file size
            // maxFileSize is specified in KB, stats.size is in bytes
            if (maxFileSize && stats.size > maxFileSize * 1024) {
                continue;
            }

            // Read file content
            try {
                const content = fs.readFileSync(itemPath, "utf-8");
                filesList.push({ path: relPath, content });
            } catch (e) {
                logger.warn(`Unable to read file ${itemPath}: ${e}`);
            }
        }
    }

    // Start traversal
    traverseDirectory(directory);

    return { files: filesList };
}
