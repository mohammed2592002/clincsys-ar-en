import React, { useState, useEffect } from 'react';
import { useClinic } from '../context/ClinicContext';
import { Sparkles, Send, X, Bot, User, RefreshCw, AlertCircle } from 'lucide-react';

export const AiAssistantModal: React.FC = () => {
  const {
    isAiModalOpen,
    setIsAiModalOpen,
    aiPromptContext,
    language
  } = useClinic();

  const isAr = language === 'ar';

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (aiPromptContext?.prompt) {
      setPrompt(aiPromptContext.prompt);
    }
  }, [aiPromptContext]);

  if (!isAiModalOpen) return null;

  const handleAskAi = async (overridePrompt?: string) => {
    const finalPrompt = overridePrompt || prompt;
    if (!finalPrompt.trim()) return;

    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch('/api/ai/clinical-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          context: aiPromptContext || {}
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to communicate with AI Assistant');
      }

      setResponse(data.result);
    } catch (err: any) {
      setError(err?.message || 'Error executing AI analysis');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-900 via-slate-900 to-teal-900 text-white p-4 sm:p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-500/40 text-amber-300 flex items-center justify-center shadow-inner">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">
                {isAr ? 'المساعد الطبي الذكي Gemini AI' : 'Gemini AI Clinical Assistant'}
              </h3>
              <p className="text-[11px] text-teal-300">
                {isAr ? 'مساعدتك في التشخيص التفريقي، الجرعات والتفاعلات الدوائية' : 'Decision support, differential diagnosis & drug interaction review'}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsAiModalOpen(false)}
            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Suggestion Presets */}
        <div className="bg-slate-50 border-b border-slate-200 p-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-slate-500">{isAr ? 'مقترحات سريعة:' : 'Quick Presets:'}</span>
          {[
            {
              labelAr: 'فحص التفاعلات الدوائية',
              labelEn: 'Check Drug Interactions',
              promptAr: 'يرجى التأكد من التفاعلات الدوائية بين أدوية الضغط والأدوية المضادة للالتهاب مثل Cataflam',
              promptEn: 'Check potential drug interaction between amlodipine and NSAIDs'
            },
            {
              labelAr: 'التشخيص التفريقي للأعراض',
              labelEn: 'Differential Diagnosis',
              promptAr: 'ما هي الاحتمالات الطبية والفحوصات المطلوبة لمريض يشتكي من ألم بالصدر ضاغط مع تعرق؟',
              promptEn: 'What is the differential diagnosis for acute exertional chest pressure?'
            },
            {
              labelAr: 'ملخص تعليمات المريض',
              labelEn: 'Patient Advisory',
              promptAr: 'اكتب نصائح وتوجيهات غذائية مبسطة باللغة العربية لمريض ضغط الدم المرتفع والسكري.',
              promptEn: 'Write dietary instructions for hypertension and diabetes.'
            }
          ].map((preset, idx) => (
            <button
              key={idx}
              onClick={() => {
                const p = isAr ? preset.promptAr : preset.promptEn;
                setPrompt(p);
                handleAskAi(p);
              }}
              className="px-2.5 py-1 bg-white border border-slate-200 hover:border-teal-500 hover:text-teal-700 rounded-lg text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              + {isAr ? preset.labelAr : preset.labelEn}
            </button>
          ))}
        </div>

        {/* Body / Chat Area */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {/* User Prompt Bubble */}
          {prompt && (
            <div className="flex items-start gap-3 justify-end">
              <div className="bg-teal-600 text-white p-3.5 rounded-2xl max-w-lg shadow-xs font-medium leading-relaxed">
                {prompt}
              </div>
              <div className="w-8 h-8 rounded-full bg-teal-800 text-white flex items-center justify-center shrink-0 font-bold">
                <User className="w-4 h-4" />
              </div>
            </div>
          )}

          {/* Loading Indicator */}
          {loading && (
            <div className="flex items-center gap-3 bg-teal-50 border border-teal-200 text-teal-900 p-4 rounded-2xl animate-pulse">
              <RefreshCw className="w-5 h-5 text-teal-600 animate-spin" />
              <div className="font-bold">
                {isAr ? 'جاري تحليل التساؤل الطبي بواسطة جيميناي AI...' : 'Gemini AI is evaluating clinical parameters...'}
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-xl font-bold">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          {/* AI Response Box */}
          {response && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-amber-300 flex items-center justify-center shrink-0 font-bold">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-slate-50 border border-slate-200 text-slate-800 p-4 rounded-2xl max-w-xl shadow-xs leading-relaxed space-y-2 whitespace-pre-wrap font-medium">
                {response}
              </div>
            </div>
          )}
        </div>

        {/* Footer Input Bar */}
        <div className="p-3 border-t border-slate-200 bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAskAi();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={isAr ? 'اكتب سؤالك الطبي المباشر هنا...' : 'Type your clinical query here...'}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="submit"
              disabled={loading || !prompt.trim()}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <Send className="w-4 h-4" />
              <span>{isAr ? 'إرسال' : 'Ask'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
