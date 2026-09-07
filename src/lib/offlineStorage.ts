import { Appointment, PatientRecord, FinancialTransaction } from "../types";

const LOCAL_KEY_APPOINTMENTS = "coredentsys_appointments_v1";
const LOCAL_KEY_PATIENTS = "coredentsys_patients_v1";
const LOCAL_KEY_TRANSACTIONS = "coredentsys_transactions_v1";
const LOCAL_KEY_OFFLINE_QUEUE = "coredentsys_offline_queue_v1";

export const initialMockAppointments: Appointment[] = [
  {
    id: "apt-101",
    patientId: "p-001",
    patientName: "أحمد محمود علي",
    patientPhone: "01012345678",
    time: "10:00 AM",
    procedure: "حشو عصب وسحب عصب (Root Canal)",
    doctorName: "د. طارق الحسين",
    status: "in_chair",
    urgency: "urgent",
    notes: "يعاني من ألم شديد في الضرس السفلي الأيمن #46",
    cost: 1800,
    paidAmount: 1300,
    createdAt: new Date().toISOString(),
  },
  {
    id: "apt-102",
    patientId: "p-002",
    patientName: "مريم يسري السيد",
    patientPhone: "01198765432",
    time: "10:30 AM",
    procedure: "تنظيف جير وتلميع أسنان (Scaling)",
    doctorName: "د. طارق الحسين",
    status: "waiting",
    urgency: "normal",
    notes: "تنظيف دوري وتبييض زوم",
    cost: 800,
    paidAmount: 800,
    createdAt: new Date().toISOString(),
  },
  {
    id: "apt-103",
    patientId: "p-003",
    patientName: "خالد عبد الفتاح",
    patientPhone: "01234567890",
    time: "11:15 AM",
    procedure: "تركيب زيركون كراون (Zirconia Crown)",
    doctorName: "د. سارة عادل",
    status: "waiting",
    urgency: "normal",
    notes: "تجربة المقاس النهائي للتاج للسن #21",
    cost: 2500,
    paidAmount: 2000,
    createdAt: new Date().toISOString(),
  },
  {
    id: "apt-104",
    patientId: "p-004",
    patientName: "هدى عبد المنعم",
    patientPhone: "01055544332",
    time: "12:00 PM",
    procedure: "خلع جراحي لضرس العقل (Wisdom Extraction)",
    doctorName: "د. طارق الحسين",
    status: "waiting",
    urgency: "urgent",
    notes: "تخدير موضعى خاص بالمرأة الحامل",
    cost: 1200,
    paidAmount: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "apt-105",
    patientId: "p-005",
    patientName: "عمر فاروق حسن",
    patientPhone: "01122334455",
    time: "01:00 PM",
    procedure: "تقويم أسنان شفاف (Invisalign Check)",
    doctorName: "د. سارة عادل",
    status: "completed",
    urgency: "normal",
    notes: "تغيير قالب التقويم رقم 4",
    cost: 1500,
    paidAmount: 1500,
    createdAt: new Date().toISOString(),
  },
];

