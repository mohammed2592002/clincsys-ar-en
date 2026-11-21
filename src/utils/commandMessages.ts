export function commandMessage(message: string, english: boolean): string {
  if (!english || !/[\u0600-\u06ff]/.test(message || "")) return message;
  const rules: [string, string][] = [
    [
      "لا يمكن حذف المريض",
      "This patient cannot be deleted because appointments, financial transactions or treatment history are linked to the record.",
    ],
    [
      "محفوظ على الجهاز كطلب غير مؤكد",
      "Saved on this device, awaiting server confirmation. It will sync when the connection returns. Do not enter it again.",
    ],
    [
      "تعارض تعديل",
      "The same detail was edited on another device. Compare both versions before choosing.",
    ],
    [
      "المبلغ أكبر من المستحق",
      "The amount exceeds the current outstanding balance.",
    ],
    [
      "الاسترداد أكبر من المتاح",
      "The refund exceeds the amount available on the original receipt.",
    ],
    [
      "لا يمكن تحصيل موعد ملغي",
      "A cancelled appointment cannot accept a payment.",
    ],
    [
      "الوردية تغيرت",
      "The active shift changed before synchronization. A manager must review this request.",
    ],
    [
      "هناك وردية مفتوحة",
      "A shift is already open. Close it manually before opening another.",
    ],
    ["افتح وردية", "Open a shift before recording a financial transaction."],
    ["الوردية مقفولة", "This shift is closed or no longer exists."],
    ["هذه العملية متاحة للمدير", "Only the manager can perform this action."],
    [
      "المراجعة المالية للمدير",
      "Financial review is available to the manager only.",
    ],
    [
      "لا توجد صلاحية",
      "This account does not have permission for this action.",
    ],
    [
      "يلزم دخول بحساب موظف مسمى",
      "Sign in with a named staff account before recording financial transactions.",
    ],
    [
      "حساب الموظف غير موجود",
      "This staff account is no longer available. Sign in again.",
    ],
    ["الطلب يخص حساب", "This request belongs to a different account."],
    [
      "الطلب مؤرشف",
      "The manager archived this request. It cannot be applied later.",
    ],
    [
      "رصيد النقاط أو الحد الأدنى",
      "The points balance or minimum redemption requirement does not allow this payment.",
    ],
    ["محفظة النقاط غير متاحة", "The points wallet is not available."],
    ["سبب الاسترداد مطلوب", "Enter a reason for the refund."],
    ["سبب الخصم مطلوب", "Enter a reason for the discount."],
    ["سبب المراجعة مطلوب", "Enter a reason for the financial review."],
    ["سبب التسوية مطلوب", "Enter a reason for the manual assignment."],
    [
      "مبلغ غير صالح",
      "Enter a valid positive amount with no more than two decimal places.",
    ],
    ["المبلغ يجب أن يكون أكبر من صفر", "The amount must be greater than zero."],
    ["قيمة المصروف أكبر من صفر", "The expense must be greater than zero."],
    [
      "توجد حركات مالية معلقة",
      "Financial requests are still pending. Review Settings > Alerts before closing the shift.",
    ],
    [
      "تغيرت نسخة السيرفر",
      "The server version changed after it was displayed. Compare the versions again.",
    ],
    ["تغير الحساب", "The signed-in account changed. Reopen Alerts."],
    [
      "تغيير بيانات الدخول",
      "Credentials, permissions and subscription changes require a live connection.",
    ],
    [
      "لا يمكن تغيير نظام الحجز",
      "The booking mode cannot change while appointments exist.",
    ],
    [
      "السجل غير موجود",
      "This record is no longer available on the server. A manager must review it.",
    ],
    [
      "سجل المريض غير موجود",
      "The patient record is not available on the server yet.",
    ],
    [
      "توجد ورديات متعارضة",
      "Conflicting open shifts require a manager to review them.",
    ],
    [
      "هناك دفعات قديمة",
      "Older transactions have no assigned shift. Complete manual assignment before closing.",
    ],
    [
      "موعد قديم",
      "This older appointment needs manager review. No historical balance was changed automatically.",
    ],
    [
      "رصيد قديم",
      "This older balance needs manager review. No historical balance was changed automatically.",
    ],
    [
      "المصروف المسجل لا يعدل",
      "An existing expense cannot be overwritten. Cancel it with an audit record, then enter the correct expense.",
    ],
    [
      "مصروف وردية مقفولة",
      "An expense in a closed shift requires a separate adjustment.",
    ],
    [
      "معرف الطلب مستخدم",
      "This request ID is already used for a different action.",
    ],
    [
      "معرف السجل مستخدم",
      "This record ID is already in use. Review the conflicting record.",
    ],
    ["العيادة موقوفة", "This clinic is suspended."],
    ["يلزم تسجيل الدخول", "Sign in before continuing."],
    ["غير مصرح", "This account is not authorized for the requested record."],
    ["السجل لا يقبل التعديل", "This audit record cannot be edited."],
    ["الحذف غير مسموح", "This record cannot be deleted."],
    [
      "الدفعة على السيرفر",
      "The payment has not yet been confirmed by the server.",
    ],
  ];
  return (
    rules.find(([match]) => message.includes(match))?.[1] ||
    "The server did not confirm this request. Review its details in Settings > Alerts before trying again."
  );
}
