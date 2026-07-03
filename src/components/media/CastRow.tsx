import Image from "next/image";
import { profileUrl } from "@/lib/tmdb/images";
import type { CastMember } from "@/lib/tmdb/types";

export function CastRow({ cast }: { cast: CastMember[] }) {
  const top = cast.slice(0, 12);
  if (top.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Cast</h2>
      <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1">
        {top.map((person) => {
          const src = profileUrl(person.profile_path);
          return (
            <div key={person.id} className="w-20 shrink-0 text-center">
              <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full border border-border bg-surface">
                {src ? (
                  <Image
                    src={src}
                    alt={person.name}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-lg font-semibold text-muted">
                    {person.name.charAt(0)}
                  </div>
                )}
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs font-medium">
                {person.name}
              </p>
              <p className="line-clamp-1 text-[11px] text-muted">
                {person.character}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
