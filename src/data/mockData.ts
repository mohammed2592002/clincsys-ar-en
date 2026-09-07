import { Patient, Doctor, Appointment, MedicalRecord, DrugItem, Invoice, LabTest } from '../types/clinic';

export const INITIAL_DOCTORS: Doctor[] = [
  {
    id: 'DOC-101',
    name: 'Dr. Ahmed El-Sayed',
    nameAr: 'د. أحمد السيد',
    title: 'Consultant Cardiologist',
    specialty: 'Cardiology',
    specialtyAr: 'أمراض القلب والأوعية الدموية',
    department: 'Cardiology Dept',
    phone: '+20 100 123 4567',
    email: 'ahmed.elsayed@clinic.com',
    consultationFee: 400,
    availableDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'],
    workingHours: '09:00 AM - 05:00 PM',
    avatarUrl: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=300&auto=format&fit=crop&q=80',
    isAvailable: true,
  },
  {
    id: 'DOC-102',
    name: 'Dr. Sarah Mahmoud',
    nameAr: 'د. سارة محمود',
    title: 'Senior Pediatrician',
    specialty: 'Pediatrics',
    specialtyAr: 'طب الأطفال والحديثي الولادة',
    department: 'Pediatric Dept',
    phone: '+20 101 987 6543',
    email: 'sarah.mahmoud@clinic.com',
    consultationFee: 350,
    availableDays: ['Sun', 'Mon', 'Wed', 'Thu'],
    workingHours: '10:00 AM - 06:00 PM',
    avatarUrl: 'https://images.unsplash.com/photo-1594824813571-24a69d100c31?w=300&auto=format&fit=crop&q=80',
    isAvailable: true,
  },
  {
    id: 'DOC-103',
    name: 'Dr. Mohamed Hassan',
    nameAr: 'د. محمد حسن',
    title: 'Orthopedic Surgeon',
    specialty: 'Orthopedics',
    specialtyAr: 'جراحة العظام والمفاصل',
    department: 'Surgical Dept',
    phone: '+20 102 333 4455',
    email: 'mohamed.hassan@clinic.com',
    consultationFee: 450,
    availableDays: ['Sat', 'Mon', 'Tue', 'Thu'],
    workingHours: '11:00 AM - 07:00 PM',
    avatarUrl: 'https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=300&auto=format&fit=crop&q=80',
    isAvailable: true,
  },
  {
    id: 'DOC-104',
    name: 'Dr. Nour Ibrahim',
    nameAr: 'د. نور إبراهيم',
    title: 'General Practitioner & Internal Med',
    specialty: 'Internal Medicine',
    specialtyAr: 'الباطنة العامة والتخصصية',
    department: 'General Clinic',
    phone: '+20 105 666 7788',
    email: 'nour.ibrahim@clinic.com',
    consultationFee: 300,
    availableDays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Sat'],
    workingHours: '08:30 AM - 04:30 PM',
    avatarUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=300&auto=format&fit=crop&q=80',
    isAvailable: true,
  }
];

