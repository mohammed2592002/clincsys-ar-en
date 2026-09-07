export interface StaffMember {
  id: string;
  name: string;
  role: string;
  password: string;
  phone?: string;
  createdAt?: string;
  allowedTabs?: string[];
}

export interface Clinic {
  id: string;
  name: string;
  nameAr?: string;
  nameEn?: string;
  logoUrl?: string; // Base64 or URL
  doctorName?: string;
  doctorNameEn?: string;
  doctorPhone?: string;
  doctorSpecialtyAr?: string; // Egyptian/Arab doctor specialty in Arabic
  doctorSpecialtyEn?: string; // Doctor specialty in English
  address?: string;
  clinicHours?: string; // Opening hours / days
  prescriptionStyle?: 'classic' | 'modern' | 'minimal' | 'elegant' | 'custom_pad';
  prescriptionLayout?: 'traditional' | 'table'; // Layout style of medications (unbordered list or grid table)
  customPrescriptionPadConfig?: CustomPrescriptionPadConfig;
  email?: string;
  password?: string;
  createdAt: string;
  isActive?: boolean;
  subscriptionExpiresAt?: string;
  subscriptionPlan?: string;
  staffPin?: string; // Optional simple pin code for staff login (e.g. "1234")
  staffMembers?: StaffMember[];
  customDentalServices?: CustomDentalService[];
  dentalServiceCategories?: string[];
  consultationPrice?: number;
  ownerId?: string;
  additionalPhones?: string[];
  paymentMethods?: string[];
  allowedFeatures?: string[];
  autoBackupEnabled?: boolean;
  autoBackupFormat?: string;
  questionnaireQuestions?: QuestionnaireQuestion[];
  loyaltyProgramEnabled?: boolean;
  loyaltyEarnEgpThreshold?: number;
  loyaltyEarnPoints?: number;
  loyaltyRedeemPointsThreshold?: number;
  loyaltyRedeemDiscountEgp?: number;
  loyaltyMinRedeemPoints?: number;
  bookingSystemMode?: 'time' | 'turn' | 'hybrid';
  dentalChartStyleSettings?: DentalChartStyleSettings;
}

export interface DentalChartStyleSettings {
  drawingStyle?: 'realistic_3d' | 'flat_minimal' | 'high_contrast';
  showBadges?: boolean;
  badgeSize?: 'small' | 'medium' | 'large';
  showRootCanals?: boolean;
  rctColor?: string;
  compositeColor?: string;
  amalgamColor?: string;
  ceramicFillingColor?: string;
  goldCrownColor?: string;
  silverCrownColor?: string;
  zirconiaCrownColor?: string;
  decayColor?: string;
  missingStyle?: 'dashed_cross' | 'fade_out' | 'solid_red_x';
  adultToothSize?: 'compact' | 'normal' | 'spacious';
}

export const DEFAULT_DENTAL_CHART_SETTINGS: DentalChartStyleSettings = {
  drawingStyle: 'realistic_3d',
  showBadges: true,
  badgeSize: 'medium',
  showRootCanals: true,
  rctColor: '#be123c',
  compositeColor: '#0d9488',
  amalgamColor: '#334155',
  ceramicFillingColor: '#0284c7',
  goldCrownColor: '#d97706',
  silverCrownColor: '#475569',
  zirconiaCrownColor: '#0284c7',
  decayColor: '#ef4444',
  missingStyle: 'dashed_cross',
  adultToothSize: 'normal',
};

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  enabled: boolean;
  required?: boolean;
  placeholder?: string;
  category?: string;
  isDefault?: boolean;
}

