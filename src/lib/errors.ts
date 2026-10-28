/** Journalise une erreur de rendu (console + liste consultable en dev). */
export function reportError(where: string, err: unknown) {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  console.error(`[accord] ${where}`, err);
  if (import.meta.env.DEV) ((window as any).__accord?.errors as string[] | undefined)?.push(`${where}: ${text}`);
}
