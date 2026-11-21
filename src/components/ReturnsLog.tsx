import React, { useEffect, useMemo, useState } from "react";
import { financeCommand } from "../dbClient";

export default function ReturnsLog({
  clinicId,
  isEn,
}: {
  clinicId: string;
  isEn: boolean;
}) {
  const [receipts, setReceipts] = useState<any[]>([]),
    [showRefund, setShowRefund] = useState(false),
    [receiptId, setReceiptId] = useState(""),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false);
  const [events, setEvents] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month"),
    [type, setType] = useState("all"),
    [query, setQuery] = useState("");
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await financeCommand(clinicId, { action: "read" });
        if (live) {
          setEvents(r.events || []);
          setReceipts(r.receipts || []);
          setError("");
        }
      } catch (e: any) {
        if (live) setError(e.message);
      } finally {
        if (live) setLoading(false);
      }
    };
    load();
    window.addEventListener("clinic-sync", load);
    return () => {
      live = false;
      window.removeEventListener("clinic-sync", load);
    };
  }, [clinicId]);
  const labels: Record<string, string> = {
    legacy_assigned: isEn ? "Manual legacy assignment" : "تسوية ربط يدوية",
    refund: isEn ? "Refunded payment" : "دفعة مستردة",
    appointment_cancelled: isEn ? "Cancelled appointment" : "موعد ملغي",
    lab_cancelled: isEn ? "Cancelled lab order" : "طلب معمل ملغي",
    expense_deleted: isEn ? "Deleted expense" : "مصروف محذوف",
    patient_deleted: isEn ? "Empty patient deleted" : "حذف مريض بلا سجل",
    discount: isEn ? "Discount" : "خصم موثق",
  };
  const range = useMemo(() => {
    const d = today();
    if (period === "custom") return { start: from, end: to };
    if (period === "today") return { start: d, end: d };
    if (period === "month") return { start: d.slice(0, 7) + "-01", end: d };
    const base = new Date(d + "T12:00:00Z");
    const offset = (base.getUTCDay() + 1) % 7;
    base.setUTCDate(base.getUTCDate() - offset);
    return { start: base.toISOString().slice(0, 10), end: d };
  }, [period, from, to]);
  const filtered = events
    .filter((e) => {
      const d = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(e.createdAt));
      return (
        d >= range.start &&
        d <= range.end &&
        (type === "all" || e.type === type) &&
        (!query ||
          [e.title, e.receiptNumber, e.actorName, e.reason]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()))
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sum = (kind: string) =>
    filtered
      .filter((e) => e.type === kind)
      .reduce((n, e) => n + Number(e.amount || 0), 0);
  const summaries = [
    {
      label: isEn
        ? "Actual Refunds (Period)"
        : "إجمالي المرتجعات الفعلية (الفترة)",
      value: sum("refund"),
      accent: true,
    },
    {
      label: isEn ? "Refunded Payments" : "دفعات مستردة",
      value: sum("refund"),
    },
    {
      label: isEn ? "Cancelled Lab Orders" : "طلبات معمل ملغاة",
      value: sum("lab_cancelled"),
    },
    {
      label: isEn ? "Deleted Expenses" : "مصروفات محذوفة",
      value: sum("expense_deleted"),
    },
  ];
  const available = receipts
    .filter((r) => r.kind !== "refund" && r.paymentMethod !== "نقاط الولاء")
    .map((r) => ({
      ...r,
      available:
        Number(r.amount) -
        receipts
          .filter((x) => x.kind === "refund" && x.originalReceiptId === r.id)
          .reduce((n, x) => n + Number(x.amount), 0),
    }))
    .filter((r) => r.available > 0);
  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    const original = available.find((r) => r.id === receiptId);
    if (!original) return;
    setSaving(true);
    setError("");
    try {
      await financeCommand(clinicId, {
        action: "refund",
        appointmentId: original.appointmentId,
        receiptId,
        amount: Number(amount),
        reason,
      });
      setShowRefund(false);
      setAmount("");
      setReason("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };
  const badge = (kind: string) =>
    kind === "refund"
      ? "bg-amber-100 text-amber-800"
      : kind === "lab_cancelled"
        ? "bg-violet-100 text-violet-700"
        : "bg-slate-100 text-slate-600";
  return (
    <section className="space-y-4" dir={isEn ? "ltr" : "rtl"}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowRefund(!showRefund)}
          className="rounded-xl px-4 py-2 bg-gradient-to-l from-emerald-500 to-green-600 text-white text-xs font-bold"
        >
          {isEn ? "Record actual refund" : "تسجيل رد مبلغ فعلي"}
        </button>
      </div>
      {showRefund && (
        <form
          onSubmit={submitRefund}
          className="p-5 bg-white border border-amber-200 rounded-2xl space-y-3"
        >
          <p className="text-xs text-amber-800">
            {isEn
              ? "Manager only. This records money actually returned and reduces the current open drawer. Cancellation alone is not a refund."
              : "للمدير فقط. يسجل مبلغ تم رده فعلًا ويخصمه من الوردية المفتوحة. إلغاء الموعد وحده ليس استردادًا."}
          </p>
          <select
            required
            aria-label={isEn ? "Original receipt" : "الإيصال الأصلي"}
            value={receiptId}
            onChange={(e) => {
              setReceiptId(e.target.value);
              setAmount("");
            }}
            className="w-full border rounded-xl p-3 text-sm"
          >
            <option value="">
              {isEn ? "Select original receipt" : "اختر الإيصال الأصلي"}
            </option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.patientName} • {r.receiptNumber || r.id} • {r.available}{" "}
                {isEn ? "EGP available" : "ج.م متاح"}
              </option>
            ))}
          </select>
          <input
            required
            aria-label={isEn ? "Refund amount" : "المبلغ المسترد"}
            type="number"
            step="0.01"
            min="0.01"
            max={available.find((r) => r.id === receiptId)?.available}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={isEn ? "Amount" : "المبلغ"}
            className="w-full p-3 border rounded-xl text-sm"
          />
          <input
            required
            aria-label={isEn ? "Refund reason" : "سبب الاسترداد"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isEn ? "Reason for actual refund" : "سبب رد المبلغ الفعلي"
            }
            className="w-full p-3 border rounded-xl text-sm"
          />
          <button
            disabled={saving || !receiptId}
            className="p-3 rounded-xl bg-rose-600 text-white text-xs font-bold disabled:opacity-50"
          >
            {saving
              ? isEn
                ? "Awaiting confirmation..."
                : "في انتظار تأكيد السيرفر..."
              : isEn
                ? "Confirm actual refund"
                : "تأكيد رد المبلغ فعليًا"}
          </button>
        </form>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {summaries.map((s, i) => (
          <div
            key={i}
            className={`rounded-2xl p-5 bg-white shadow-sm border ${s.accent ? "border-rose-200 bg-rose-50/40" : "border-slate-100"}`}
          >
            <p className="text-xs font-bold text-slate-500">{s.label}</p>
            <p
              className={`text-xl font-black mt-4 ${s.accent ? "text-rose-600" : "text-[#272E40]"}`}
            >
              {s.value.toLocaleString()} {isEn ? "EGP" : "ج.م"}
            </p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-white border border-slate-100 p-4 flex flex-wrap gap-3 items-center shadow-sm">
        <div className="flex flex-wrap gap-1">
          {[
            ["today", isEn ? "Today" : "اليوم"],
            ["week", isEn ? "Week" : "الأسبوع"],
            ["month", isEn ? "Month" : "الشهر"],
            ["custom", isEn ? "Custom range" : "فترة محددة"],
          ].map(([v, l]) => (
            <button
              type="button"
              key={v}
              onClick={() => setPeriod(v)}
              className={`px-3 py-2 rounded-full text-xs font-bold ${period === v ? "bg-[#272E40] text-white" : "bg-slate-100 text-slate-500"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {period === "custom" ? (
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={isEn ? "From" : "من"}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border rounded-lg p-2 text-xs"
            />
            <input
              aria-label={isEn ? "To" : "إلى"}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border rounded-lg p-2 text-xs"
            />
          </div>
        ) : (
          <span className="border border-dashed border-emerald-300 rounded-xl bg-emerald-50 text-emerald-700 p-2 text-xs font-bold">
            {range.start} {isEn ? "to" : "إلى"} {range.end}
          </span>
        )}
        <select
          aria-label={isEn ? "Operation type" : "نوع العملية"}
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="border border-slate-200 bg-slate-50 rounded-xl p-2 text-xs"
        >
          <option value="all">{isEn ? "All types" : "كل الأنواع"}</option>
          {Object.entries(labels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          aria-label={isEn ? "Search returns" : "بحث المرتجعات"}
          placeholder={
            isEn
              ? "Patient name or receipt number..."
              : "ابحث باسم مريض أو رقم إيصال..."
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border border-slate-200 bg-slate-50 rounded-xl p-2 text-xs min-w-0 w-full sm:w-auto basis-full sm:basis-auto flex-1"
        />
      </div>
      {error && (
        <p role="alert" className="bg-rose-50 text-rose-700 p-3 rounded-xl">
          {error}
        </p>
      )}
      <div className="rounded-2xl overflow-hidden bg-white border border-slate-100 shadow-sm">
        <div className="hidden md:grid grid-cols-[1.1fr_2.4fr_1fr_1.3fr_1.3fr] gap-4 p-4 bg-slate-50 text-[11px] font-bold text-slate-400">
          <span>{isEn ? "Operation" : "نوع العملية"}</span>
          <span>{isEn ? "Description" : "البيان"}</span>
          <span>{isEn ? "Amount" : "المبلغ"}</span>
          <span>{isEn ? "Date & time" : "التاريخ والوقت"}</span>
          <span>{isEn ? "Performed by" : "تمت بواسطة"}</span>
        </div>
        {loading ? (
          <p className="p-8 text-center text-slate-400">
            {isEn ? "Loading..." : "جاري التحميل..."}
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-center text-slate-400 text-sm">
            {isEn
              ? "No operations in this range"
              : "لا توجد عمليات في الفترة المحددة"}
          </p>
        ) : (
          filtered.map((e) => (
            <article
              key={e.id}
              className="p-5 border-b border-slate-100 last:border-0 grid grid-cols-2 md:grid-cols-[1.1fr_2.4fr_1fr_1.3fr_1.3fr] gap-4 items-center"
            >
              <span
                className={`rounded-full px-3 py-2 text-[10px] font-bold justify-self-start ${badge(e.type)}`}
              >
                {labels[e.type] || e.type}
              </span>
              <div className="col-span-2 md:col-span-1 order-3 md:order-none min-w-0">
                <p className="text-sm font-black text-slate-800 break-words">
                  {e.title}
                </p>
                <p className="text-[11px] text-slate-400 mt-1 break-words">
                  {e.reason}
                  {e.receiptNumber ? " • " + e.receiptNumber : ""}
                </p>
              </div>
              <p className="text-rose-600 font-black text-sm order-2 md:order-none text-end md:text-start">
                {Number(e.amount || 0).toLocaleString()} {isEn ? "EGP" : "ج.م"}
              </p>
              <time
                className="text-[11px] font-bold text-slate-500 order-5 md:order-none"
                dateTime={e.createdAt}
              >
                {new Date(e.createdAt).toLocaleString(
                  isEn ? "en-GB" : "ar-EG",
                  {
                    timeZone: "Africa/Cairo",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}
              </time>
              <div className="order-4 md:order-none">
                <p className="text-xs font-black text-slate-700">
                  {e.actorName}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">{isEn&&e.actorRole==='المدير'?'Manager':isEn&&e.actorRole==='موظف'?'Staff':e.actorRole}</p>
              </div>
            </article>
          ))
        )}
      </div>
      <p className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-bold">
        {isEn
          ? "Every cancellation or financial deletion is recorded with the user name. Only actual refunds affect the refund total. Cancellation does not move cash."
          : "كل حذف أو إلغاء مالي يتسجل باسم المستخدم. إجمالي المرتجعات يحسب الفلوس المستردة فعليًا فقط. الإلغاء وحده لا يحرك فلوس الدرج."}
      </p>
    </section>
  );
}