export const DEFAULT_QUESTIONNAIRE_QUESTIONS: QuestionnaireQuestion[] = [
  {
    id: 'q_thyroid',
    text: 'هل تعاني من قصور أو زيادة في هرمون الغدة الدرقية؟',
    enabled: true,
    placeholder: 'اكتب تفاصيل الغدة الدرقية (خمول / نشاط / أدوية)...',
    category: 'الغدة الدرقية',
    isDefault: true
  },
  {
    id: 'q_diabetes',
    text: 'هل تعاني من مرض السكر؟',
    enabled: true,
    placeholder: 'اكتب تفاصيل السكر (نوع أول / نوع ثاني / تراكمي)...',
    category: 'أمراض مزمنة',
    isDefault: true
  },
  {
    id: 'q_heart',
    text: 'هل توجد مشاكل بالقلب أو ضغط الدم أو السيولة؟',
    enabled: true,
    placeholder: 'اكتب تفاصيل القلب/الضغط (ضغط مرتفع / دعامات / أدوية سيولة)...',
    category: 'القلب والضغط',
    isDefault: true
  },
  {
    id: 'q_chronic',
    text: 'هل تعاني من أي أمراض مزمنة أخرى؟',
    enabled: true,
    placeholder: 'اكتب تفاصيل المرض المزمن (ربو / كبد / كلى / حمل)...',
    category: 'أمراض مزمنة',
    isDefault: true
  },
  {
    id: 'q_allergies',
    text: 'هل يوجد أي نوع من الحساسية الدوائية؟',
    enabled: true,
    placeholder: 'اكتب تفاصيل الحساسية (بنسيلين / أسبرين / مخدر موضعى)...',
    category: 'حساسية وأدوية',
    isDefault: true
  }
];

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  clinicId: string;
  role: 'owner' | 'doctor' | 'receptionist' | 'admin';
  createdAt: string;
}

export interface CustomDentalService {
  id: string;
  name: string;
  price: number;
  condition: DentalTooth['condition'];
  category?: string;
}

export interface RenewalRecord {
  id: string;
  clinicId: string;
  clinicName: string;
  oldExpiry: string;
  newExpiry: string;
  renewedAt: string;
  amount: number;
  paymentMethod?: string;
  notes?: string;
}

export interface PatientQuestionnaire {
  thyroidIssue?: string; // مشاكل الغدة الدرقية (خمول/نشاط)
  hasDiabetes?: string; // السكر
  hasHeartDisease?: string; // أمراض القلب والأوعية الدموية
  chronicDiseases?: string; // أمراض مزمنة أخرى
  allergies?: string; // الحساسية (بنسلين / مخدر / أطعمة)
  generalNotes?: string; // ملاحظات موظف الاستقبال
  customAnswers?: { [questionId: string]: { answer: 'نعم' | 'لا' | string; details?: string } };
  filledBy?: string;
  filledAt?: string;
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  whatsappNumber?: string;
  gender?: 'ذكر' | 'أنثى' | string;
  age: string;
  address?: string; // العنوان التفصيلي
  governorate?: string; // المحافظة
  cityOrDistrict?: string; // المركز / المدينة
  area?: string; // المنطقة / الحي الجغرافي (لتحليلات الحملات الإعلانية والتسويق)
  occupation?: string; // الوظيفة / المهنة
  questionnaire?: PatientQuestionnaire;
  medicalHistory: string;
  createdAt: string;
  updatedAt: string;
  toothChart?: { [toothNumber: number]: DentalTooth };
  loyaltyPoints?: number;
}

export type ViewRole = 'doctor' | 'reception' | 'accounting' | 'admin' | 'owner' | 'Dentist' | 'Receptionist' | 'Administrator';

export type ToothCondition = 'healthy' | 'decayed' | 'caries' | 'filling' | 'root_canal' | 'crown' | 'extraction' | 'implant' | 'bridge' | 'fracture' | 'bleeding_gum' | 'missing' | 'filled' | 'ortho' | 'denture';
export type ToothSurface = 'buccal' | 'lingual' | 'mesial' | 'distal' | 'occlusal' | 'B' | 'L' | 'M' | 'D' | 'O' | 'buccal' | 'lingual';

export interface ToothDetail {
  toothNumber: number;
  condition: ToothCondition;
  notes?: string;
  cost?: number;
  surfaces?: ToothSurface[];
  treatmentDate?: string;
  price?: number;
  history?: DentalToothHistoryItem[];
}

export interface FinancialTransaction {
  id: string;
  type?: 'income' | 'expense';
  category?: string;
  amount: number;
  date?: string;
  patientId?: string;
  patientName?: string;
  procedure?: string;
  notes?: string;
  paymentMethod?: string;
  method?: string;
  paid?: boolean | number;
  timestamp?: string | number;
  recordedBy?: string;
  clinicId?: string;
}

