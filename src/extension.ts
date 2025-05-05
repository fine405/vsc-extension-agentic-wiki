import * as vscode from "vscode";
import { registerGenerateCommand } from "./commands/generateCommand";
import { registerForceGenerateCommand } from "./commands/forceGenerateCommand";
import { registerOpenCommand } from "./commands/openCommand";
import { registerConfigCommand } from "./commands/configCommand";
import { registerEventListeners } from "./listeners";
import { SecretsManager } from "./utils/secretsManager";
import { LoggerService } from "./services/logger";
import { ConfigService } from "./services/config";
import { initializeCachePath } from "./services/cache/cacheService";
import { initializeFileHashCachePath, cleanupFileHashCache } from "./services/cache/fileHashCache";

// Export the secrets manager instance for use in other parts of the extension
export let secretsManager: SecretsManager;

export async function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    const logger = LoggerService.getInstance();
    logger.info('Congratulations, your extension "agentic-wiki" is now active!');

    // Initialize config service
    ConfigService.getInstance(context);

    // Initialize the secrets manager
    secretsManager = new SecretsManager(context);

    // Initialize cache services (non-blocking)
    initializeCacheServices(context).catch(error => {
        logger.error(`Failed to initialize cache services: ${error}`);
    });

    registerGenerateCommand(context);
    registerForceGenerateCommand(context);
    registerOpenCommand(context);
    registerConfigCommand(context);

    registerEventListeners(context);
}

/**
 * Initialize cache services asynchronously without blocking extension activation
 * @param context VS Code extension context
 */
async function initializeCacheServices(context: vscode.ExtensionContext): Promise<void> {
    const logger = LoggerService.getInstance();

    try {
        // Initialize LLM cache
        await initializeCachePath(context);
        logger.info("LLM cache initialized");

        // Initialize file hash cache
        await initializeFileHashCachePath(context);
        logger.info("File hash cache initialized");

        // Clean up old entries from file hash cache (30 days)
        await cleanupFileHashCache();
    } catch (error) {
        logger.error(`Error initializing cache services: ${error}`);
    }
}

export function deactivate() {}
