import React, { useEffect, useState } from "react";
import { financeCommand } from "../dbClient";

export default function LegacySettlement({
  clinicId,
  shift,
  isEn,
}: {
  clinicId: string;
  shift: any;
  isEn: boolean;
}) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await financeCommand(clinicId, { action: "view", scope: "settlement", date: shift.date });
        const receipts = (r.receipts || [])
          .filter(
            (r: any) =>
              !r.shiftId && r.date === shift.date && Number(r.amount) > 0,
          )
          .map((r: any) => ({
            ...r,
            sourceType: "receipt",
            title: r.patientName,
          }));
        const expenses = (r.expenses || [])
          .filter(
            (e: any) =>
              !e.deletedAt &&
              e.type === "shift" &&
              !e.shiftId &&
              e.date === shift.date,
          )
          .map((e: any) => ({ ...e, sourceType: "expense" }));
        if (live) setItems([...receipts, ...expenses]);
      } catch (e: any) {
        if (live) setError(e.message);
      }
    };
    load();
    window.addEventListener("clinic-sync", load);
    return () => {
      live = false;
      window.removeEventListener("clinic-sync", load);
    };
  }, [clinicId, shift.id, shift.date]);
  const assign = async (item: any) => {
    if (!reason.trim()) return;
    const yes = window.confirm(
      isEn
        ? "You reviewed this legacy record and confirm that it belongs to this open shift? This does not move cash or change the original record."
        : "راجعت الحركة القديمة وتؤكد أنها تخص الوردية المفتوحة دي؟ الربط لا يحرك نقدًا ولا يغير السجل الأصلي.",
    );
    if (!yes) return;
    setBusy(true);
    try {
      await financeCommand(clinicId, {
        action: "assign_legacy",
        shiftId: shift.id,
        sourceType: item.sourceType,
        sourceId: item.id,
        reason,
      });
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!items.length && !error) return null;
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <h3 className="text-sm font-black text-amber-900">
        {isEn
          ? "Legacy records need manual settlement"
          : "حركات قديمة محتاجة تسوية يدوية"}
      </h3>
      <p className="text-xs text-amber-800">
        {isEn
          ? "These records have no shift ID. Closing is blocked until you review their ownership. Never assign a record unless you have checked its original evidence. No automatic changes are made."
          : "الحركات دي بلا رقم وردية. الإقفال متوقف لحد مراجعة تبعيتها. لا تربط أي حركة إلا بعد مراجعة دليلها الأصلي. مفيش أي تعديل تلقائي."}
      </p>
      <input
        aria-label={isEn ? "Settlement reason" : "سبب التسوية"}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={isEn ? "Required settlement reason" : "سبب التسوية مطلوب"}
        className="w-full rounded-xl border bg-white p-3 text-xs"
      />
      {error && <p className="text-xs text-rose-700">{error}</p>}
      {items.map((i) => (
        <div
          key={i.sourceType + i.id}
          className="flex flex-wrap gap-2 items-center bg-white p-3 rounded-xl"
        >
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold">
              {i.sourceType === "expense"
                ? isEn
                  ? "Expense"
                  : "مصروف"
                : isEn
                  ? "Receipt"
                  : "إيصال"}{" "}
              • {i.title} • {i.amount} {isEn ? "EGP" : "ج.م"}
            </p>
            <p className="text-[10px] text-slate-500 break-all">
              {i.id} • {i.date}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={() => assign(i)}
            className="rounded-xl p-2 bg-amber-100 text-amber-900 text-xs font-bold disabled:opacity-40"
          >
            {isEn ? "Assign to this shift" : "ربط بهذه الوردية"}
          </button>
        </div>
      ))}
    </div>
  );
}
