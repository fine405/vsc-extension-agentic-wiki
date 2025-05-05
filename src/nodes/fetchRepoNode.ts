import path from "path";
import { Node } from "pocketflow";
import { crawlLocalFilesAsync } from "../services/file";
import { FileInfo, SharedStore, NodeParams } from "../types";
import * as vscode from "vscode";
import { LoggerService } from "../services/logger";

export default class FetchRepoNode extends Node<SharedStore, NodeParams> {
    private progress: vscode.Progress<{ message?: string; increment?: number }> | undefined;
    private token: vscode.CancellationToken | undefined;
    private logger = LoggerService.getInstance();

    async prep(shared: SharedStore): Promise<SharedStore> {
        // Read repo from shared
        const projectName = path.basename(path.resolve(shared.localDir));
        shared.projectName = projectName;

        // Store progress and token if available from params
        if (this._params.progress) {
            this.progress = this._params.progress as vscode.Progress<{ message?: string; increment?: number }>;
        }

        if (this._params.token) {
            this.token = this._params.token as vscode.CancellationToken;
        }

        return shared;
    }

    async exec(preRes: SharedStore): Promise<FileInfo[]> {
        this.logger.info(`Fetching directory: ${preRes.localDir}...`);

        try {
            // Report initial progress
            this.reportProgress(0, "Scanning directory...");

            // Check for cancellation
            if (this.token?.isCancellationRequested) {
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
                    this.reportProgress(
                        (percent / 100) * 30, // Use 30% of the total progress bar for file scanning
                        `Scanning files: ${percent}% (${current}/${total}) - ${shortPath}`,
                    );

                    // Check for cancellation during processing
                    if (this.token?.isCancellationRequested) {
                        throw new Error("Operation cancelled by user");
                    }
                },
            );

            if (result.files.length === 0) {
                throw new Error(`No files found in directory: ${preRes.localDir}`);
            }

            this.logger.info(`Fetched ${result.files.length} files.`);
            this.reportProgress(30, `Found ${result.files.length} files to process`);

            return result.files;
        } catch (error) {
            this.logger.error(`Error fetching files: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    async post(shared: SharedStore, _: unknown, execRes: FileInfo[]): Promise<string | undefined> {
        // Store the repo in shared
        shared.files = execRes;
        return undefined;
    }

    private reportProgress(increment: number, message: string): void {
        if (this.progress) {
            this.progress.report({ increment, message });
        }
    }
}
