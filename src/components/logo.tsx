export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none">
      <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M20 2 C 12 10, 12 30, 20 38"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M20 2 C 28 10, 28 30, 20 38"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path d="M2.5 20 H37.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M6 10.5 C 12 15, 28 15, 34 10.5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M6 29.5 C 12 25, 28 25, 34 29.5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path d="M16.5 14 L27 20 L16.5 26 Z" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  className = "",
  markClassName = "h-8 w-8 text-navy",
  size = "text-xl",
  monochrome = false,
}: {
  className?: string;
  markClassName?: string;
  size?: string;
  /** Use a single solid color for the wordmark instead of the two-tone
   * split — needed on backgrounds (like the brand teal header) where the
   * accent color would otherwise blend in. */
  monochrome?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark className={markClassName} />
      <span className={`font-extrabold tracking-tight text-navy ${size}`}>
        {monochrome ? (
          "hooplens"
        ) : (
          <>
            hoop<span className="text-brand-dark">lens</span>
          </>
        )}
      </span>
    </span>
  );
}
