import * as vscode from "vscode";
import { CONFIG_KEY } from "../constants";
import { createFlow } from "../flow";
import { SharedStore } from "../types";
import { secretsManager } from "../extension";
import { ProgressManager, ProcessStage } from "../services/progress/progressManager";

export function registerForceGenerateCommand(context: vscode.ExtensionContext) {
    const forceGenerate = vscode.commands.registerCommand("agentic-wiki.forceGenerate", async () => {
        // Get the progress manager instance
        const progressManager = ProgressManager.getInstance();

        // Reset progress manager for a new run
        progressManager.reset();

        // Use progress bar to display generation process
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Force Generating Wiki page (ignoring cache)...",
                cancellable: true,
            },
            async (progress, token) => {
                // Initialize the progress manager with progress and token
                progressManager.setProgressObjects(progress, token);

                // Check if operation was cancelled
                if (token.isCancellationRequested) {
                    return;
                }

                try {
                    // Start initialization stage
                    progressManager.startStage(ProcessStage.INITIALIZING);

                    // Get API key from secure storage
                    const apiKey = await secretsManager.getApiKey();
                    if (!apiKey) {
                        throw new Error("API key is not set. Please configure your API key in the extension settings.");
                    }

                    progressManager.updateStageProgress(50, "Loading configuration...");

                    // Create flow and prepare shared state
                    const flow = createFlow();
                    let shared = context.globalState.get<SharedStore>(CONFIG_KEY) || ({} as SharedStore);

                    // Get the model from shared state or use default
                    const model = shared.llmModel || "";

                    // Force useCache to false to ignore cache
                    shared = {
                        ...shared,
                        useCache: false
                    };

                    progressManager.updateStageProgress(100, "Configuration loaded (cache disabled)");
                    progressManager.completeStage();

                    // Add API key, model, extension context, and progress manager to flow parameters
                    // Force useCache to false to ignore cache
                    flow.setParams({
                        ...shared,
                        llmApiKey: apiKey,
                        llmModel: model,
                        context,
                        progressManager,
                        useCache: false, // Force disable cache
                    });

                    // Run the flow
                    await flow.run(shared);

                    // Complete the process
                    progressManager.startStage(ProcessStage.COMPLETED);
                    progressManager.updateStageProgress(100, "Wiki page successfully generated (without cache)!");

                    // Wait a moment before opening the wiki
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Open the generated wiki
                    vscode.commands.executeCommand("agentic-wiki.open");
                } catch (error) {
                    // Get the current stage for better error reporting
                    const currentStage = progressManager.getCurrentStage();

                    vscode.window.showErrorMessage(
                        `Failed to force generate Wiki page during ${currentStage} stage: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            },
        );
    });

    context.subscriptions.push(forceGenerate);
}