export const INITIAL_PATIENTS: Patient[] = [
  {
    id: 'PAT-1001',
    fileNumber: 'CL-2026-001',
    fullName: 'Youssef Ali Mansour',
    fullNameAr: 'يوسف علي منصور',
    gender: 'male',
    age: 42,
    dob: '1984-03-15',
    phone: '+20 111 222 3344',
    email: 'youssef.ali@gmail.com',
    bloodType: 'O+',
    allergies: ['Penicillin', 'Sulfa drugs'],
    chronicConditions: ['Hypertension', 'Type 2 Diabetes'],
    emergencyContact: {
      name: 'Mona Mansour (Wife)',
      relationship: 'Spouse',
      phone: '+20 111 222 3345',
    },
    nationalId: '28403150102938',
    address: 'Nasr City, Building 14, Cairo',
    registeredDate: '2025-11-10',
    notes: 'Requires blood pressure check every visit. Prefers morning appointments.',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80'
  },
  {
    id: 'PAT-1002',
    fileNumber: 'CL-2026-002',
    fullName: 'Amina Khaled Rizk',
    fullNameAr: 'أمينة خالد رزق',
    gender: 'female',
    age: 29,
    dob: '1997-08-22',
    phone: '+20 122 333 4455',
    email: 'amina.rizk@yahoo.com',
    bloodType: 'A+',
    allergies: ['Dust', 'NSAIDs'],
    chronicConditions: ['Asthma'],
    emergencyContact: {
      name: 'Khaled Rizk (Father)',
      relationship: 'Father',
      phone: '+20 122 333 4400',
    },
    nationalId: '29708220104455',
    address: 'Maadi, Road 9, Cairo',
    registeredDate: '2026-01-05',
    notes: 'Regular checkup for asthma inhaler dosage adjustment.',
    avatarUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80'
  },
  {
    id: 'PAT-1003',
    fileNumber: 'CL-2026-003',
    fullName: 'Omar Tarek Hamdy',
    fullNameAr: 'عمر طارق حمدي',
    gender: 'male',
    age: 8,
    dob: '2018-12-04',
    phone: '+20 100 555 6677',
    email: 'tarek.hamdy@gmail.com',
    bloodType: 'B+',
    allergies: ['Peanuts'],
    chronicConditions: [],
    emergencyContact: {
      name: 'Tarek Hamdy (Father)',
      relationship: 'Father',
      phone: '+20 100 555 6677',
    },
    nationalId: '31812040108899',
    address: 'Heliopolis, Korba, Cairo',
    registeredDate: '2026-02-14',
    notes: 'Pediatric checkup and vaccination follow-up.',
    avatarUrl: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=150&auto=format&fit=crop&q=80'
  },
  {
    id: 'PAT-1004',
    fileNumber: 'CL-2026-004',
    fullName: 'Fatma Hassan Abdelrahman',
    fullNameAr: 'فاطمة حسن عبد الرحمن',
    gender: 'female',
    age: 56,
    dob: '1970-05-19',
    phone: '+20 114 777 8899',
    email: 'fatma.hassan@gmail.com',
    bloodType: 'AB-',
    allergies: [],
    chronicConditions: ['Osteoarthritis', 'Hyperlipidemia'],
    emergencyContact: {
      name: 'Hassan Abdelrahman (Son)',
      relationship: 'Son',
      phone: '+20 114 777 8800',
    },
    nationalId: '27005190103322',
    address: 'Dokki, Giza',
    registeredDate: '2026-03-01',
    notes: 'Knee joint pain follow-up with orthopedic department.',
    avatarUrl: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80'
  }
];

export const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: 'APT-501',
    patientId: 'PAT-1001',
    patientName: 'Youssef Ali Mansour (يوسف علي)',
    patientPhone: '+20 111 222 3344',
    doctorId: 'DOC-101',
    doctorName: 'Dr. Ahmed El-Sayed',
    specialty: 'Cardiology',
    date: '2026-07-22',
    time: '09:30 AM',
    type: 'Consultation',
    status: 'In Progress',
    queueNumber: 1,
    symptoms: 'Mild chest discomfort during exercise, elevated BP 145/90',
    notes: 'Routine cardiac checkup & ECG review'
  },
  {
    id: 'APT-502',
    patientId: 'PAT-1002',
    patientName: 'Amina Khaled Rizk (أمينة خالد)',
    patientPhone: '+20 122 333 4455',
    doctorId: 'DOC-104',
    doctorName: 'Dr. Nour Ibrahim',
    specialty: 'Internal Medicine',
    date: '2026-07-22',
    time: '10:15 AM',
    type: 'Follow-up',
    status: 'Waiting',
    queueNumber: 2,
    symptoms: 'Shortness of breath, seasonal wheezing',
    notes: 'Check respiratory sounds & refill asthma medication'
  },
  {
    id: 'APT-503',
    patientId: 'PAT-1003',
    patientName: 'Omar Tarek Hamdy (عمر طارق)',
    patientPhone: '+20 100 555 6677',
    doctorId: 'DOC-102',
    doctorName: 'Dr. Sarah Mahmoud',
    specialty: 'Pediatrics',
    date: '2026-07-22',
    time: '11:00 AM',
    type: 'Consultation',
    status: 'Scheduled',
    queueNumber: 3,
    symptoms: 'Fever 38.5C, sore throat, loss of appetite',
    notes: 'Pediatric examination'
  },
  {
    id: 'APT-504',
    patientId: 'PAT-1004',
    patientName: 'Fatma Hassan Abdelrahman (فاطمة حسن)',
    patientPhone: '+20 114 777 8899',
    doctorId: 'DOC-103',
    doctorName: 'Dr. Mohamed Hassan',
    specialty: 'Orthopedics',
    date: '2026-07-22',
    time: '12:00 PM',
    type: 'Procedure',
    status: 'Scheduled',
    queueNumber: 4,
    symptoms: 'Right knee swelling and severe joint stiffness',
    notes: 'Hyaluronic acid injection or X-Ray review'
  }
];

