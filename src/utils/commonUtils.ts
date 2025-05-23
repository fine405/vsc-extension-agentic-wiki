import * as vscode from "vscode";
import * as path from "path";
import { OUTPUT_DIR } from "../constants";
import { FileInfo } from "../types";

/**
 * Get wiki page path
 * @returns Path to the wiki directory
 */
export function getWikiPath(): string {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        throw new Error("No workspace open, cannot determine Wiki path");
    }
    return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, OUTPUT_DIR);
}

/**
 * Ensure directory exists
 * @param dirPath Directory path to ensure exists
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
    } catch {
        // Directory doesn't exist, create it
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    }
}

/**
 * Get content for specific file indices
 * @param filesData Array of file information
 * @param indices Array of file indices to include
 * @returns Map of file paths/indices to content
 */
export function getContentForIndices(filesData: FileInfo[], indices: number[]): Record<string, string> {
    const contentMap: Record<string, string> = {};

    for (const i of indices) {
        if (i >= 0 && i < filesData.length) {
            const { path, content } = filesData[i];
            contentMap[`${i} # ${path}`] = content; // Use index + path as key for context
        }
    }

    return contentMap;
}
