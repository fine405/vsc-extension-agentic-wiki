import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ensureDirectoryExists } from '../../utils';
import { LoggerService } from '../logger';

// File hash cache constants
const FILE_HASH_CACHE_FILENAME = "agentic-wiki.file_hash_cache.json";
let fileHashCachePath: string = "";

export interface FileHashCache {
    [workspaceId: string]: {
        [filePath: string]: {
            hash: string;
            timestamp: number;
        }
    };
}

/**
 * Initialize the file hash cache path using the extension context
 * @param context VS Code extension context
 * @returns Promise that resolves when initialization is complete
 */
export async function initializeFileHashCachePath(context: vscode.ExtensionContext): Promise<void> {
    const logger = LoggerService.getInstance();
    
    // Use the extension's global storage path for cache
    const storagePath = context.globalStorageUri.fsPath;
    fileHashCachePath = path.join(storagePath, FILE_HASH_CACHE_FILENAME);

    try {
        // Ensure the storage directory exists
        await ensureDirectoryExists(storagePath);
        logger.info(`File hash cache path initialized: ${fileHashCachePath}`);
    } catch (error) {
        logger.error(`Failed to create file hash cache directory: ${error}`);
    }
}

/**
 * Read file hash cache from file with proper error handling
 * @returns FileHashCache object or empty object if file doesn't exist or is invalid
 */
export async function readFileHashCache(): Promise<FileHashCache> {
    const logger = LoggerService.getInstance();
    
    // Check if cache path is initialized
    if (!fileHashCachePath) {
        logger.warn("File hash cache path not initialized, using empty cache");
        return {};
    }

    try {
        // Check if cache file exists using async access
        try {
            await fs.access(fileHashCachePath);
        } catch {
            // File doesn't exist
            return {};
        }

        // Read file asynchronously
        const data = await fs.readFile(fileHashCachePath, "utf-8");
        
        // Check if file is empty
        if (!data.trim()) {
            return {};
        }
        
        return JSON.parse(data);
    } catch (error) {
        logger.warn(`Failed to read file hash cache file: ${error}`);
        return {};
    }
}

/**
 * Write file hash cache to file with proper error handling
 * @param cache FileHashCache object to write
 */
export async function writeFileHashCache(cache: FileHashCache): Promise<void> {
    const logger = LoggerService.getInstance();
    
    // Check if cache path is initialized
    if (!fileHashCachePath) {
        logger.warn("File hash cache path not initialized, cannot write cache");
        return;
    }

    try {
        // Ensure the directory exists
        const cacheDir = path.dirname(fileHashCachePath);
        await ensureDirectoryExists(cacheDir);

        // Write to a temporary file first (asynchronously)
        const tempFilePath = `${fileHashCachePath}.tmp`;
        await fs.writeFile(tempFilePath, JSON.stringify(cache, null, 2));

        // Rename the temporary file to the actual cache file (atomic operation, asynchronously)
        await fs.rename(tempFilePath, fileHashCachePath);
        
        logger.info("File hash cache updated successfully");
    } catch (error) {
        logger.error(`Failed to write file hash cache file: ${error}`);
    }
}

/**
 * Calculate hash for a file
 * @param filePath Path to the file
 * @param content File content (optional, if already loaded)
 * @returns Promise resolving to the file hash
 */
export async function calculateFileHash(filePath: string, content?: string): Promise<string> {
    try {
        const fileContent = content || await fs.readFile(filePath, 'utf-8');
        return crypto.createHash('md5').update(fileContent).digest('hex');
    } catch (error) {
        const logger = LoggerService.getInstance();
        logger.error(`Failed to calculate hash for file ${filePath}: ${error}`);
        throw error;
    }
}

/**
 * Check if a file has changed since last processing
 * @param workspaceId Workspace identifier
 * @param filePath Path to the file
 * @param content File content (optional, if already loaded)
 * @returns Promise resolving to true if file has changed, false otherwise
 */
export async function hasFileChanged(workspaceId: string, filePath: string, content?: string): Promise<boolean> {
    const cache = await readFileHashCache();
    const workspaceCache = cache[workspaceId] || {};
    const fileCache = workspaceCache[filePath];
    
    if (!fileCache) {
        return true; // File not in cache, consider it changed
    }
    
    try {
        const currentHash = await calculateFileHash(filePath, content);
        return currentHash !== fileCache.hash;
    } catch (error) {
        return true; // Error calculating hash, consider it changed
    }
}

/**
 * Update file hash in cache
 * @param workspaceId Workspace identifier
 * @param filePath Path to the file
 * @param content File content (optional, if already loaded)
 */
export async function updateFileHash(workspaceId: string, filePath: string, content?: string): Promise<void> {
    const cache = await readFileHashCache();
    
    if (!cache[workspaceId]) {
        cache[workspaceId] = {};
    }
    
    const hash = await calculateFileHash(filePath, content);
    
    cache[workspaceId][filePath] = {
        hash,
        timestamp: Date.now()
    };
    
    await writeFileHashCache(cache);
}

/**
 * Clean up old entries from file hash cache
 * @param maxAgeMs Maximum age of cache entries in milliseconds (default: 30 days)
 */
export async function cleanupFileHashCache(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<void> {
    const logger = LoggerService.getInstance();
    const cache = await readFileHashCache();
    const now = Date.now();
    let entriesRemoved = 0;
    
    for (const workspaceId in cache) {
        const workspaceCache = cache[workspaceId];
        
        for (const filePath in workspaceCache) {
            const fileCache = workspaceCache[filePath];
            
            if (now - fileCache.timestamp > maxAgeMs) {
                delete workspaceCache[filePath];
                entriesRemoved++;
            }
        }
        
        // Remove workspace if empty
        if (Object.keys(workspaceCache).length === 0) {
            delete cache[workspaceId];
        }
    }
    
    if (entriesRemoved > 0) {
        logger.info(`Cleaned up ${entriesRemoved} old entries from file hash cache`);
        await writeFileHashCache(cache);
    }
}
