import React from 'react';

interface EdithLogoProps {
  size?: 'sm' | 'md' | 'lg';
  animated?: boolean;
}

export const EdithLogo: React.FC<EdithLogoProps> = ({ size = 'sm', animated = true }) => {
  const dimensions =
    size === 'lg' ? 'h-20 w-20' : size === 'md' ? 'h-8 w-8' : 'h-6 w-6';

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 select-none ${dimensions}`}
      aria-hidden="true"
    >
      {/* Subtle ambient outer prism halo for lg */}
      {size === 'lg' && (
        <div
          className={`absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-500/20 via-indigo-500/15 to-rose-400/20 blur-xl ${
            animated ? 'animate-pulse' : ''
          }`}
        />
      )}

      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative h-full w-full drop-shadow-[0_0_10px_rgba(96,165,250,0.28)]"
      >
        <defs>
          <linearGradient id="edithPrismGrad" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="55%" stopColor="#818CF8" />
            <stop offset="100%" stopColor="#F472B6" />
          </linearGradient>
          <radialGradient id="edithCoreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="45%" stopColor="#93C5FD" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer Dark Tactile Badge Frame */}
        <rect
          x="3"
          y="3"
          width="58"
          height="58"
          rx="18"
          fill="#070B14"
          stroke="url(#edithPrismGrad)"
          strokeOpacity="0.55"
          strokeWidth="2.2"
        />

        {/* EDITH Hexagonal Optical Visor Ring */}
        <polygon
          points="32,12 49,22 49,42 32,52 15,42 15,22"
          fill="#0B1222"
          fillOpacity="0.85"
          stroke="url(#edithPrismGrad)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Inner Visor Crosshair / Wing Accents */}
        <path
          d="M21 27.5L32 21L43 27.5M21 36.5L32 43L43 36.5"
          stroke="#93C5FD"
          strokeOpacity="0.65"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Central Luminous Iris Core */}
        <circle cx="32" cy="32" r="9.5" fill="url(#edithCoreGlow)" opacity="0.55" />
        <circle
          cx="32"
          cy="32"
          r="4.2"
          fill="#FFFFFF"
          className={animated ? 'animate-pulse' : ''}
        />
      </svg>
    </div>
  );
};