export const INITIAL_MEDICAL_RECORDS: MedicalRecord[] = [
  {
    id: 'REC-901',
    patientId: 'PAT-1001',
    doctorId: 'DOC-101',
    doctorName: 'Dr. Ahmed El-Sayed',
    appointmentId: 'APT-501',
    date: '2026-07-22',
    vitals: {
      bloodPressure: '142/88',
      heartRate: 78,
      temperature: 36.8,
      spo2: 98,
      weight: 84,
      height: 176,
    },
    chiefComplaint: 'Patient reports occasional pressure feeling in chest after climbing stairs.',
    diagnosis: 'Essential Hypertension & Mild Exertional Angina Risk',
    icdCode: 'I10 / I20.9',
    clinicalNotes: 'ECG shows normal sinus rhythm with mild ST-T strain. Recommended lipid panel and daily home BP recording log.',
    prescriptions: [
      {
        id: 'PR-1',
        drugName: 'Amlodipine (Norvasc)',
        dosage: '5 mg',
        frequency: 'Once daily in the morning',
        duration: '30 days',
        instructions: 'Take after breakfast with water.',
        dispensed: true
      },
      {
        id: 'PR-2',
        drugName: 'Aspirin Protect',
        dosage: '100 mg',
        frequency: 'Once daily',
        duration: '30 days',
        instructions: 'Take with main meal.',
        dispensed: true
      }
    ],
    labOrders: ['Lipid Profile', 'ECG 12-Lead', 'Serum Creatinine'],
    followUpDate: '2026-08-22'
  }
];

export const INITIAL_DRUGS: DrugItem[] = [
  {
    id: 'DRG-01',
    drugName: 'Amlodipine (Norvasc)',
    genericName: 'Amlodipine Besylate',
    category: 'Antihypertensive',
    dosageForm: 'Tablet',
    strength: '5 mg',
    stockQuantity: 120,
    minStockLevel: 20,
    unitPrice: 45.0,
    expiryDate: '2027-11-30',
    location: 'Shelf A-3'
  },
  {
    id: 'DRG-02',
    drugName: 'Panadol Extra',
    genericName: 'Paracetamol + Caffeine',
    category: 'Analgesic & Antipyretic',
    dosageForm: 'Tablet',
    strength: '500mg/65mg',
    stockQuantity: 350,
    minStockLevel: 50,
    unitPrice: 25.0,
    expiryDate: '2028-04-15',
    location: 'Shelf B-1'
  },
  {
    id: 'DRG-03',
    drugName: 'Augmentin',
    genericName: 'Amoxicillin + Clavulanate',
    category: 'Antibiotic',
    dosageForm: 'Tablet',
    strength: '1 g',
    stockQuantity: 14,
    minStockLevel: 25, // Low stock indicator!
    unitPrice: 110.0,
    expiryDate: '2026-12-10',
    location: 'Fridge / Shelf C-2'
  },
  {
    id: 'DRG-04',
    drugName: 'Ventolin Inhaler',
    genericName: 'Salbutamol Sulfate',
    category: 'Bronchodilator',
    dosageForm: 'Ointment', // Inhaler form
    strength: '100 mcg/dose',
    stockQuantity: 45,
    minStockLevel: 10,
    unitPrice: 65.0,
    expiryDate: '2027-09-01',
    location: 'Shelf D-4'
  },
  {
    id: 'DRG-05',
    drugName: 'Cataflam',
    genericName: 'Diclofenac Potassium',
    category: 'NSAID / Anti-inflammatory',
    dosageForm: 'Tablet',
    strength: '50 mg',
    stockQuantity: 85,
    minStockLevel: 15,
    unitPrice: 38.0,
    expiryDate: '2027-06-20',
    location: 'Shelf B-3'
  }
];

