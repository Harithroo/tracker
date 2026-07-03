import Image from "next/image";
import { backdropUrl, posterUrl, providerLogoUrl } from "@/lib/tmdb/images";
import type { Genre, Video, WatchProvider } from "@/lib/tmdb/types";

export function pickTrailer(videos: Video[]): Video | null {
  const youtube = videos.filter((v) => v.site === "YouTube");
  return (
    youtube.find((v) => v.type === "Trailer" && v.official) ??
    youtube.find((v) => v.type === "Trailer") ??
    youtube.find((v) => v.type === "Teaser") ??
    null
  );
}

export function DetailsHero({
  title,
  tagline,
  overview,
  posterPath,
  backdropPath,
  meta,
  genres,
  trailer,
  providers,
  children,
}: {
  title: string;
  tagline?: string | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  meta: (string | null)[];
  genres: Genre[];
  trailer: Video | null;
  providers: WatchProvider[];
  children?: React.ReactNode; // LibraryControls slot
}) {
  const backdrop = backdropUrl(backdropPath);
  const poster = posterUrl(posterPath, "w500");

  return (
    <section className="relative -mx-4 -mt-6 mb-8 overflow-hidden md:rounded-b-2xl">
      {backdrop && (
        <div className="absolute inset-0">
          <Image
            src={backdrop}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
        </div>
      )}

      <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-8 pt-10 sm:flex-row md:pt-16">
        {poster && (
          <div className="relative hidden aspect-[2/3] w-44 shrink-0 overflow-hidden rounded-xl border border-border shadow-2xl sm:block md:w-56">
            <Image src={poster} alt={title} fill sizes="224px" className="object-cover" />
          </div>
        )}

        <div className="min-w-0 flex-1 self-end">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
          {tagline && <p className="mt-1 italic text-muted">{tagline}</p>}

          <p className="mt-2 text-sm text-muted">
            {meta.filter(Boolean).join(" · ")}
          </p>

          {genres.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {genres.map((g) => (
                <span
                  key={g.id}
                  className="rounded-full border border-border bg-surface/80 px-2.5 py-0.5 text-xs text-muted"
                >
                  {g.name}
                </span>
              ))}
            </div>
          )}

          {overview && (
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-foreground/90">
              {overview}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {trailer && (
              <a
                href={`https://www.youtube.com/watch?v=${trailer.key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
              >
                ▶ Trailer
              </a>
            )}
            {providers.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">Streaming on</span>
                {providers.slice(0, 5).map((p) => (
                  <Image
                    key={p.provider_id}
                    src={providerLogoUrl(p.logo_path)}
                    alt={p.provider_name}
                    title={p.provider_name}
                    width={28}
                    height={28}
                    className="rounded-md"
                  />
                ))}
              </div>
            )}
          </div>

          {children && <div className="mt-5">{children}</div>}
        </div>
      </div>
    </section>
  );
}