export interface ClinicMetrics {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  patientCount: number;
  appointmentCount: number;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  doctorName?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  procedure?: string;
  cost?: number;
  urgency?: 'normal' | 'urgent' | 'emergency' | string;
  treatmentType?: string;
  price?: number;
  notes: string;
  status: 'scheduled' | 'waiting' | 'in_chair' | 'completed' | 'cancelled';
  paidAmount?: number;
  remainingAmount?: number;
  invoiceStatus?: 'draft' | 'pending_payment' | 'paid' | 'installment';
  dateTime?: string;
  treatment?: string;
  createdAt?: string;
  updatedAt?: string;
  financialNote?: string;
  paymentMethod?: string;
  bookingType?: 'time' | 'turn';
  turnNumber?: number;
  payments?: Array<{
    id: string;
    amount: number;
    paymentMethod: string;
    date: string;
    createdAt: string;
    notes?: string;
    type?: 'initial' | 'installment';
    shiftId?: string;
  }>;
  toothNumber?: number;
  procedures?: Array<{
    name: string;
    price: number;
    tooth?: string | number | null;
  }>;
  shiftId?: string;
}

export interface DentalToothHistoryItem {
  condition: 'healthy' | 'decayed' | 'missing' | 'filled' | 'crown' | 'bridge' | 'implant' | 'ortho' | 'denture';
  serviceName?: string;
  notes?: string;
  date?: string;
  price?: number;
}

export interface DentalTooth {
  toothNumber: number;
  condition: 'healthy' | 'decayed' | 'missing' | 'filled' | 'crown' | 'bridge' | 'implant' | 'ortho' | 'denture';
  notes?: string;
  treatmentDate?: string;
  history?: DentalToothHistoryItem[];
}

export interface PatientXRay {
  id: string;
  patientId: string;
  date: string;
  time?: string;
  imageUrl: string;
  diagnosis?: string;
  createdAt?: string | number;
  originalSize?: number;
  compressedSize?: number;
  mediaId?: string;
  isOfflinePending?: boolean;
}

export interface PatientRecord {
  id: string;
  name?: string;
  phone?: string;
  age?: number | string;
  gender?: string;
  nationalId?: string;
  medicalHistory?: string | string[];
  allergies?: string | string[];
  lastVisit?: string;
  totalSpent?: number;
  unpaidBalance?: number;
  teethNotes?: Record<number, any>;
  date?: string;
  treatment?: string;
  cost?: number;
  notes?: string;
  xrayUrl?: string; // Base64 or template URL
  toothChart?: { [toothNumber: number]: DentalTooth };
  appointmentId?: string;
  invoiceStatus?: 'draft' | 'pending_payment' | 'paid' | 'installment';
  financialNote?: string;
  paymentMethod?: string;
  toothNumber?: number;
  procedures?: any[];
}

export interface Prescription {
  id: string;
  patientId: string;
  patientName: string;
  patientAge?: string;
  date: string;
  medications: Array<{
    name: string;
    dose: string;
    frequency: string;
    duration: string;
  }>;
  notes?: string;
  prescriptionStyle?: 'classic' | 'modern' | 'minimal' | 'elegant' | 'custom_pad';
  prescriptionLayout?: 'traditional' | 'table';
  customPrescriptionPadConfig?: CustomPrescriptionPadConfig;
}

export interface CustomPrescriptionPadElementConfig {
  top: number; // Percentage (e.g. 12)
  left: number; // Percentage (e.g. 10)
  fontSize?: number; // In px (e.g. 15)
  width?: number; // Percentage for boxes (e.g. 84)
  height?: number; // Percentage for boxes (e.g. 50)
}

export interface CustomPrescriptionPadConfig {
  backgroundImage?: string;
  hideBackgroundOnPrint?: boolean;
  patientName: CustomPrescriptionPadElementConfig;
  patientAge: CustomPrescriptionPadElementConfig;
  date: CustomPrescriptionPadElementConfig;
  medicationsBox: CustomPrescriptionPadElementConfig;
  notesBox: CustomPrescriptionPadElementConfig;
}

export const DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG: CustomPrescriptionPadConfig = {
  backgroundImage: '',
  hideBackgroundOnPrint: true,
  patientName: { top: 12, left: 10, fontSize: 15 },
  patientAge: { top: 12, left: 68, fontSize: 15 },
  date: { top: 12, left: 82, fontSize: 14 },
  medicationsBox: { top: 22, left: 8, width: 84, height: 50, fontSize: 14 },
  notesBox: { top: 75, left: 8, width: 84, height: 16, fontSize: 13 }
};

