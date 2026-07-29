/** Crossed-blades logo, drawn with currentColor so it inherits text color. */
export default function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 4.5 16 16" />
      <path d="M19.5 4.5 8 16" />
      <path d="M14.2 17.8l3.6-3.6" />
      <path d="M9.8 17.8l-3.6-3.6" />
      <path d="M17 17l2.5 2.5" />
      <path d="M7 17l-2.5 2.5" />
    </svg>
  );
}
