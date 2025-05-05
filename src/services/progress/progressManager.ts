import * as vscode from "vscode";
import { LoggerService } from "../logger";

/**
 * Stages of the wiki generation process
 */
export enum ProcessStage {
    INITIALIZING = "Initializing",
    FETCHING_FILES = "Fetching Files",
    IDENTIFYING_ABSTRACTIONS = "Identifying Abstractions",
    ANALYZING_RELATIONSHIPS = "Analyzing Relationships",
    ORDERING_CHAPTERS = "Ordering Chapters",
    WRITING_CHAPTERS = "Writing Chapters",
    COMBINING_TUTORIAL = "Combining Tutorial",
    COMPLETED = "Completed"
}

/**
 * Progress weights for each stage (out of 100)
 */
const STAGE_WEIGHTS = {
    [ProcessStage.INITIALIZING]: 5,
    [ProcessStage.FETCHING_FILES]: 15,
    [ProcessStage.IDENTIFYING_ABSTRACTIONS]: 20,
    [ProcessStage.ANALYZING_RELATIONSHIPS]: 15,
    [ProcessStage.ORDERING_CHAPTERS]: 10,
    [ProcessStage.WRITING_CHAPTERS]: 25,
    [ProcessStage.COMBINING_TUTORIAL]: 10,
    [ProcessStage.COMPLETED]: 0
};

/**
 * Manager for tracking and reporting progress across the wiki generation process
 */
export class ProgressManager {
    private static instance: ProgressManager;
    private progress: vscode.Progress<{ message?: string; increment?: number }> | undefined;
    private token: vscode.CancellationToken | undefined;
    private currentStage: ProcessStage = ProcessStage.INITIALIZING;
    private stageProgress: Map<ProcessStage, number> = new Map();
    private totalProgress: number = 0;
    private logger = LoggerService.getInstance();
    private lastReportedProgress: number = 0;

    private constructor() {
        // Initialize stage progress
        Object.values(ProcessStage).forEach(stage => {
            this.stageProgress.set(stage as ProcessStage, 0);
        });
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): ProgressManager {
        if (!ProgressManager.instance) {
            ProgressManager.instance = new ProgressManager();
        }
        return ProgressManager.instance;
    }

    /**
     * Set the progress and token objects
     */
    public setProgressObjects(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): void {
        this.progress = progress;
        this.token = token;
    }

    /**
     * Start a new stage
     */
    public startStage(stage: ProcessStage): void {
        this.currentStage = stage;
        this.stageProgress.set(stage, 0);
        this.reportProgress(0, `${stage}...`);
        this.logger.info(`Starting stage: ${stage}`);
    }

    /**
     * Update progress within the current stage
     * @param percentage Percentage of the current stage (0-100)
     * @param message Optional message to display
     */
    public updateStageProgress(percentage: number, message?: string): void {
        if (percentage < 0) percentage = 0;
        if (percentage > 100) percentage = 100;

        // Update stage progress
        this.stageProgress.set(this.currentStage, percentage);
        
        // Calculate total progress
        this.calculateTotalProgress();
        
        // Report progress
        const stageMessage = message || `${this.currentStage}: ${Math.round(percentage)}%`;
        this.reportProgress(this.totalProgress - this.lastReportedProgress, stageMessage);
        this.lastReportedProgress = this.totalProgress;
    }

    /**
     * Complete the current stage
     */
    public completeStage(): void {
        this.stageProgress.set(this.currentStage, 100);
        this.calculateTotalProgress();
        this.reportProgress(this.totalProgress - this.lastReportedProgress, `${this.currentStage} completed`);
        this.lastReportedProgress = this.totalProgress;
        this.logger.info(`Completed stage: ${this.currentStage}`);
    }

    /**
     * Check if the operation has been cancelled
     */
    public isCancelled(): boolean {
        return this.token?.isCancellationRequested || false;
    }

    /**
     * Get the current stage
     */
    public getCurrentStage(): ProcessStage {
        return this.currentStage;
    }

    /**
     * Reset the progress manager for a new run
     */
    public reset(): void {
        this.currentStage = ProcessStage.INITIALIZING;
        this.totalProgress = 0;
        this.lastReportedProgress = 0;
        Object.values(ProcessStage).forEach(stage => {
            this.stageProgress.set(stage as ProcessStage, 0);
        });
    }

    /**
     * Calculate the total progress based on stage weights and progress
     */
    private calculateTotalProgress(): void {
        let total = 0;
        let totalWeight = 0;
        
        // Sum up weighted progress for each stage
        this.stageProgress.forEach((progress, stage) => {
            const weight = STAGE_WEIGHTS[stage];
            total += (progress / 100) * weight;
            totalWeight += weight;
        });
        
        // Calculate total progress as percentage
        this.totalProgress = (total / totalWeight) * 100;
    }

    /**
     * Report progress to VS Code
     */
    private reportProgress(increment: number, message: string): void {
        if (this.progress) {
            this.progress.report({ 
                increment: Math.max(0, increment), 
                message 
            });
        }
        this.logger.debug(`Progress: ${message} (${Math.round(this.totalProgress)}%)`);
    }
}
