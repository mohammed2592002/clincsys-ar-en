import React, { useState } from "react";
import { ToothCondition, ToothDetail, ToothSurface } from "../types";
import { Activity, Plus, FileText, CheckCircle2, Volume2, Loader2, DollarSign, Stethoscope } from "lucide-react";

interface OdontogramChartProps {
  teethNotes: Record<number, ToothDetail>;
  onUpdateTooth: (toothNumber: number, detail: ToothDetail) => void;
  onGenerateAudioSummary?: (text: string) => void;
  patientName?: string;
}

// FDI Teeth Layout Mapping
const UPPER_RIGHT_PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11];
const UPPER_LEFT_PERMANENT  = [21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_RIGHT_PERMANENT = [48, 47, 46, 45, 44, 43, 42, 41];
const LOWER_LEFT_PERMANENT  = [31, 32, 33, 34, 35, 36, 37, 38];

const CONDITION_STYLES: Record<string, { label: string; labelEn: string; color: string; bg: string; border: string }> = {
  healthy: { label: "سليم", labelEn: "Healthy", color: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/40", border: "border-emerald-300 dark:border-emerald-700" },
  caries: { label: "تسوس / نخر", labelEn: "Caries", color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-950/50", border: "border-amber-400 dark:border-amber-600" },
  filling: { label: "حشو تجميلي", labelEn: "Composite Filling", color: "text-sky-700 dark:text-sky-400", bg: "bg-sky-100 dark:bg-sky-950/50", border: "border-sky-400 dark:border-sky-600" },
  root_canal: { label: "علاج عصب", labelEn: "Root Canal (RCT)", color: "text-rose-700 dark:text-rose-400", bg: "bg-rose-100 dark:bg-rose-950/50", border: "border-rose-400 dark:border-rose-600" },
  crown: { label: "تاج / تركيبة", labelEn: "Crown / Bridge", color: "text-indigo-700 dark:text-indigo-400", bg: "bg-indigo-100 dark:bg-indigo-950/50", border: "border-indigo-400 dark:border-indigo-600" },
  extraction: { label: "مطلوب خلع / مخلوع", labelEn: "Extraction", color: "text-slate-700 dark:text-slate-400", bg: "bg-slate-200 dark:bg-slate-800", border: "border-slate-400 dark:border-slate-600" },
  implant: { label: "زراعة أسنان", labelEn: "Implant", color: "text-purple-700 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-950/50", border: "border-purple-400 dark:border-purple-600" },
  bridge: { label: "جسر متصل", labelEn: "Bridge", color: "text-teal-700 dark:text-teal-400", bg: "bg-teal-100 dark:bg-teal-950/50", border: "border-teal-400 dark:border-teal-600" },
  fracture: { label: "كسر بالسن", labelEn: "Fracture", color: "text-orange-700 dark:text-orange-400", bg: "bg-orange-100 dark:bg-orange-950/50", border: "border-orange-400 dark:border-orange-600" },
  bleeding_gum: { label: "التهاب لثة", labelEn: "Gingivitis", color: "text-red-700 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950/40", border: "border-red-300 dark:border-red-600" },
};

export const OdontogramChart: React.FC<OdontogramChartProps> = ({
  teethNotes,
  onUpdateTooth,
  onGenerateAudioSummary,
  patientName = "المريض",
}) => {
  const [selectedTooth, setSelectedTooth] = useState<number>(46);
  const [condition, setCondition] = useState<ToothCondition>("caries");
  const [selectedSurfaces, setSelectedSurfaces] = useState<ToothSurface[]>(["O"]);
  const [notes, setNotes] = useState<string>("");
  const [cost, setCost] = useState<number>(800);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);

  const activeToothDetail = teethNotes[selectedTooth] || {
    toothNumber: selectedTooth,
    condition: "healthy",
    surfaces: [],
    notes: "",
    cost: 0,
  };

  const handleToothClick = (toothNum: number) => {
    setSelectedTooth(toothNum);
    const existing = teethNotes[toothNum];
    if (existing) {
      setCondition(existing.condition);
      setSelectedSurfaces(existing.surfaces || ["O"]);
      setNotes(existing.notes || "");
      setCost(existing.cost || 0);
    } else {
      setCondition("healthy");
      setSelectedSurfaces(["O"]);
      setNotes("");
      setCost(0);
    }
  };

  const toggleSurface = (surf: ToothSurface) => {
    if (selectedSurfaces.includes(surf)) {
      setSelectedSurfaces(selectedSurfaces.filter((s) => s !== surf));
    } else {
      setSelectedSurfaces([...selectedSurfaces, surf]);
    }
  };

  const handleSaveTooth = () => {
    onUpdateTooth(selectedTooth, {
      toothNumber: selectedTooth,
      condition,
      surfaces: selectedSurfaces,
      notes,
      cost,
      dateAdded: new Date().toISOString().split("T")[0],
    });
  };

  const handleSpeakSummary = () => {
    const affectedTeeth = (Object.entries(teethNotes) as [string, ToothDetail][]).filter(
      ([_, detail]) => detail.condition !== "healthy"
    );

    let summaryText = `مخطط الأسنان الخاص بالمريض ${patientName}: `;
    if (affectedTeeth.length === 0) {
      summaryText += "جميع الأسنان مفحوصة وسليمة بفضل الله.";
    } else {
      summaryText += `يوجد ${affectedTeeth.length} أسنان تتطلب المتابعة والعلاج. `;
      affectedTeeth.forEach(([num, detail]) => {
        const condStyle = CONDITION_STYLES[detail.condition];
        summaryText += `السن رقم ${num}: حالة ${condStyle?.label}. `;
        if (detail.notes) summaryText += `ملاحظة: ${detail.notes}. `;
      });
    }

    if (onGenerateAudioSummary) {
      setIsGeneratingAudio(true);
      onGenerateAudioSummary(summaryText);
      setTimeout(() => setIsGeneratingAudio(false), 2000);
    }
  };

  const renderToothButton = (num: number) => {
    const detail = teethNotes[num];
    const cond = detail?.condition || "healthy";
    const style = CONDITION_STYLES[cond];
    const isSelected = selectedTooth === num;

    return (
      <button
        key={num}
        onClick={() => handleToothClick(num)}
        className={`relative flex flex-col items-center justify-center p-2 rounded-xl transition-all border ${
          isSelected
            ? "ring-2 ring-emerald-500 ring-offset-2 scale-105 shadow-md border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60"
            : `${style.bg} ${style.border} hover:scale-102`
        }`}
      >
        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
          #{num}
        </span>
        <div className="w-8 h-9 relative flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 shadow-xs">
          <div className="text-[10px] font-black text-slate-800 dark:text-slate-200">
            {cond === "healthy" ? "🦷" : cond === "caries" ? "⚠️" : cond === "root_canal" ? "⚡" : cond === "crown" ? "👑" : cond === "implant" ? "🔩" : "🩹"}
          </div>
        </div>
        <span className={`text-[10px] font-medium mt-1 truncate max-w-[50px] ${style.color}`}>
          {style.label}
        </span>
      </button>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Stethoscope className="w-5 h-5 text-emerald-600" />
            مخطط الأسنان التفاعلي (FDI Odontogram Chart)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            انقر على أي سن لتحديد السطح والحالة وإدراج التكلفة مباشرة لخطة العلاج.
          </p>
        </div>

        <button
          onClick={handleSpeakSummary}
          disabled={isGeneratingAudio}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white rounded-xl text-xs font-semibold shadow-sm transition-all"
        >
          {isGeneratingAudio ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
          <span>قراءة المخطط بالصوت (Gemini TTS)</span>
        </button>
      </div>

      <div className="space-y-6 bg-slate-50 dark:bg-slate-950/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800">
        <div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 text-center uppercase tracking-wider">
            الفك العلوي (Upper Arch)
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {UPPER_RIGHT_PERMANENT.map(renderToothButton)}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {UPPER_LEFT_PERMANENT.map(renderToothButton)}
            </div>
          </div>
        </div>

        <div className="relative flex items-center justify-center my-2">
          <div className="border-t border-dashed border-slate-300 dark:border-slate-700 w-full" />
          <span className="absolute bg-slate-200 dark:bg-slate-800 px-3 py-1 rounded-full text-[11px] font-bold text-slate-600 dark:text-slate-300">
            خط الإطباق الوسطي (Midline)
          </span>
        </div>

        <div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {LOWER_RIGHT_PERMANENT.map(renderToothButton)}
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {LOWER_LEFT_PERMANENT.map(renderToothButton)}
            </div>
          </div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-2 text-center uppercase tracking-wider">
            الفك السفلي (Lower Arch)
          </div>
        </div>
      </div>

      <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shadow-xs">
              #{selectedTooth}
            </span>
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                تعديل تشخيص السن #{selectedTooth}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                الحالة الحالية: {CONDITION_STYLES[activeToothDetail.condition]?.label}
              </p>
            </div>
          </div>

          <button
            onClick={handleSaveTooth}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>حفظ للسن</span>
          </button>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-2">
            اختر تشخيص السن الإكلينيكي:
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(CONDITION_STYLES) as ToothCondition[]).map((condKey) => {
              const info = CONDITION_STYLES[condKey];
              const isSelected = condition === condKey;
              return (
                <button
                  key={condKey}
                  type="button"
                  onClick={() => setCondition(condKey)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    isSelected
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 shadow-xs scale-102"
                      : `${info.bg} ${info.color} ${info.border} hover:opacity-90`
                  }`}
                >
                  {info.label} ({info.labelEn})
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-2">
              الأسطح المصابة (Surfaces):
            </label>
            <div className="flex gap-2">
              {(["O", "M", "D", "B", "L"] as ToothSurface[]).map((surf) => {
                const names: Record<string, string> = {
                  O: "Occlusal (إطباقي)",
                  M: "Mesial (أنسي)",
                  D: "Distal (وحشي)",
                  B: "Buccal (دهليزي)",
                  L: "Lingual (لساني)",
                };
                const active = selectedSurfaces.includes(surf);
                return (
                  <button
                    key={surf}
                    type="button"
                    onClick={() => toggleSurface(surf)}
                    title={names[surf]}
                    className={`w-9 h-9 rounded-lg font-bold text-xs border transition-all ${
                      active
                        ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700"
                    }`}
                  >
                    {surf}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-2 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              تكلفة الإجراء (جنية مصري EGP):
            </label>
            <input
              type="number"
              value={cost}
              onChange={(e) => setCost(Number(e.target.value))}
              placeholder="مثلاً 1200"
              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
            ملاحظات الطبيب التشخيصية للسن #{selectedTooth}:
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: سحب عصب للجذر الإنسي والوحشي، تجهيز لتاج زيركون"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
          />
        </div>
      </div>
    </div>
  );
};
