import path from "path";
import { Node } from "pocketflow";
import { crawlLocalFilesAsync } from "../services/file";
import { FileInfo, SharedStore, NodeParams } from "../types";
import { LoggerService } from "../services/logger";
import { ProgressManager, ProcessStage } from "../services/progress/progressManager";

export default class FetchRepoNode extends Node<SharedStore, NodeParams> {
    private logger = LoggerService.getInstance();
    private progressManager: ProgressManager = ProgressManager.getInstance();

    async prep(shared: SharedStore): Promise<SharedStore> {
        // Read repo from shared
        const projectName = path.basename(path.resolve(shared.localDir));
        shared.projectName = projectName;

        // Get the progress manager from params
        this.progressManager = (this._params.progressManager as ProgressManager) || ProgressManager.getInstance();

        // Start the file fetching stage
        this.progressManager.startStage(ProcessStage.FETCHING_FILES);

        return shared;
    }

    async exec(preRes: SharedStore): Promise<FileInfo[]> {
        this.logger.info(`Fetching directory: ${preRes.localDir}...`);

        try {
            // Report initial progress
            this.progressManager.updateStageProgress(0, "Scanning directory...");

            // Check for cancellation
            if (this.progressManager.isCancelled()) {
                throw new Error("Operation cancelled by user");
            }

            // Use the new async crawl service with progress reporting
            const result = await crawlLocalFilesAsync(
                preRes.localDir,
                preRes.includePatterns,
                preRes.excludePatterns,
                preRes.maxFileSize * 1024,
                true, // useRelativePaths
                (current, total, filePath) => {
                    // Report progress during file processing
                    const percent = Math.round((current / total) * 100);
                    const shortPath =
                        filePath.length > 30 ? "..." + filePath.substring(filePath.length - 30) : filePath;

                    this.progressManager.updateStageProgress(
                        percent,
                        `Scanning files: ${percent}% (${current}/${total}) - ${shortPath}`,
                    );

                    // Check for cancellation during processing
                    if (this.progressManager.isCancelled()) {
                        throw new Error("Operation cancelled by user");
                    }
                },
            );

            if (result.files.length === 0) {
                throw new Error(`No files found in directory: ${preRes.localDir}`);
            }

            this.logger.info(`Fetched ${result.files.length} files.`);
            this.progressManager.updateStageProgress(100, `Found ${result.files.length} files to process`);

            return result.files;
        } catch (error) {
            this.logger.error(`Error fetching files: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    async post(shared: SharedStore, _: unknown, execRes: FileInfo[]): Promise<string | undefined> {
        // Store the repo in shared
        shared.files = execRes;

        // Complete the stage
        this.progressManager.completeStage();

        return undefined;
    }
}
