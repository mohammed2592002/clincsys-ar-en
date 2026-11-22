import { commandMessage } from "../utils/commandMessages";
import React, { useEffect, useState } from "react";
import {useDialogs} from "./DialogContext";
import {
  getPendingCommands,
  flushDurableCommands,
  processSyncQueue,
  reviewDurableCommand,
  resolveDurableCommand,
  getAuthToken,
  exportCommandHistory,
  pendingMoneyAmount,
  inspectFinancialConflict,
  reconcileFinancialConflict,
} from "../dbClient";
import { getSyncQueue, getAllPendingOfflineMedia } from "../utils/offlineDb";
import { commandOwner, type DurableCommand } from "../utils/commandQueue";

export default function OfflineCommands({
  isEn,
  shiftId,
  showEmpty,
}: {
  isEn: boolean;
  shiftId?: string;
  showEmpty?: boolean;
}) {
  const dialogs = useDialogs();
  const [commands, setCommands] = useState<DurableCommand[]>([]);
  const [financialReview, setFinancialReview] = useState<any>(null);
  const [reviewReason, setReviewReason] = useState("");
  const manager = commandOwner(getAuthToken()).startsWith("manager:");
  const [legacyCount, setLegacyCount] = useState(0);
  const [mediaCount, setMediaCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<{
    command: DurableCommand;
    current: any;
  } | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const owner = commandOwner(getAuthToken()),
          clinicId = owner.split(":")[1];
        const c = await getPendingCommands();
        const old = await getSyncQueue();
        const media = await getAllPendingOfflineMedia();
        if (live) {
          setCommands(
            shiftId
              ? c.filter(
                  (x) =>
                    x.financial &&
                    pendingMoneyAmount(x) > 0 &&
                    (!x.body.expectedShiftId ||
                      x.body.expectedShiftId === shiftId),
                )
              : c,
          );
          setLegacyCount(
            old.filter(
              (x) =>
                x.action !== "uploadOfflineMedia" &&
                x.path.startsWith("clinics/" + clinicId + "/"),
            ).length,
          );
          setMediaCount(
            media.filter(
              (x) => x.clinicId === clinicId && (!x.owner || x.owner === owner),
            ).length,
          );
        }
      } catch {
        if (live)
          setError(
            isEn
              ? "Unable to read saved requests. Do not clear browser data."
              : "تعذر قراءة الطلبات المحفوظة. لا تمسح بيانات المتصفح.",
          );
      }
    };
    load();
    window.addEventListener("offline-commands-changed", load);
    const timer = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("offline-commands-changed", load);
    };
  }, [shiftId, isEn]);
  const run = async (action: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e: any) {
      setError(commandMessage(e.message || String(e), isEn));
    } finally {
      setBusy(false);
    }
  };
  const exportQueue = async () => {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip(),
      owner = commandOwner(getAuthToken()),
      clinicId = owner.split(":")[1];
    const media = (await getAllPendingOfflineMedia()).filter(
      (m) => m.clinicId === clinicId && (!m.owner || m.owner === owner),
    );
    zip.file(
      "pending-commands.json",
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          commands: await exportCommandHistory(),
        },
        null,
        2,
      ),
    );
    zip.file(
      "attachments.json",
      JSON.stringify(
        media.map(({ blob, dataUrl, ...m }) => m),
        null,
        2,
      ),
    );
    for (const m of media) {
      if (m.blob) zip.file("attachments/" + m.id, m.blob);
      else if (m.dataUrl)
        zip.file("attachments/" + m.id + ".dataurl.txt", m.dataUrl);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "clinic-pending-recovery.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!commands.length && (shiftId || (!legacyCount && !mediaCount)) && !error)
    return showEmpty ? (
      <p className="rounded-xl bg-emerald-50 p-4 text-emerald-800">
        {isEn
          ? "No pending requests or conflicts on this device."
          : "لا توجد طلبات معلقة أو تعارضات على هذا الجهاز."}
      </p>
    ) : null;
  const conflicts = commands.filter((c) => c.status === "conflict").length;
  const tableLabel = (c: DurableCommand) => {
    const labels: Record<string, string> = {
      patients: "مريض",
      appointments: "موعد",
      expenses: "مصروف",
      lab_orders: "طلب معمل",
      records: "سجل طبي",
      xrays: "أشعة",
      prescriptions: "روشتة",
      inventory: "مخزون",
      clinics: "إعدادات العيادة",
      collect: "تحصيل",
      refund: "رد مبلغ",
      points: "نقاط",
      discount: "خصم",
    };
    const english: Record<string, string> = {
      patients: "Patient",
      appointments: "Appointment",
      expenses: "Expense",
      lab_orders: "Lab order",
      records: "Medical record",
      xrays: "X-ray",
      prescriptions: "Prescription",
      inventory: "Inventory",
      clinics: "Clinic settings",
      collect: "Payment",
      refund: "Refund",
      points: "Points",
      discount: "Discount",
    };
    return isEn
      ? english[c.body.table || c.body.action] || "Saved request"
      : labels[c.body.table || c.body.action] || "طلب محفوظ";
  };
  const fieldLabel = (key: string) => {
    const labels: Record<string, [string, string]> = {
      phone: ["رقم التليفون", "Phone number"],
      time: ["وقت الموعد", "Appointment time"],
      date: ["تاريخ الموعد", "Appointment date"],
      name: ["الاسم", "Name"],
      patientName: ["اسم المريض", "Patient name"],
      notes: ["الملاحظات", "Notes"],
      status: ["الحالة", "Status"],
      price: ["التكلفة", "Price"],
      amount: ["المبلغ", "Amount"],
      quantity: ["الكمية", "Quantity"],
      address: ["العنوان", "Address"],
      paymentMethod: ["طريقة الدفع", "Payment method"],
      treatmentType: ["نوع العلاج", "Treatment type"],
      doctorName: ["اسم الطبيب", "Doctor name"],
      consultationPrice: ["سعر الكشف", "Consultation price"],
      medicalHistory: ["التاريخ المرضي", "Medical history"],
      imageUrl: ["ملف الأشعة", "X-ray file"],
      url: ["رابط الملف", "File link"],
      prescriptionStyle: ["شكل الروشتة", "Prescription style"],
      bookingSystemMode: ["نظام الحجز", "Booking mode"],
    };
    return (
      labels[key]?.[isEn ? 1 : 0] || (isEn ? "Edited detail" : "بيان معدل")
    );
  };
  const valueText = (value: any) =>
    value === null || value === undefined || value === ""
      ? isEn
        ? "Not set"
        : "غير مسجل"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  const dateText = (value?: string) =>
    value
      ? new Date(value).toLocaleString(isEn ? "en-GB" : "ar-EG", {
          timeZone: "Africa/Cairo",
        })
      : isEn
        ? "Not recorded"
        : "غير مسجل";
  const conflictDetails = (c: DurableCommand, current?: any) => {
    const fields = current
      ? Object.keys(c.body.data || {})
          .filter(
            (k) => !["updatedAt", "_syncStatus", "_fieldEdits"].includes(k),
          )
          .map((key) => ({
            key,
            serverValue: current?.[key],
            localValue: c.body.data[key],
            serverEditor: current?._fieldEdits?.[key],
          }))
      : c.conflict?.fields || [];
    return (
      <div className="space-y-3 mt-2">
        {fields.map((f: any) => (
          <div
            key={f.key}
            className="bg-slate-50 text-slate-800 rounded-lg p-3 space-y-2 break-words"
          >
            <p className="font-black">
              {isEn ? "Conflicting field: " : "التعارض في: "}
              {fieldLabel(f.key)}
            </p>
            <div>
              <p className="font-bold">
                {isEn ? "Saved on the server: " : "المسجل على السيرفر: "}
                {valueText(f.serverValue)}
              </p>
              <p className="text-[11px] text-slate-500">
                {isEn ? "Edited by: " : "عدله: "}
                {f.serverEditor?.name ||
                  (isEn
                    ? "Not recorded for this older edit"
                    : "غير مسجل للتعديل القديم")}{" "}
                • {dateText(f.serverEditor?.at)}
              </p>
            </div>
            <div>
              <p className="font-bold">
                {isEn ? "Sent from this device: " : "المبعوت من جهازك: "}
                {valueText(f.localValue)}
              </p>
              <p className="text-[11px] text-slate-500">
                {isEn ? "Edited by: " : "عدله: "}
                {c.actorName || (isEn ? "This account" : "هذا الحساب")} •{" "}
                {dateText(c.createdAt)}{" "}
                {isEn ? "(device time)" : "(وقت الجهاز)"}
              </p>
            </div>
          </div>
        ))}
      </div>
    );
  };
  const decide = async (choice: "server" | "local") => {
    if (!review) return;
    const text =
      choice === "server"
        ? isEn
          ? "Keep the server version? Your unsent edit will be archived, not applied."
          : "الاحتفاظ بنسخة السيرفر؟ تعديلك غير المرسل هيتحفظ في الأرشيف ولن يتم تطبيقه."
        : isEn
          ? "Apply your displayed changes against this server version? A newer server change will still stop the request."
          : "تطبيق تعديلك المعروض على النسخة دي؟ لو السيرفر اتغير تاني الطلب هيتوقف للمراجعة.";
    if (!(await dialogs.confirm(text, {
      title: isEn ? 'Confirm review' : 'تأكيد المراجعة',
      confirmText: isEn ? 'Confirm' : 'نعم، متأكد',
      cancelText: isEn ? 'Cancel' : 'إلغاء',
    }))) return;
    await resolveDurableCommand(review.command.id, choice, review.current);
    setReview(null);
  };
  return (
    <section
      dir={isEn ? "ltr" : "rtl"}
      className={`rounded-xl border p-4 text-xs ${conflicts ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-amber-50 border-amber-200 text-amber-900"}`}
    >
      {shiftId && (
        <p className="font-black mb-3">
          {isEn
            ? "Pending money, NOT included in drawer totals"
            : "مبالغ في الانتظار، غير محسوبة في إجمالي الدرج"}
          :{" "}
          {commands
            .reduce((n, c) => n + pendingMoneyAmount(c), 0)
            .toLocaleString()}{" "}
          {isEn ? "EGP" : "ج.م"}
        </p>
      )}
      <div className="flex gap-3 items-center flex-wrap">
        <p className="font-bold">
          {isEn
            ? `${commands.length} saved ${commands.length === 1 ? "request" : "requests"} awaiting confirmation. ${conflicts} ${conflicts === 1 ? "needs" : "need"} review.`
            : `${commands.length} طلب محفوظ في انتظار التأكيد. ${conflicts} محتاج مراجعة.`}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="underline font-bold"
        >
          {isEn ? "View requests" : "عرض الطلبات"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await flushDurableCommands({manual:true});
              await processSyncQueue();
            })
          }
          className="underline font-bold"
        >
          {isEn ? "Sync now" : "مزامنة الآن"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(exportQueue)}
          className="underline font-bold"
        >
          {isEn ? "Save a recovery copy" : "تنزيل نسخة استرجاع"}
        </button>
      </div>
      {!shiftId && !!mediaCount && (
        <p className="mt-3">
          {isEn
            ? `${mediaCount} attachment(s) saved on this device. Older files without a verified account need manual review before upload.`
            : `${mediaCount} مرفق محفوظ على الجهاز. الملفات القديمة غير المرتبطة بحساب موثق تحتاج مراجعة قبل الرفع.`}
        </p>
      )}
      {!shiftId && !!legacyCount && (
        <p className="mt-3 font-bold">
          {isEn
            ? `${legacyCount} older offline changes require review against server records. Do not re-enter financial changes before checking receipts.`
            : `${legacyCount} حركة أوفلاين قديمة تحتاج مراجعة مقابل سجلات السيرفر. لا تعيد تسجيل المبالغ قبل مراجعة الإيصالات.`}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 font-bold">
          {error}
        </p>
      )}
      {expanded && (
        <div className="mt-4 space-y-3">
          <p>
            {isEn
              ? "Do not re-enter pending money or clear browser data. Conflicting requests stay saved instead of overwriting another device."
              : "لا تسجل المبالغ المعلقة مرة ثانية ولا تمسح بيانات المتصفح. الطلب المتعارض يفضل محفوظ بدل استبدال تعديل جهاز آخر."}
          </p>
          {commands.map((c) => (
            <div
              key={c.id}
              className="bg-white p-3 rounded-xl border border-black/5 space-y-2 break-words"
            >
              <div className="flex gap-3 justify-between">
                <strong className="min-w-0 break-all">
                  {tableLabel(c)}:{" "}
                  {c.conflict?.entityName ||
                    c.entityName ||
                    (isEn ? "Saved record" : "سجل محفوظ")}
                </strong>
                <span className="shrink-0">
                  {c.status === "conflict"
                    ? isEn
                      ? "Needs review"
                      : "محتاج مراجعة"
                    : isEn
                      ? "Unconfirmed"
                      : "غير مؤكد"}
                </span>
              </div>
              <p>
                {c.body.amount ?? c.body.data?.amount ?? ""}{" "}
                {c.conflict?.fields?.length
                  ? isEn
                    ? "This detail differs from the saved version. Compare both values before choosing."
                    : "البيانات مختلفة عن النسخة المحفوظة. قارن القيمتين قبل الاختيار."
                  : commandMessage(c.error || "", isEn)}
              </p>
              {c.status === "conflict" && conflictDetails(c)}
              <p className="text-[11px] opacity-70">
                {isEn ? "Saved locally: " : "اتحفظ على جهازك: "}
                {dateText(c.createdAt)}
              </p>
              {c.status === "conflict" && !c.financial && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => setReview(await reviewDurableCommand(c.id)))
                  }
                  className="underline font-bold"
                >
                  {isEn ? "Compare with server" : "مقارنة بنسخة السيرفر"}
                </button>
              )}
              {c.status === "conflict" && c.financial && manager && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      setFinancialReview(await inspectFinancialConflict(c.id)),
                    )
                  }
                  className="underline font-bold"
                >
                  {isEn ? "Financial review" : "مراجعة مالية"}
                </button>
              )}
              {c.status === "conflict" && c.financial && (
                <p>
                  {isEn
                    ? "Financial review required. No amount is added to confirmed totals."
                    : "تحتاج مراجعة مالية مع المدير. المبلغ غير مضاف للإجماليات المؤكدة."}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {financialReview && (
        <div className="mt-4 rounded-xl bg-white border border-slate-300 p-4 space-y-3 text-slate-800">
          <h3 className="font-black">
            {isEn
              ? "Financial review, no forced balance changes"
              : "مراجعة مالية، بدون فرض تعديل على الرصيد"}
          </h3>
          <p>
            {isEn ? "Requested amount: " : "المبلغ المطلوب: "}
            {pendingMoneyAmount(financialReview.command)} {isEn ? "EGP" : "ج.م"}
          </p>
          <p>
            {isEn ? "Server status: " : "حالة السيرفر: "}
            {financialReview.requestState === "confirmed"
              ? isEn
                ? "Already confirmed"
                : "مؤكد بالفعل"
              : financialReview.requestState === "voided"
                ? isEn
                  ? "Already archived"
                  : "مؤرشف بالفعل"
                : isEn
                  ? "Not confirmed"
                  : "غير مؤكد"}
          </p>
          {financialReview.appointment && (
            <p>
              {isEn
                ? "Confirmed paid / remaining: "
                : "المدفوع المؤكد / المتبقي: "}
              {financialReview.appointment.paidAmount || 0} /{" "}
              {financialReview.appointment.remainingAmount ??
                Math.max(
                  0,
                  Number(financialReview.appointment.price || 0) -
                    Number(financialReview.appointment.paidAmount || 0),
                )}
            </p>
          )}
          <p>
            {isEn
              ? "Check the original receipt and drawer. This will never add money. A confirmed request stays confirmed. An unconfirmed request is archived on the server so it cannot be retried later."
              : "راجع الإيصال الأصلي والدرج. الحسم هنا لا يضيف أموالًا. الطلب المؤكد يظل مؤكدًا، وغير المؤكد يتأرشف على السيرفر لمنع تنفيذه لاحقًا."}
          </p>
          <label className="block font-bold">
            {isEn ? "Review reason" : "سبب المراجعة"}
            <input
              aria-label={isEn ? "Review reason" : "سبب المراجعة"}
              value={reviewReason}
              onChange={(e) => setReviewReason(e.target.value)}
              className="block w-full border rounded-lg p-2 mt-2"
            />
          </label>
          <button
            disabled={busy || !reviewReason.trim()}
            onClick={() =>
              run(async () => {
                if (
                  !(await dialogs.confirm(
                    isEn
                      ? "Finish this financial review without adding money?"
                      : "تأكيد إنهاء المراجعة بدون إضافة مبلغ؟",
                    {title: isEn ? 'Confirm review' : 'تأكيد المراجعة', confirmText: isEn ? 'Confirm' : 'نعم، متأكد', cancelText: isEn ? 'Cancel' : 'إلغاء'},
                  ))
                )
                  return;
                await reconcileFinancialConflict(
                  financialReview.command.id,
                  reviewReason,
                );
                setFinancialReview(null);
                setReviewReason("");
              })
            }
            className="bg-[#272E40] rounded-lg text-white px-3 py-2 font-bold disabled:opacity-50"
          >
            {isEn
              ? "Confirm review without adding money"
              : "تأكيد المراجعة بدون إضافة مبلغ"}
          </button>
          <button onClick={() => setFinancialReview(null)} className="mx-3">
            {isEn ? "Cancel" : "إلغاء"}
          </button>
        </div>
      )}
      {review && (
        <div className="mt-4 rounded-xl border border-slate-300 bg-white p-4 text-slate-800 space-y-3">
          <h3 className="font-black">
            {isEn ? "Review conflicting fields" : "مراجعة الحقول المتعارضة"}
          </h3>
          <p className="font-bold">
            {review.command.conflict?.entityName ||
              review.command.entityName ||
              review.current?.patientName ||
              review.current?.name ||
              (isEn ? "Saved record" : "سجل محفوظ")}
          </p>
          {conflictDetails(review.command, review.current)}
          <div className="flex gap-3 flex-wrap">
            <button
              disabled={busy}
              onClick={() => run(() => decide("server"))}
              className="rounded-lg bg-slate-100 px-3 py-2 font-bold"
            >
              {isEn ? "Keep server version" : "الاحتفاظ بنسخة السيرفر"}
            </button>
            {!review.command.body.create && (
              <button
                disabled={busy}
                onClick={() => run(() => decide("local"))}
                className="rounded-lg bg-[#272E40] px-3 py-2 text-white font-bold"
              >
                {isEn ? "Apply my displayed edit" : "تطبيق تعديلي المعروض"}
              </button>
            )}
            <button onClick={() => setReview(null)}>
              {isEn ? "Cancel" : "إلغاء"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