export interface Product {
  id: string;
  nameAr: string;
  catAr: string;
  img: string;
  rating?: number;
  price: number;
  oldPrice?: number;
  stock: number;
  descAr?: string;
  ribbonText?: string;
  ribbonColor?: string;
  images?: string | string[];
}

export interface Category {
  id: string;
  nameAr: string;
}

export interface Order {
  id?: string;
  orderId: string;
  name: string;
  phone: string;
  address: string;
  total: number;
  shipping: number;
  status: string;
  timestamp: number;
  items: Array<{
    id: string;
    nameAr: string;
    price: number;
    qty: number;
  }>;
}

export interface AppSettings {
  maintenance?: boolean;
  logo?: string;
  color?: string;
  promo?: string;
  promoColor?: string;
  heroImg?: string;
  heroTitle?: string;
  heroSub?: string;
  heroTextColor?: string;
}

export interface UserAccount {
  phone: string;
  lastName: string;
  lastAddress: string;
  createdAt: number;
}

export interface Laboratory {
  id: string;
  clinicId: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  createdAt: string;
}

export interface LabOrder {
  id: string;
  clinicId: string;
  doctorId: string;
  doctorName?: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  laboratoryId: string;
  laboratoryName: string;
  appointmentId?: string;
  appointmentDate?: string;
  workType: string; // e.g. Zircon, Veneer, Denture, Ortho...
  toothNumbers: string; // e.g. "14, 15"
  shadeColor: string; // e.g. A1, A2, B1
  sentDate: string; // YYYY-MM-DD
  expectedDeliveryDate: string; // YYYY-MM-DD
  actualDeliveryDate?: string; // YYYY-MM-DD
  cost: number;
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  paidAmount?: number;
  paymentMethod?: string;
  status: 'sent' | 'received' | 'installed' | 'cancelled';
  notes?: string;
  createdAt: string;
}

export interface LabWorkType {
  id: string;
  clinicId: string;
  name: string;
  createdAt: string;
}

export interface SupportContact {
  id: string;
  title: string;
  phone: string;
  availableHours?: string;
  notes?: string;
}

export interface SocialContact {
  id: string;
  platform: 'facebook' | 'instagram' | 'telegram' | 'whatsapp_group' | 'youtube' | 'website' | 'email' | 'tiktok' | 'other';
  title: string;
  url: string;
}

export interface SupportSettings {
  phoneNumbers: SupportContact[];
  socialLinks: SocialContact[];
  workingHoursNotice?: string;
  defaultSystemLogoUrl?: string;
  trialPhoneNumber?: string;
  superAdminHeaderBg?: string;
  superAdminHeaderTextColor?: string;
  updatedAt?: string;
}

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  trialPhoneNumber: '01012345678',
  superAdminHeaderBg: '#0f172a',
  superAdminHeaderTextColor: '#ffffff',
  phoneNumbers: [
    {
      id: 'sup_1',
      title: 'الدعم الفني الرئيسي والتقني',
      phone: '01012345678',
      availableHours: 'طوال أيام الأسبوع من 9:00 ص حتى 10:00 م'
    },
    {
      id: 'sup_2',
      title: 'إدارة المبيعات والاشتراكات',
      phone: '01098765432',
      availableHours: 'من السبت إلى الخميس من 10:00 ص حتى 8:00 م'
    }
  ],
  socialLinks: [
    {
      id: 'soc_1',
      platform: 'whatsapp_group',
      title: 'مجتمع أطباء الأسنان على واتساب',
      url: 'https://chat.whatsapp.com/'
    },
    {
      id: 'soc_2',
      platform: 'facebook',
      title: 'الصفحة الرسمية للبرنامج على فيسبوك',
      url: 'https://facebook.com/'
    },
    {
      id: 'soc_3',
      platform: 'telegram',
      title: 'قناة التحديثات والأخبار على تليجرام',
      url: 'https://t.me/'
    }
  ],
  workingHoursNotice: 'مواعيد عمل فريق الدعم الفني يومياً من الساعة 9:00 صباحاً وحتى 10:00 مساءً عدا الجمعة.'
};


