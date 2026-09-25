import { downloadBlob } from "@/lib/utils";
import { parseProjectFile, toProjectFile, type LithophaneSettings } from "./settings";

/** Picker filter for saved projects (extension listed for files with an empty MIME type). */
export const PROJECT_ACCEPT = "application/json,.json";
export const PROJECT_FILE_NAME = "moon-lamp-settings.json";
const MAX_PROJECT_BYTES = 1024 * 1024;

/** Download the settings as a versioned project file (photos are never included). */
export function downloadProjectFile(settings: LithophaneSettings): void {
  const project = toProjectFile(settings, new Date().toISOString());
  downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }), PROJECT_FILE_NAME);
}

/** Read and validate a saved project (FIXES L7). Throws an Error with a user-facing message. */
export async function readProjectFile(file: File): Promise<LithophaneSettings> {
  if (file.size > MAX_PROJECT_BYTES) {
    throw new Error("This file is too large to be a settings file. Choose a project saved from Luna Litho.");
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("This file couldn't be read. Try choosing it again.");
  }
  return parseProjectFile(text);
}
