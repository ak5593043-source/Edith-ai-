import React, { useState } from 'react';
import { FileText, Download, Check, Loader2, AlertCircle } from 'lucide-react';
import { PdfPayload, downloadRealPdf } from '../utils/pdfParser.ts';

interface PdfActionCardProps {
  pdf: PdfPayload;
}

export const PdfActionCard: React.FC<PdfActionCardProps> = ({ pdf }) => {
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDownload = async () => {
    if (status === 'generating') return;
    setStatus('generating');
    setErrorMsg(null);
    try {
      await downloadRealPdf(pdf);
      setStatus('done');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Could not generate PDF');
    }
  };

  return (
    <div
      data-testid="pdf-download-card"
      className="my-3 w-full max-w-md rounded-2xl bg-[#111319] border border-blue-500/35 p-4 shadow-lg text-left select-text"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="font-semibold text-sm text-white block truncate">
              {pdf.title}
            </span>
            <span className="text-[11px] text-[#98989D] font-mono block truncate">
              {pdf.filename}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          disabled={status === 'generating'}
          aria-label={`Download ${pdf.filename}`}
          className="flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-medium px-3.5 py-2 text-xs transition-colors shrink-0 shadow-md shadow-blue-950/50 active:scale-95"
        >
          {status === 'generating' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Creating...</span>
            </>
          ) : status === 'done' ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-300" />
              <span>Downloaded</span>
            </>
          ) : (
            <>
              <Download className="h-3.5 w-3.5" />
              <span>Download PDF</span>
            </>
          )}
        </button>
      </div>

      {status === 'error' && errorMsg && (
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};
