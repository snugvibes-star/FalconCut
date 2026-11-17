/**
 * CutFlow brand mark: a gradient bird (violet → signal blue) whose wing is a
 * film strip and whose body holds a white play button. Vector, so it stays
 * crisp at any size and inherits nothing from the DOM. The standalone
 * /icon.svg favicon is the same drawing.
 *
 * NOTE: this is a hand-built approximation of the brand artwork. If the exact
 * asset (e.g. a designer-exported SVG) is available, swap the <path> data —
 * the component boundary stays the same.
 */
export function LogoMark({ size = 20, title = 'CutFlow' }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title}
      className="shrink-0"
    >
      <defs>
        <linearGradient id="cf-logo-g" x1="5" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#4C9AFF" />
        </linearGradient>
      </defs>
      {/* bird: head + swooping body */}
      <path
        fill="url(#cf-logo-g)"
        d="M10.4 4.4c4.1 0 7.4 3.3 7.4 7.4 0 6.7-4.7 13.6-12.3 16.1 3.1-4.3 4.1-7.4 4.2-9.7-3.3-.6-5.7-3.2-5.7-6.4 0-4.1 3.3-7.4 6.4-7.4Z"
      />
      {/* wing: film strip angled up-right */}
      <rect x="15.2" y="15.2" width="13.4" height="5.4" rx="2.7" fill="url(#cf-logo-g)" transform="rotate(-20 15.2 15.2)" />
      {/* sprocket holes punched out of the strip */}
      <g fill="#07090F" opacity="0.9">
        <circle cx="19.3" cy="15.6" r="1" />
        <circle cx="23" cy="14.5" r="1" />
        <circle cx="26.6" cy="13.4" r="1" />
      </g>
      {/* play button */}
      <path fill="#fff" d="M8.6 8.9l5.6 3.1-5.6 3.1z" />
    </svg>
  );
}
