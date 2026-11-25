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
  orthodonticCatalogVersion?: number;
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

export interface DoctorNote {
  id: string;
  text: string;
  doctorName: string;
  createdAt: string;
  updatedAt?: string;
  edited?: boolean;
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
  doctorNotes?: DoctorNote[];
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
  displayImageUrl?: string; // Authenticated display bytes, never persisted as the canonical file URL.
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
  trialPhoneNumber: '',
  superAdminHeaderBg: '#0f172a',
  superAdminHeaderTextColor: '#ffffff',
  phoneNumbers: [],
  socialLinks: [],
  workingHoursNotice: ''
};

// ==================== LANDING PAGE (PUBLIC WEBSITE) CONTENT ====================
// Everything the public marketing site shows is stored in one
// system_settings/landing_page document so the super admin can change any
// word, image, contact link or pricing plan without touching the code.

export interface LandingTexts {
  brandName: string;
  navFeatures: string;
  navHow: string;
  navPricing: string;
  navContact: string;
  loginLabel: string;
  heroBadge: string;
  heroTitleA: string;
  heroTitleB: string;
  heroSubtitle: string;
  trialButtonLabel: string;
  pricingButtonLabel: string;
  heroPoint1: string;
  heroPoint2: string;
  heroPoint3: string;
  heroImageCaption: string;
  chartImageCaption: string;
  financeImageCaption: string;
  offlineNote: string;
  planPopularTag: string;
  painsKicker: string;
  painsTitle: string;
  painsResolve: string;
  painsResolveStrong: string;
  painsNote: string;
  featuresKicker: string;
  featuresTitle: string;
  featuresSubtitle: string;
  stepsKicker: string;
  stepsTitle: string;
  pricingKicker: string;
  pricingTitle: string;
  pricingSubtitle: string;
  ctaTitle: string;
  ctaSubtitle: string;
  ctaTrialLabel: string;
  ctaLoginLabel: string;
  footerCommunityLabel: string;
  footerFacebookLabel: string;
  footerFaqLabel: string;
  footerCopyright: string;
  trialWhatsappPrefill: string;
}

export interface LandingFeature {
  id: string;
  icon: string; // key from LANDING_ICON_OPTIONS
  ar: { title: string; desc: string };
  en?: { title?: string; desc?: string };
}

export interface LandingStat {
  id: string;
  ar: { value: string; label: string };
  en?: { value?: string; label?: string };
}

export interface LandingStep {
  id: string;
  ar: { title: string; desc: string };
  en?: { title?: string; desc?: string };
}

export interface LandingPain {
  id: string;
  ar: { text: string };
  en?: { text?: string };
}

export interface LandingPlan {
  id: string;
  price: string;
  popular: boolean;
  ar: { name: string; desc: string; period: string; features: string[]; buttonLabel: string };
  en?: { name?: string; desc?: string; period?: string; features?: string[]; buttonLabel?: string };
}

export interface LandingSiteContent {
  ar: LandingTexts;
  en?: Partial<LandingTexts>;
  logoUrl: string;
  faviconUrl: string;
  heroImageUrl: string;
  chartImageUrl: string;
  financeImageUrl: string;
  whatsappNumber: string;
  whatsappCommunityUrl: string;
  facebookUrl: string;
  features: LandingFeature[];
  stats: LandingStat[];
  steps: LandingStep[];
  plans: LandingPlan[];
  pains: LandingPain[];
  updatedAt?: string;
}

export const LANDING_ICON_OPTIONS = [
  'calendar', 'tooth', 'image', 'chat', 'pill', 'wallet', 'offline', 'buildings',
  'lock', 'globe', 'phone', 'star', 'users', 'clock', 'check'
] as const;

