// Pure URL builders — safe to import from Client Components.

const IMAGE_BASE = "https://image.tmdb.org/t/p";

type PosterSize = "w185" | "w342" | "w500" | "w780";
type BackdropSize = "w780" | "w1280" | "original";
type ProfileSize = "w185";
type StillSize = "w300";

function imageUrl(path: string | null, size: string): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

export const posterUrl = (path: string | null, size: PosterSize = "w342") =>
  imageUrl(path, size);
export const backdropUrl = (path: string | null, size: BackdropSize = "w1280") =>
  imageUrl(path, size);
export const profileUrl = (path: string | null, size: ProfileSize = "w185") =>
  imageUrl(path, size);
export const stillUrl = (path: string | null, size: StillSize = "w300") =>
  imageUrl(path, size);
export const providerLogoUrl = (path: string) => `${IMAGE_BASE}/w92${path}`;
