import React from 'react';
import { EdithLogo } from './EdithLogo.tsx';

interface EmptyStateProps {
  onSelectPrompt?: (prompt: string, enableSearch?: boolean) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = () => {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center max-w-lg mx-auto my-auto select-none animate-fade-in">
      {/* Sleek Minimal EDITH Optical Emblem */}
      <div className="mb-7 flex items-center justify-center">
        <EdithLogo size="lg" />
      </div>

      {/* Primary Clean Heading */}
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-2.5">
        Hello, I&apos;m ULTRON.
      </h1>

      {/* Subtitle */}
      <p className="text-sm sm:text-base text-[#8E8E93] max-w-md font-normal leading-relaxed">
        Your powerful personal AI assistant. What is your command?
      </p>
    </div>
  );
};