export const DEFAULT_LANDING_TEXTS_AR: LandingTexts = {
  brandName: 'CoreDentSys',
  navFeatures: 'المميزات',
  navHow: 'إزاي بيشتغل',
  navPricing: 'الأسعار',
  navContact: 'تواصل معنا',
  loginLabel: 'تسجيل الدخول',
  heroBadge: 'يشتغل حتى لو النت قطع — أوفلاين بالكامل',
  heroTitleA: 'إدارة عيادتك كلها',
  heroTitleB: 'من مكان واحد',
  heroSubtitle: 'CoreDentSys نظام متكامل لعيادات الأسنان: حجوزات بالدور أو بالوقت، ملفات مرضى كاملة، مخطط أسنان تفاعلي، أشعة، روشتات، وحسابات وتقفيل يومي — بالعربي والإنجليزي، ومن أي جهاز.',
  trialButtonLabel: 'ابدأ تجربتك المجانية — 7 أيام',
  pricingButtonLabel: 'شوف الأسعار',
  heroPoint1: 'بدون تحميل برامج',
  heroPoint2: 'بيانات كل عيادة منفصلة ومشفّرة',
  heroPoint3: 'دعم مباشر على واتساب',
  heroImageCaption: 'سجل مواعيد حقيقي، مش صورة تصميم',
  chartImageCaption: 'خريطة الفم من جوه النظام — كل سن ليها إجراءاتها وسعرها',
  financeImageCaption: 'تقفيل اليوم والوردية — من شاشة الإقفال نفسها',
  offlineNote: 'العيادة ما بتقفش لما النت يقف. حجوزات وملفات وحسابات شغالة، والمزامنة بتحصل لوحدها أول ما الاتصال يرجع.',
  planPopularTag: 'الأكثر اختياراً',
  painsKicker: 'قبل أي كلام عن مميزات',
  painsTitle: 'عارف الإحساس ده؟',
  painsResolve: 'كل يوم من غير نظام فيه واحدة من دول على الأقل.',
  painsResolveStrong: 'ودي بالظبط الحاجات اللي اتبنى عليها CoreDentSys.',
  painsNote: '— مش شعارات، دي شغلانة كل يوم.',
  featuresKicker: 'المميزات',
  featuresTitle: 'كل اللي عيادتك محتاجاه',
  featuresSubtitle: 'من أول ما المريض يدخل لحد ما يدفع ويتابع، النظام مغطي كل خطوة في يومك.',
  stepsKicker: 'إزاي تبدأ',
  stepsTitle: 'تلات خطوات وتشتغل',
  pricingKicker: 'الأسعار',
  pricingTitle: 'باقة على مقاس عيادتك',
  pricingSubtitle: 'ابدأ بتجربة مجانية 7 أيام، وبعدها اختار الباقة اللي تناسبك. مفيش عقود ولا التزام.',
  ctaTitle: 'جاهز تنظّم عيادتك؟',
  ctaSubtitle: 'جرّب CoreDentSys مجاناً 7 أيام — ولو عندك حساب بالفعل، سجّل دخولك من هنا.',
  ctaTrialLabel: 'اطلب التجربة المجانية',
  ctaLoginLabel: 'تسجيل الدخول',
  footerCommunityLabel: 'مجتمع أطباء الأسنان على واتساب',
  footerFacebookLabel: 'الصفحة الرسمية على فيسبوك',
  footerFaqLabel: 'الأسئلة الشائعة',
  footerCopyright: 'نظام مشفّر وآمن • CoreDentSys © 2026 — كل الحقوق محفوظة',
  trialWhatsappPrefill: 'أهلاً، حابب أجرب CoreDentSys لعيادتي — التجربة المجانية 7 أيام'
};