export const initialMockPatients: PatientRecord[] = [
  {
    id: "p-001",
    name: "أحمد محمود علي",
    phone: "01012345678",
    age: 34,
    gender: "male",
    nationalId: "28905120101234",
    medicalHistory: ["ضغط دم مرتفع (Hypertension)", "حساسية بنسيلين"],
    allergies: ["Penicillin", "Aspirin"],
    lastVisit: "2026-07-24",
    totalSpent: 4500,
    unpaidBalance: 500,
    teethNotes: {
      46: { toothNumber: 46, condition: "root_canal", cost: 1800, notes: "سحب عصب الجذور الثلاثة" },
      11: { toothNumber: 11, condition: "crown", cost: 1500, notes: "تاج إيمكس تجميلي" },
    },
    notes: "مريض يتوتر من صوت المتهورة، يفضل استخدام التخدير اللطيف واستماع تعليمات صوتية هادئة.",
  },
  {
    id: "p-002",
    name: "مريم يسري السيد",
    phone: "01198765432",
    age: 28,
    gender: "female",
    nationalId: "29608150109876",
    medicalHistory: ["سليمة - لا يوجد أمراض مزمنة"],
    allergies: [],
    lastVisit: "2026-06-12",
    totalSpent: 3200,
    unpaidBalance: 0,
    teethNotes: {
      21: { toothNumber: 21, condition: "filling", cost: 600, notes: "حشو كومبوزيت تجميلي" },
    },
    notes: "تهتم بتجميل الأسنان وابتسامة هوليود.",
  },
  {
    id: "p-003",
    name: "خالد عبد الفتاح",
    phone: "01234567890",
    age: 42,
    gender: "male",
    medicalHistory: ["مرض السكري النوع الثاني (Type 2 Diabetes)"],
    allergies: [],
    lastVisit: "2026-07-18",
    totalSpent: 8900,
    unpaidBalance: 500,
    teethNotes: {
      16: { toothNumber: 16, condition: "implant", cost: 6000, notes: "زراعة سن كوري متطور" },
    },
    notes: "متابعة نسبة السكر قبل إجراء أي تدخل جراحي.",
  },
  {
    id: "p-004",
    name: "هدى عبد المنعم",
    phone: "01055544332",
    age: 31,
    gender: "female",
    medicalHistory: ["حامل في الشهر الخامس"],
    allergies: ["Sulfa"],
    lastVisit: "2026-07-24",
    totalSpent: 1200,
    unpaidBalance: 1200,
    teethNotes: {
      38: { toothNumber: 38, condition: "caries", cost: 1200, notes: "ضرس عقل مدفون جزئياً" },
    },
    notes: "تجنب الأشعة إلا للضرورة القصوى مع حماية الرصاص.",
  },
];

export const initialMockTransactions: FinancialTransaction[] = [
  {
    id: "tx-1",
    patientId: "p-001",
    patientName: "أحمد محمود علي",
    procedure: "دفعة حشو عصب #46",
    amount: 1800,
    paid: 1300,
    method: "cash",
    timestamp: "10:15 AM",
    recordedBy: "الريسبشن - منى",
  },
  {
    id: "tx-2",
    patientId: "p-002",
    patientName: "مريم يسري السيد",
    procedure: "تنظيف جير وتلميع",
    amount: 800,
    paid: 800,
    method: "instapay",
    timestamp: "10:45 AM",
    recordedBy: "الريسبشن - منى",
  },
  {
    id: "tx-3",
    patientId: "p-005",
    patientName: "عمر فاروق حسن",
    procedure: "قالب تقويم شفاف #4",
    amount: 1500,
    paid: 1500,
    method: "card",
    timestamp: "01:20 PM",
    recordedBy: "الريسبشن - منى",
  },
];

// Helper to get local stored appointments
export function getLocalAppointments(): Appointment[] {
  try {
    const data = localStorage.getItem(LOCAL_KEY_APPOINTMENTS);
    return data ? JSON.parse(data) : initialMockAppointments;
  } catch {
    return initialMockAppointments;
  }
}

export function saveLocalAppointments(apts: Appointment[]) {
  try {
    localStorage.setItem(LOCAL_KEY_APPOINTMENTS, JSON.stringify(apts));
  } catch (err) {
    console.error("Failed to save appointments locally", err);
  }
}

export function getLocalPatients(): PatientRecord[] {
  try {
    const data = localStorage.getItem(LOCAL_KEY_PATIENTS);
    return data ? JSON.parse(data) : initialMockPatients;
  } catch {
    return initialMockPatients;
  }
}

export function saveLocalPatients(pats: PatientRecord[]) {
  try {
    localStorage.setItem(LOCAL_KEY_PATIENTS, JSON.stringify(pats));
  } catch (err) {
    console.error("Failed to save patients locally", err);
  }
}

export function getLocalTransactions(): FinancialTransaction[] {
  try {
    const data = localStorage.getItem(LOCAL_KEY_TRANSACTIONS);
    return data ? JSON.parse(data) : initialMockTransactions;
  } catch {
    return initialMockTransactions;
  }
}

export function saveLocalTransactions(txs: FinancialTransaction[]) {
  try {
    localStorage.setItem(LOCAL_KEY_TRANSACTIONS, JSON.stringify(txs));
  } catch (err) {
    console.error("Failed to save transactions locally", err);
  }
}
