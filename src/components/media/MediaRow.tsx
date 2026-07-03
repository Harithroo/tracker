export function MediaRow({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {children}
      </div>
    </section>
  );
}

/** Fixed-width wrapper for PosterCards inside a MediaRow. */
export function RowItem({ children }: { children: React.ReactNode }) {
  return <div className="w-32 shrink-0 sm:w-36">{children}</div>;
}
