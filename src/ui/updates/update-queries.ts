import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAppServices } from "@/app/app-services";
import type { DownloadProgress, UpdateCheck } from "@/business/updates";

/**
 * TanStack Query keys of the auto-update (#71). `check` holds the latest
 * check result – from the background check at startup or from "Nach Updates
 * suchen" – and drives the notice in the top bar.
 */
export const updateQueryKeys = {
  all: ["updates"] as const,
  check: () => [...updateQueryKeys.all, "check"] as const,
  install: () => [...updateQueryKeys.all, "install"] as const,
};

/**
 * The check at startup: once per app run, in the background; errors are only
 * logged (the result is then `null`, no notice).
 */
export function useBackgroundUpdateCheck() {
  const { updates } = useAppServices();
  return useQuery<UpdateCheck | null>({
    queryKey: updateQueryKeys.check(),
    queryFn: () => updates.checkInBackground(),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/** "Check for updates": a fresh check; the result also updates the notice. */
export function useCheckForUpdate() {
  const { updates } = useAppServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => updates.check(),
    onSuccess: (check) => queryClient.setQueryData(updateQueryKeys.check(), check),
  });
}

/**
 * "Jetzt aktualisieren" with the download progress. On success the app
 * restarts, so the mutation stays pending until then. `blocked` is true while
 * another install (notice or settings) runs.
 */
export function useInstallUpdate() {
  const { updates } = useAppServices();
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const running = useIsMutating({ mutationKey: updateQueryKeys.install() }) > 0;
  const mutation = useMutation({
    mutationKey: updateQueryKeys.install(),
    mutationFn: () => {
      setProgress(null);
      return updates.install(setProgress);
    },
    onError: (error) => console.error("Update failed", error),
  });
  return { mutation, progress, blocked: running && !mutation.isPending };
}

/** Opens the release notes of a check in the default browser. */
export function useOpenReleaseNotes() {
  const { updates } = useAppServices();
  return useMutation({
    mutationFn: (check: UpdateCheck) => updates.openReleaseNotes(check),
    onError: (error) => console.error("Could not open the release notes", error),
  });
}