export const DEFAULT_LANDING_TEXTS_EN: LandingTexts = {
  brandName: 'CoreDentSys',
  navFeatures: 'Features',
  navHow: 'How it works',
  navPricing: 'Pricing',
  navContact: 'Contact us',
  loginLabel: 'Log in',
  heroBadge: 'Works fully offline — even with no internet',
  heroTitleA: 'Run your entire clinic',
  heroTitleB: 'from one place',
  heroSubtitle: 'CoreDentSys is a complete system for dental clinics: queue or time-based booking, full patient files, an interactive dental chart, x-rays, prescriptions, and daily closing — in Arabic and English, on any device.',
  trialButtonLabel: 'Start your free 7-day trial',
  pricingButtonLabel: 'See pricing',
  heroPoint1: 'No software to install',
  heroPoint2: 'Every clinic\u2019s data is separate & encrypted',
  heroPoint3: 'Direct WhatsApp support',
  heroImageCaption: 'a real booking screen, not a mockup',
  chartImageCaption: 'the mouth chart from inside the app: every tooth has its procedures and its price',
  financeImageCaption: 'daily and shift closing, from the actual screen',
  offlineNote: 'The clinic does not stop when the internet does. Bookings, files and accounts keep working, and syncing happens on its own once the connection returns.',
  planPopularTag: 'Most chosen',
  painsKicker: 'Before any talk of features',
  painsTitle: 'You know the feeling?',
  painsResolve: 'Every day without a system has at least one of these in it.',
  painsResolveStrong: 'These are exactly the things CoreDentSys was built to take off your plate.',
  painsNote: 'Not slogans. Just the daily reality.',
  featuresKicker: 'Features',
  featuresTitle: 'Everything your clinic needs',
  featuresSubtitle: 'From the moment a patient walks in until they pay and follow up, the system covers every step of your day.',
  stepsKicker: 'Getting started',
  stepsTitle: 'Three steps and you\u2019re running',
  pricingKicker: 'Pricing',
  pricingTitle: 'A plan that fits your clinic',
  pricingSubtitle: 'Start with a free 7-day trial, then pick the plan that suits you. No contracts, no commitment.',
  ctaTitle: 'Ready to organize your clinic?',
  ctaSubtitle: 'Try CoreDentSys free for 7 days — or log in if you already have an account.',
  ctaTrialLabel: 'Request the free trial',
  ctaLoginLabel: 'Log in',
  footerCommunityLabel: 'Dentists community on WhatsApp',
  footerFacebookLabel: 'Official Facebook page',
  footerFaqLabel: 'FAQ',
  footerCopyright: 'Encrypted & secured system • CoreDentSys © 2026 — All rights reserved',
  trialWhatsappPrefill: 'Hello, I would like to try CoreDentSys for my clinic — the free 7-day trial'
};

