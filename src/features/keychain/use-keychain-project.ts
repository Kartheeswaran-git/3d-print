"use client";

import { useCallback, useState } from "react";
import { useFilePicker, useToast } from "@/components/ui";
import { downloadBlob } from "@/lib/utils";
import { keychainSettingsFileName } from "./derive";
import { parseProjectFile, toProjectFile } from "./settings";
import { keychainStore, useKeychainHistory } from "./store";

const PROJECT_ACCEPT = "application/json,.json";
/** Project files are a few hundred bytes; anything this big isn't one. */
const MAX_PROJECT_BYTES = 1024 * 1024;

export interface KeychainProject {
  /** Download the current settings as a project file. */
  save: () => void;
  /** Open the file picker to load a project file. */
  open: () => void;
  /** Hidden file input; render it once. */
  input: React.ReactElement;
  /** Why the last project file couldn't be opened. */
  loadError: string | null;
  dismissError: () => void;
  /** Restore every setting to its default (one undo step). */
  resetAll: () => void;
}

/** Save / open / reset for keychain settings (validated through settings.ts, FIXES L7 L8); open and reset can be undone. */
export function useKeychainProject(): KeychainProject {
  const { toast } = useToast();
  const [loadError, setLoadError] = useState<string | null>(null);

  const save = useCallback(() => {
    const { settings } = keychainStore.getState();
    const json = JSON.stringify(toProjectFile(settings, new Date().toISOString()), null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), keychainSettingsFileName(settings.text));
    toast("Settings saved");
  }, [toast]);

  const load = async (file: File) => {
    try {
      if (file.size > MAX_PROJECT_BYTES) {
        throw new Error("This file is too large to be a keychain project. Choose a .json file saved from Luna Litho.");
      }
      const settings = parseProjectFile(await file.text());
      // One undo step, even right after another edit.
      useKeychainHistory.getState().batch(() => keychainStore.getState().replace(settings));
      setLoadError(null);
      toast("Project loaded");
    } catch (error) {
      setLoadError(error instanceof Error && error.message ? error.message : "This file couldn't be read. Try another one.");
    }
  };

  const picker = useFilePicker(
    PROJECT_ACCEPT,
    (file) => void load(file),
    (file) => setLoadError(`“${file.name}” isn’t a project file. Choose a .json file saved from Luna Litho.`),
  );

  const dismissError = useCallback(() => setLoadError(null), []);

  const resetAll = useCallback(() => {
    useKeychainHistory.getState().batch(() => keychainStore.getState().reset());
    setLoadError(null);
    toast("Settings reset", { tone: "info" });
  }, [toast]);

  return { save, open: picker.open, input: picker.input, loadError, dismissError, resetAll };
}
