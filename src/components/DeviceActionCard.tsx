import React, { useState } from 'react';
import {
  ExternalLink,
  Check,
  Copy,
  Instagram,
  Film,
  Send,
  ArrowRight,
  Youtube,
  MessageCircle,
  MapPin,
  Music,
  Smartphone,
  Phone,
  Mail,
  Globe,
  MessageSquare,
} from 'lucide-react';
import { DeviceAction } from '../types/chat.ts';
import { executeDeviceAction } from '../utils/actionDispatcher.ts';

interface DeviceActionCardProps {
  action: DeviceAction;
  autoExecuted?: boolean;
  stepNumber?: number;
  totalSteps?: number;
}

export const DeviceActionCard: React.FC<DeviceActionCardProps> = ({
  action,
  autoExecuted = false,
  stepNumber,
  totalSteps,
}) => {
  const [executed, setExecuted] = useState(autoExecuted);
  const [statusNote, setStatusNote] = useState<string | null>(
    autoExecuted ? `Auto-launch attempted for ${action.appName || action.title}` : null
  );
  const [copied, setCopied] = useState(false);

  const handleLaunch = async () => {
    setExecuted(true);
    const result = await executeDeviceAction(action, true);
    setStatusNote(result.message);
  };

  const handleCopyMessage = async () => {
    if (action.message) {
      try {
        await navigator.clipboard.writeText(action.message);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const renderIcon = () => {
    switch (action.type) {
      case 'instagram_reels':
        return <Film className="h-4 w-4" />;
      case 'instagram_message':
        return <Send className="h-4 w-4" />;
      case 'instagram_open':
        return <Instagram className="h-4 w-4" />;
      case 'youtube_search':
        return <Youtube className="h-4 w-4" />;
      case 'whatsapp_message':
        return <MessageCircle className="h-4 w-4" />;
      case 'maps_search':
        return <MapPin className="h-4 w-4" />;
      case 'spotify_play':
        return <Music className="h-4 w-4" />;
      case 'call_phone':
        return <Phone className="h-4 w-4" />;
      case 'sms_message':
        return <MessageSquare className="h-4 w-4" />;
      case 'email_compose':
        return <Mail className="h-4 w-4" />;
      case 'chrome_search':
        return <Globe className="h-4 w-4" />;
      default:
        return <Smartphone className="h-4 w-4" />;
    }
  };

  const isMessage =
    action.type === 'instagram_message' ||
    action.type === 'whatsapp_message' ||
    action.type === 'sms_message';

  return (
    <div className="my-2.5 w-full max-w-md rounded-2xl bg-[#0e1118] border border-blue-500/35 p-4 shadow-lg shadow-black/60 text-left select-text">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-300">
            {renderIcon()}
          </div>
          <div className="min-w-0">
            <span className="font-semibold text-xs sm:text-sm text-white tracking-wide block truncate">
              {action.title}
            </span>
            <span className="text-[10px] text-blue-400 font-medium block truncate">
              {action.appName || 'App Launcher'} • Direct Deep Link
            </span>
          </div>
        </div>

        {stepNumber !== undefined && totalSteps !== undefined && totalSteps > 1 && (
          <span className="text-[10px] font-mono text-blue-300 bg-blue-950/60 border border-blue-700/50 px-2 py-0.5 rounded-full shrink-0">
            Step {stepNumber}/{totalSteps}
          </span>
        )}
      </div>

      {/* Target & Message Body */}
      {(isMessage || action.target) && (action.target || action.message) && (
        <div className="py-2.5 space-y-1.5">
          {action.target && (
            <div className="flex items-center justify-between text-xs gap-2">
              <span className="text-[#A1A1AA]">Target:</span>
              <span className="font-semibold text-white bg-white/10 px-2 py-0.5 rounded-full text-[11px] truncate max-w-[230px]">
                {action.target}
              </span>
            </div>
          )}

          {action.message && (
            <div className="rounded-xl bg-black/50 border border-white/10 p-2.5 flex items-center justify-between gap-2">
              <span className="text-xs text-[#E4E4E7] italic truncate">
                &ldquo;{action.message}&rdquo;
              </span>
              <button
                type="button"
                onClick={handleCopyMessage}
                title="Copy message"
                className="flex items-center gap-1 text-[10px] text-blue-300 hover:text-white px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 transition-colors shrink-0"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Launch Buttons */}
      <div className="pt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={handleLaunch}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-3 text-xs transition-all active:scale-95"
        >
          <span>Open {action.appName || 'App'}</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>

        <a
          href={action.webUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open Web Version"
          className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {executed && statusNote && (
        <div className="mt-2 text-center text-[10px] text-emerald-400 font-medium">
          {statusNote}
        </div>
      )}
    </div>
  );
};