export const DEFAULT_LANDING_CONTENT: LandingSiteContent = {
  ar: DEFAULT_LANDING_TEXTS_AR,
  en: DEFAULT_LANDING_TEXTS_EN,
  logoUrl: '',
  faviconUrl: '',
  heroImageUrl: '/landing/appointments.jpg',
  chartImageUrl: '/landing/chart.jpg',
  financeImageUrl: '/landing/finance.jpg',
  whatsappNumber: '',
  whatsappCommunityUrl: '',
  facebookUrl: '',
  features: [
    { id: 'f1', icon: 'calendar', ar: { title: 'حجوزات بالدور أو بالوقت', desc: 'نظام أدوار ذكي أو مواعيد مظبوطة بالساعة — حسب طريقة شغل عيادتك.' }, en: { title: 'Queue or timed booking', desc: 'A smart queue system or precise time slots — whatever fits your clinic.' } },
    { id: 'f2', icon: 'tooth', ar: { title: 'مخطط أسنان تفاعلي', desc: 'Chart كامل لكل سن بكل أنظمة الترقيم، إجراءات وأسعار لكل سن على حدة.' }, en: { title: 'Interactive dental chart', desc: 'A full chart for every tooth in all numbering systems, with per-tooth procedures and prices.' } },
    { id: 'f3', icon: 'image', ar: { title: 'رفع الأشعة والملفات', desc: 'ارفع أشعة المريض وصوره في ملفه وارجع لها في أي زيارة.' }, en: { title: 'X-ray & file uploads', desc: 'Upload patient x-rays and photos to their file and revisit them any time.' } },
    { id: 'f4', icon: 'chat', ar: { title: 'تذكير واتساب', desc: 'فكر مرضاك بمواعيدهم برسالة واتساب جاهزة بضغطة واحدة.' }, en: { title: 'WhatsApp reminders', desc: 'Remind patients about appointments with a ready WhatsApp message in one tap.' } },
    { id: 'f5', icon: 'pill', ar: { title: 'روشتات في ثواني', desc: 'مكتبة أدوية جاهزة وروشتة بتتطبع أو تتبعت على طول.' }, en: { title: 'Prescriptions in seconds', desc: 'A ready drug library and prescriptions that print or send instantly.' } },
    { id: 'f6', icon: 'wallet', ar: { title: 'حسابات وتقفيل يومي', desc: 'إيرادات ومصاريف وأقساط متأخرة وتقارير — وتقفيل اليوم بضغطة.' }, en: { title: 'Finance & daily closing', desc: 'Revenue, expenses, late installments and reports — close the day in one tap.' } },
    { id: 'f7', icon: 'offline', ar: { title: 'يعمل أوفلاين', desc: 'النت قطع؟ كمّل شغل عادي، وأول ما يرجع النظام بيزامن كل حاجة.' }, en: { title: 'Works offline', desc: 'Internet down? Keep working — everything syncs when it comes back.' } },
    { id: 'f8', icon: 'buildings', ar: { title: 'عيادات وفروع متعددة', desc: 'كل عيادة بحسابها وداتا منفصلة، وإدارة كاملة من حساب المشرف.' }, en: { title: 'Multi-clinic & branches', desc: 'Each clinic has its own account and separate data, managed from one super admin account.' } }
  ],
  stats: [
    { id: 's1', ar: { value: '100%', label: 'يشتغل حتى لو النت قطع' }, en: { value: '100%', label: 'Works even when the internet drops' } },
    { id: 's2', ar: { value: 'عربي + English', label: 'واجهة كاملة باللغتين RTL' }, en: { value: 'Arabic + English', label: 'Full RTL & LTR interface' } },
    { id: 's3', ar: { value: 'مشفّرة', label: 'بيانات كل عيادة منفصلة وآمنة' }, en: { value: 'Encrypted', label: 'Every clinic\u2019s data is separate & safe' } },
    { id: 's4', ar: { value: 'أي جهاز', label: 'موبايل وتابليت وكمبيوتر' }, en: { value: 'Any device', label: 'Phone, tablet and computer' } }
  ],
  pains: [
    { id: 'pn1', ar: { text: 'الدفتر اتلخبط، واتنين مرضى محجوزين في نفس المعاد.' }, en: { text: 'The book is a mess, and two patients are booked into the same slot.' } },
    { id: 'pn2', ar: { text: 'آخر اليوم، وانت لسه بتجمع حسابات الوردية على الآلة الحاسبة.' }, en: { text: 'End of the day, and you are still adding up the shift on a calculator.' } },
    { id: 'pn3', ar: { text: 'مريض بيتصل يسأل على معاده… ومحدش في العيادة فاكره.' }, en: { text: 'A patient calls to ask about their appointment… and nobody in the clinic remembers it.' } }
  ],
  steps: [
    { id: 'st1', ar: { title: 'اطلب تجربتك المجانية', desc: 'كلّمنا على واتساب وهنجهزلك حساب تجريبي لعيادتك في دقايق — 7 أيام مجاناً.' }, en: { title: 'Request your free trial', desc: 'Message us on WhatsApp and we\u2019ll set up a trial account for your clinic in minutes — free for 7 days.' } },
    { id: 'st2', ar: { title: 'سجّل مرضاك ومواعيدك', desc: 'واجهة عربية بسيطة، الموظفة هتعرف تشتغل عليها من أول يوم من غير تدريب.' }, en: { title: 'Add patients & appointments', desc: 'A simple interface your receptionist will use from day one, no training needed.' } },
    { id: 'st3', ar: { title: 'تابع عيادتك من أي مكان', desc: 'من الموبايل أو الكمبيوتر: مواعيد النهاردة، إيراد اليوم، وتقاريرك — كلها قدامك.' }, en: { title: 'Follow your clinic anywhere', desc: 'From phone or computer: today\u2019s appointments, daily revenue and reports — all in front of you.' } }
  ],
  plans: [
    {
      id: 'p1', price: '199', popular: false,
      ar: { name: 'الأساسية', desc: 'للعيادة الصغيرة اللي بتبدأ تنظّم شغلها', period: 'ج.م / شهرياً', features: ['حجوزات وملفات مرضى كاملة', 'مخطط الأسنان التفاعلي', 'روشتات وتذكير واتساب', 'مستخدم واحد + مساعد'], buttonLabel: 'ابدأ التجربة المجانية' },
      en: { name: 'Basic', desc: 'For a small clinic getting organized', period: 'EGP / month', features: ['Full booking & patient files', 'Interactive dental chart', 'Prescriptions & WhatsApp reminders', 'One user + assistant'], buttonLabel: 'Start the free trial' }
    },
    {
      id: 'p2', price: '349', popular: true,
      ar: { name: 'الاحترافية', desc: 'للعيادة الشغالة اللي محتاجة كل الأدوات', period: 'ج.م / شهرياً', features: ['كل مميزات الباقة الأساسية', 'رفع الأشعة والملفات بدون حدود', 'حسابات وتقفيل يومي وتقارير', 'يعمل أوفلاين بالكامل', 'مخازن، معامل، ونقاط ولاء'], buttonLabel: 'ابدأ التجربة المجانية' },
      en: { name: 'Professional', desc: 'For a busy clinic that needs every tool', period: 'EGP / month', features: ['Everything in Basic', 'Unlimited x-ray & file uploads', 'Finance, daily closing & reports', 'Fully offline capable', 'Inventory, labs & loyalty points'], buttonLabel: 'Start the free trial' }
    },
    {
      id: 'p3', price: '599', popular: false,
      ar: { name: 'المجموعات والفروع', desc: 'لسلاسل العيادات وأكتر من فرع', period: 'ج.م / شهرياً', features: ['كل مميزات الباقة الاحترافية', 'فروع متعددة بحساب مشرف واحد', 'شيفتات ومتابعة موظفين', 'دعم أولوية وتدريب للفريق'], buttonLabel: 'كلمنا على واتساب' },
      en: { name: 'Groups & branches', desc: 'For clinic chains and multiple branches', period: 'EGP / month', features: ['Everything in Professional', 'Multiple branches under one admin', 'Shifts & staff tracking', 'Priority support & team training'], buttonLabel: 'Message us on WhatsApp' }
    }
  ]
};

