import React, { useState, useMemo } from 'react';
import { Plus, Search, MessageSquare, Trash2, Edit2, Check, X, Settings as SettingsIcon, Cpu } from 'lucide-react';
import { Conversation } from '../types/chat.ts';
import { EdithLogo } from './EdithLogo.tsx';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onRenameConversation: (id: string, newTitle: string) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSettings: () => void;
  systemStatus: {
    groqConfigured: boolean;
    geminiConfigured: boolean;
    activeEngine: string;
  };
  onClearAllConversations?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  conversations,
  activeId,
  onSelectConversation,
  onNewChat,
  onRenameConversation,
  onDeleteConversation,
  onOpenSettings,
  systemStatus,
  onClearAllConversations,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const handleClearAllChats = () => {
    if (confirmClearAll) {
      if (onClearAllConversations) onClearAllConversations();
      setConfirmClearAll(false);
    } else {
      setConfirmClearAll(true);
      setTimeout(() => setConfirmClearAll(false), 3500);
    }
  };

  // Filter conversations based on search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [conversations, searchQuery]);

  // Group conversations by date
  const grouped = useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    const groups: { [key: string]: Conversation[] } = {
      Today: [],
      Yesterday: [],
      'Previous 7 Days': [],
      Older: [],
    };

    filtered.forEach((conv) => {
      const diff = now - conv.updatedAt;
      if (diff < oneDay) {
        groups.Today.push(conv);
      } else if (diff < 2 * oneDay) {
        groups.Yesterday.push(conv);
      } else if (diff < 7 * oneDay) {
        groups['Previous 7 Days'].push(conv);
      } else {
        groups.Older.push(conv);
      }
    });

    return groups;
  }, [filtered]);

  const handleStartRename = (conv: Conversation, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const handleSaveRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (editTitle.trim()) {
      onRenameConversation(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteId === id) {
      onDeleteConversation(id);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
      setTimeout(() => {
        setConfirmDeleteId((cur) => (cur === id ? null : cur));
      }, 3500);
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity lg:hidden"
        />
      )}

      {/* Sidebar Drawer */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex w-72 flex-col border-r border-[#262626] bg-[#000000] transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Top Header & New Chat */}
        <div className="flex flex-col gap-3 p-3.5 border-b border-[#262626]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <EdithLogo size="sm" />
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-wide text-white">ULTRON</span>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="Close sidebar"
              className="flex h-7 w-7 items-center justify-center rounded text-[#A1A1AA] hover:bg-[#171717] hover:text-white lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => {
              onNewChat();
              if (window.innerWidth < 1024) onClose();
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#171717] hover:bg-[#262626] border border-[#262626] py-2 px-3 text-xs font-medium text-white transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>New Chat</span>
          </button>

          {/* Search box */}
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#71717A]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats..."
              aria-label="Search conversation history"
              className="w-full rounded-lg bg-[#111111] border border-[#262626] py-1.5 pl-8 pr-3 text-xs text-white placeholder-[#71717A] outline-none focus:border-[#52525B]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-[#71717A] hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-[#71717A]">
              No conversations yet. Start a new chat!
            </div>
          ) : (
            Object.entries(grouped).map(([groupTitle, list]) => {
              if (list.length === 0) return null;
              return (
                <div key={groupTitle} className="space-y-1">
                  <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[#71717A]">
                    {groupTitle}
                  </span>
                  <div className="space-y-0.5">
                    {list.map((conv) => {
                      const isActive = conv.id === activeId;
                      const isEditing = conv.id === editingId;

                      return (
                        <div
                          key={conv.id}
                          onClick={() => {
                            onSelectConversation(conv.id);
                            if (window.innerWidth < 1024) onClose();
                          }}
                          className={`group relative flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-[#171717] text-white font-medium border-l-2 border-blue-500 pl-2 shadow-sm shadow-blue-500/10'
                              : 'text-[#A1A1AA] hover:bg-[#111111] hover:text-white'
                          }`}
                        >
                          {isEditing ? (
                            <div className="flex flex-1 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(conv.id, e as any);
                                  if (e.key === 'Escape') handleCancelRename(e as any);
                                }}
                                autoFocus
                                className="w-full rounded bg-[#262626] px-1.5 py-0.5 text-xs text-white outline-none focus:border-blue-500"
                              />
                              <button
                                onClick={(e) => handleSaveRename(conv.id, e)}
                                className="text-green-400 hover:text-green-300"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={handleCancelRename}
                                className="text-[#A1A1AA] hover:text-white"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 overflow-hidden">
                                <MessageSquare className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'opacity-70'}`} />
                                <span className="truncate">{conv.title}</span>
                              </div>

                              {/* Hover Actions: Rename & Delete */}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => handleStartRename(conv, e)}
                                  title="Rename chat"
                                  aria-label="Rename conversation"
                                  className="p-1 hover:text-white rounded hover:bg-[#262626]"
                                >
                                  <Edit2 className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleDelete(conv.id, e)}
                                  title={confirmDeleteId === conv.id ? 'Click again to confirm delete' : 'Delete chat'}
                                  aria-label="Delete conversation"
                                  className={`p-1 rounded transition-colors ${
                                    confirmDeleteId === conv.id
                                      ? 'bg-red-950 border border-red-800 text-red-200 px-1.5 text-[10px]'
                                      : 'hover:text-red-400 hover:bg-[#262626]'
                                  }`}
                                >
                                  {confirmDeleteId === conv.id ? (
                                    <span>Confirm?</span>
                                  ) : (
                                    <Trash2 className="h-3 w-3" />
                                  )}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Panel */}
        <div className="border-t border-[#262626] p-3 space-y-2 bg-[#050505]">
          {/* Clear All Chats Option */}
          {conversations.length > 0 && (
            <button
              onClick={handleClearAllChats}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                confirmClearAll
                  ? 'bg-red-600 text-white border-red-500 font-bold'
                  : 'bg-[#111111] hover:bg-red-950/30 text-[#A1A1AA] hover:text-red-400 border-[#262626]'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{confirmClearAll ? 'Confirm Delete All Chats?' : 'Clear All Chats'}</span>
            </button>
          )}

          {/* Engine Status pill */}
          <div className="flex items-center justify-between rounded-lg bg-[#111111] border border-[#262626] px-3 py-1.5 text-[11px] text-[#A1A1AA]">
            <div className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-blue-400" />
              <span>Engine</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`h-2 w-2 rounded-full ${
                  systemStatus.groqConfigured
                    ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                    : systemStatus.geminiConfigured
                    ? 'bg-blue-400 shadow-sm shadow-blue-400/50'
                    : 'bg-amber-400'
                }`}
              />
              <span className="font-medium capitalize text-white">
                {systemStatus.groqConfigured
                  ? 'Groq Active'
                  : systemStatus.geminiConfigured
                  ? 'Gemini Active'
                  : 'Ready'}
              </span>
            </div>
          </div>

          {/* Settings Trigger */}
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2.5 rounded-lg hover:bg-[#171717] px-3 py-2 text-xs font-medium text-[#A1A1AA] hover:text-white transition-colors"
          >
            <SettingsIcon className="h-4 w-4" />
            <span>Settings & Preferences</span>
          </button>
        </div>
      </aside>
    </>
  );
};
