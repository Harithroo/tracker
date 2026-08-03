import { Carousel } from "./Carousel";

export function MediaRow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-neutral-500">
        {title}
      </h2>
      <Carousel>{children}</Carousel>
    </section>
  );
}

/** Fixed-width wrapper for PosterCards inside a MediaRow. */
export function RowItem({ children }: { children: React.ReactNode }) {
  return <div className="w-32 shrink-0 sm:w-36">{children}</div>;
}