// Merge a stored document over the defaults so old saved content keeps working
// as new fields are added later.
// Only http(s) links and same-site paths may come from editable content;
// javascript:, data: and similar schemes are dropped.
export function safeLandingUrl(u: any): string {
  const v = String(u ?? '').trim();
  if (!v) return '';
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  return /^https?:\/\//i.test(v) ? v : '';
}

export function mergeLandingContent(stored: any): LandingSiteContent {
  const base = JSON.parse(JSON.stringify(DEFAULT_LANDING_CONTENT)) as LandingSiteContent;
  if (!stored || typeof stored !== 'object') return base;
  const out: any = { ...base, ...stored };
  out.ar = { ...base.ar, ...(stored.ar || {}) };
  out.en = { ...base.en, ...(stored.en || {}) };
  const mergeList = (defList: any[], savedList: any[]) => {
    if (!Array.isArray(savedList)) return defList;
    return savedList.map((item: any, i: number) => {
      const def = defList.find((d: any) => d.id === item?.id) || defList[i] || {};
      return {
        ...def, ...item,
        ar: { ...(def.ar || {}), ...(item?.ar || {}) },
        en: { ...(def.en || {}), ...(item?.en || {}) }
      };
    });
  };
  for (const k of ['faviconUrl', 'logoUrl', 'heroImageUrl', 'chartImageUrl', 'financeImageUrl', 'whatsappCommunityUrl', 'facebookUrl']) {
    if (k in out) out[k] = safeLandingUrl(out[k]);
  }
  out.features = mergeList(base.features, stored.features);
  out.stats = mergeList(base.stats, stored.stats);
  out.steps = mergeList(base.steps, stored.steps);
  out.plans = mergeList(base.plans, stored.plans);
  out.pains = mergeList(base.pains, stored.pains);
  return out as LandingSiteContent;
}
