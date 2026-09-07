export type Language = 'ar' | 'en';

export interface Patient {
  id: string;
  fileNumber: string;
  fullName: string;
  fullNameAr: string;
  gender: 'male' | 'female';
  age: number;
  dob: string;
  phone: string;
  email: string;
  bloodType: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  allergies: string[];
  chronicConditions: string[];
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  nationalId: string;
  address: string;
  registeredDate: string;
  notes?: string;
  avatarUrl?: string;
}

export interface Doctor {
  id: string;
  name: string;
  nameAr: string;
  title: string;
  specialty: string;
  specialtyAr: string;
  department: string;
  phone: string;
  email: string;
  consultationFee: number;
  availableDays: string[];
  workingHours: string;
  avatarUrl: string;
  isAvailable: boolean;
}

export type AppointmentStatus = 'Scheduled' | 'Waiting' | 'In Progress' | 'Completed' | 'Cancelled';

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  date: string;
  time: string;
  type: 'Consultation' | 'Follow-up' | 'Emergency' | 'Procedure' | 'Lab Check';
  status: AppointmentStatus;
  queueNumber: number;
  symptoms: string;
  notes?: string;
}

export interface PrescriptionItem {
  id: string;
  drugName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  dispensed?: boolean;
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  appointmentId?: string;
  date: string;
  vitals: {
    bloodPressure: string;
    heartRate: number;
    temperature: number;
    spo2: number;
    weight: number;
    height: number;
  };
  chiefComplaint: string;
  diagnosis: string;
  icdCode?: string;
  clinicalNotes: string;
  prescriptions: PrescriptionItem[];
  labOrders: string[];
  followUpDate?: string;
}

export interface DrugItem {
  id: string;
  drugName: string;
  genericName: string;
  category: string;
  dosageForm: 'Tablet' | 'Syrup' | 'Injection' | 'Capsule' | 'Ointment' | 'Drops';
  strength: string;
  stockQuantity: number;
  minStockLevel: number;
  unitPrice: number;
  expiryDate: string;
  location: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  doctorId?: string;
  doctorName?: string;
  date: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  status: 'Paid' | 'Pending' | 'Partially Paid';
  paymentMethod: 'Cash' | 'Card' | 'Insurance' | 'Bank Transfer';
  insuranceProvider?: string;
  notes?: string;
}

export interface LabTest {
  id: string;
  testName: string;
  testNameAr: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  orderDate: string;
  status: 'Pending' | 'In Analysis' | 'Completed';
  category: string;
  results?: {
    parameter: string;
    value: string;
    unit: string;
    referenceRange: string;
    isAbnormal: boolean;
  }[];
  labNotes?: string;
}
