import { useMutation } from "@tanstack/react-query";

import { useAppServices } from "@/app/app-services";
import type { CreateBackupRequest } from "@/business/backup";

/** "Backup erstellen" (#32); changes no data, so nothing to invalidate. */
export function useCreateBackup() {
  const { backup } = useAppServices();
  return useMutation({
    mutationFn: (request: CreateBackupRequest) => backup.createBackup(request),
  });
}
