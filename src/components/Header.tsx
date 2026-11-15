import React, { useState } from 'react';
import { Menu, Plus, Globe, Settings as SettingsIcon, Trash2, AudioLines } from 'lucide-react';
import { EdithLogo } from './EdithLogo.tsx';

interface HeaderProps {
  currentModel: string;
  isWebSearchActive: boolean;
  onToggleWebSearch: () => void;
  onNewChat: () => void;
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
  onDeleteCurrentChat?: () => void;
  canDeleteCurrent?: boolean;
  onOpenSphere?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isWebSearchActive,
  onToggleWebSearch,
  onNewChat,
  onOpenSidebar,
  onOpenSettings,
  onDeleteCurrentChat,
  canDeleteCurrent,
  onOpenSphere,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDeleteClick = () => {
    if (confirmDelete) {
      if (onDeleteCurrentChat) onDeleteCurrentChat();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 w-full items-center justify-between border-b border-[#1c1c1f] bg-[#000000]/90 px-3.5 sm:px-6 backdrop-blur-xl">
      {/* Left section: Menu & Clean Brand */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open conversation sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8E8E93] hover:bg-[#161618] hover:text-white transition-colors"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        <div className="flex items-center gap-2">
          <EdithLogo size="sm" />
          <span className="text-sm font-semibold tracking-wider text-white select-none">
            ULTRON
          </span>
        </div>
      </div>

      {/* Right controls (Clean — Voice Print Wake & Automation live inside Settings) */}
      <div className="flex items-center gap-1 sm:gap-1.5">
        {canDeleteCurrent && onDeleteCurrentChat && (
          <button
            type="button"
            onClick={handleDeleteClick}
            title={confirmDelete ? 'Click again to confirm delete' : 'Delete this chat'}
            aria-label="Delete this conversation"
            className={`flex h-8 items-center gap-1 rounded-lg px-2 text-xs transition-colors ${
              confirmDelete
                ? 'bg-red-600 text-white font-medium px-2.5'
                : 'text-[#8E8E93] hover:bg-red-950/30 hover:text-red-400'
            }`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {confirmDelete && <span className="text-[10px]">Delete?</span>}
          </button>
        )}

        {/* Web Search quick toggle */}
        <button
          type="button"
          onClick={onToggleWebSearch}
          title={isWebSearchActive ? 'Live Web Search: Active' : 'Enable Live Web Search'}
          aria-label="Toggle Web Search"
          className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors ${
            isWebSearchActive
              ? 'bg-blue-950/50 text-blue-400 border border-blue-700/60 shadow-sm shadow-blue-950/40'
              : 'text-[#8E8E93] hover:bg-[#161618] hover:text-white'
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="hidden sm:inline text-[11px]">Search</span>
        </button>

        {/* ULTRON Voice Mode Button */}
        {onOpenSphere && (
          <button
            type="button"
            onClick={onOpenSphere}
            title="Open ULTRON Voice Mode"
            aria-label="Open ULTRON Voice Mode"
            className="flex h-8 items-center gap-1.5 rounded-lg bg-[#121620] hover:bg-[#1a2233] border border-blue-500/35 px-2.5 text-xs font-medium text-blue-300 transition-all active:scale-95"
          >
            <AudioLines className="h-3.5 w-3.5 text-blue-400" />
            <span className="hidden sm:inline">Voice Mode</span>
          </button>
        )}

        {/* New chat button */}
        <button
          type="button"
          onClick={onNewChat}
          title="New Conversation"
          aria-label="New Conversation"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8E8E93] hover:bg-[#161618] hover:text-white transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>

        {/* Settings button */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings & Preferences"
          aria-label="Open Settings"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8E8E93] hover:bg-[#161618] hover:text-white transition-colors"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
