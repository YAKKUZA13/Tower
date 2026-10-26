/** Deployment-aware public assets; headless source tests retain the root base. */
export function publicAssetUrl(relativePath: string): string {
  const base = import.meta.env?.BASE_URL || '/';
  return `${base}${relativePath.replace(/^\/+/, '')}`;
}