export const INITIAL_INVOICES: Invoice[] = [
  {
    id: 'INV-2026-001',
    invoiceNumber: 'INV-2026-001',
    patientId: 'PAT-1001',
    patientName: 'Youssef Ali Mansour',
    doctorId: 'DOC-101',
    doctorName: 'Dr. Ahmed El-Sayed',
    date: '2026-07-22',
    items: [
      { id: '1', description: 'Cardiology Specialist Consultation Fee', quantity: 1, unitPrice: 400, total: 400 },
      { id: '2', description: 'Resting 12-Lead Electrocardiogram (ECG)', quantity: 1, unitPrice: 250, total: 250 },
      { id: '3', description: 'Amlodipine 5mg (30 Tablets)', quantity: 1, unitPrice: 45, total: 45 }
    ],
    subtotal: 695,
    discount: 45,
    tax: 0,
    grandTotal: 650,
    status: 'Paid',
    paymentMethod: 'Card',
    insuranceProvider: 'Bupa Arabia / MetLife',
    notes: 'Direct co-pay collected.'
  },
  {
    id: 'INV-2026-002',
    invoiceNumber: 'INV-2026-002',
    patientId: 'PAT-1002',
    patientName: 'Amina Khaled Rizk',
    doctorId: 'DOC-104',
    doctorName: 'Dr. Nour Ibrahim',
    date: '2026-07-22',
    items: [
      { id: '1', description: 'Internal Medicine Follow-up Consultation', quantity: 1, unitPrice: 300, total: 300 }
    ],
    subtotal: 300,
    discount: 0,
    tax: 0,
    grandTotal: 300,
    status: 'Pending',
    paymentMethod: 'Cash',
    notes: 'Awaiting doctor finish consultation.'
  }
];

export const INITIAL_LABS: LabTest[] = [
  {
    id: 'LAB-801',
    testName: 'Lipid Profile & Cholesterol Panel',
    testNameAr: 'فحص الدهون الكامل والكوليسترول',
    patientId: 'PAT-1001',
    patientName: 'Youssef Ali Mansour',
    doctorId: 'DOC-101',
    doctorName: 'Dr. Ahmed El-Sayed',
    orderDate: '2026-07-22',
    status: 'Completed',
    category: 'Clinical Chemistry',
    results: [
      { parameter: 'Total Cholesterol', value: '225', unit: 'mg/dL', referenceRange: '< 200', isAbnormal: true },
      { parameter: 'Triglycerides', value: '180', unit: 'mg/dL', referenceRange: '< 150', isAbnormal: true },
      { parameter: 'HDL (Good)', value: '42', unit: 'mg/dL', referenceRange: '> 40', isAbnormal: false },
      { parameter: 'LDL (Bad)', value: '147', unit: 'mg/dL', referenceRange: '< 100', isAbnormal: true }
    ],
    labNotes: 'Mild dyslipidemia observed. Dietary advice and follow up recommended.'
  },
  {
    id: 'LAB-802',
    testName: 'Complete Blood Count (CBC)',
    testNameAr: 'صورة دم كاملة (CBC)',
    patientId: 'PAT-1003',
    patientName: 'Omar Tarek Hamdy',
    doctorId: 'DOC-102',
    doctorName: 'Dr. Sarah Mahmoud',
    orderDate: '2026-07-22',
    status: 'In Analysis',
    category: 'Hematology'
  }
];
