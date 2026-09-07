import React, { useState } from "react";
import { Volume2, VolumeX, Play, Pause, Loader2, Sparkles, X, Radio } from "lucide-react";

interface TTSAudioBarProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateTTS: (text: string, voice?: string) => void;
  isPlaying: boolean;
  onStopAudio: () => void;
}

export const TTSAudioBar: React.FC<TTSAudioBarProps> = ({
  isOpen,
  onClose,
  onGenerateTTS,
  isPlaying,
  onStopAudio,
}) => {
  const [text, setText] = useState("أهلاً بكم في عيادة coredentsys لطب وجراحة الأسنان. المريض التالي يتفضل بالدخول لغرفة الطبيب.");
  const [selectedVoice, setSelectedVoice] = useState<string>("Kore");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handlePlay = async () => {
    if (!text.trim()) return;
    setLoading(true);
    await onGenerateTTS(text, selectedVoice);
    setLoading(false);
  };

  const PRESETS = [
    { label: "نداء الدخول للعيادة", text: "تنبيه: نداء للمريض التالي، يتفضل بالدخول الآن لغرفة الطبيب المعالج." },
    { label: "تعليمات بعد سحب العصب", text: "تنبيه طبي: يرجى تجنب تناول الأطعمة القاسية لمدة ساعتين بعد الجلسة، والالتزام بالمسكنات عند اللزوم." },
    { label: "ترحيب المريض الجديد", text: "أهلاً بك في عيادة coredentsys. يسعدنا تقديم أفضل رعاية طبية وتجميلية لأسنانك." },
  ];

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-50 bg-slate-900 text-white rounded-3xl border border-emerald-500/40 p-5 shadow-2xl space-y-4 animate-in slide-in-from-bottom-5">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h4 className="text-xs font-black text-white">
              المُنادي الصوتي الذكي (Gemini TTS)
            </h4>
            <p className="text-[10px] text-emerald-400">
              نموذج gemini-3.1-flash-tts-preview الصوتي
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p, idx) => (
          <button
            key={idx}
            onClick={() => setText(p.text)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-emerald-950 text-slate-200 hover:text-emerald-300 text-[10px] font-bold border border-slate-700/80 transition-all"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Voice Selection & Custom Text Area */}
      <div className="space-y-2">
        <div className="flex justify-between items-center text-[10px] font-bold text-slate-400">
          <span>نص الصوت المراد تحويله:</span>
          <div className="flex items-center gap-1">
            <span>الصوت:</span>
            <select
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="bg-slate-800 border border-slate-700 text-white rounded-md text-[10px] px-1.5 py-0.5 outline-none"
            >
              <option value="Kore">Kore (أنثى دافئة)</option>
              <option value="Puck">Puck (رجل واثق)</option>
              <option value="Zephyr">Zephyr (هادئ احترافي)</option>
              <option value="Fenrir">Fenrir (عميق)</option>
            </select>
          </div>
        </div>

        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 outline-none focus:border-emerald-500"
        />
      </div>

      {/* Play / Stop Audio Controls */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {isPlaying && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold animate-pulse">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            جاري تشغيل الصوت بالعيادة...
          </div>
        )}

        <div className="flex items-center gap-2 mr-auto">
          {isPlaying ? (
            <button
              onClick={onStopAudio}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <VolumeX className="w-4 h-4" />
              <span>إيقاف الصوت</span>
            </button>
          ) : (
            <button
              onClick={handlePlay}
              disabled={loading}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-slate-950" />}
              <span>توليد وقراءة الصوت الآن 🚀</span>
            </button>
          )}
        </div>
      </div>

    </div>
  );
};
