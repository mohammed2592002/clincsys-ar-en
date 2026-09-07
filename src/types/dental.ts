export interface Clinic {
  id: string;
  name: string;
  ownerEmail: string;
  isActive: boolean;
  plan: 'Pro Plan' | 'Enterprise Plan' | 'Starter Plan';
  clinicCode: string;
  phone?: string;
  address?: string;
  createdAt: string;
  renewDays?: number;
}

export interface Patient {
  id: string;
  name: string;
  phone: string;
  whatsappNumber?: string;
  gender?: string;
  age: number;
  address?: string;
  area?: string;
  occupation?: string;
  questionnaire?: Record<string, any>;
  medicalHistory: string[]; // e.g. ["سكري", "ضغط دمي", "حساسية بنسيلين"]
  notes: string;
  toothNotes?: Record<number, string>; // tooth number -> issue description
  lastVisit?: string;
  totalSpent?: number;
  createdAt: string;
}

export type AppointmentStatus = 'Scheduled' | 'Waiting' | 'Checked-in' | 'Completed' | 'Cancelled';

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  procedure: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm (e.g., "09:30 AM")
  status: AppointmentStatus;
  doctorName?: string;
  notes?: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  minAlertQuantity: number;
  unit: string;
  lastUpdated: string;
}

export type InvoiceStatus = 'Paid' | 'Pending' | 'Partial';

export interface InvoiceItem {
  description: string;
  amount: number;
}

export interface Invoice {
  id: string;
  patientId: string;
  patientName: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatus;
  items: InvoiceItem[];
  date: string;
  createdAt: string;
}

export interface DailyClosing {
  id: string;
  date: string; // YYYY-MM-DD
  closedAt: string; // ISO String
  totalInvoiced: number;
  totalCollected: number;
  totalOutstanding: number;
  cashOnHand: number;
  difference: number;
  notes: string;
  closedBy: string;
}

export type UserRole = 'Administrator' | 'Dentist' | 'Receptionist' | 'PlatformOwner';

export interface ClinicUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  clinicId: string;
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


