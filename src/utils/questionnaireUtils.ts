import { QuestionnaireQuestion } from '../types';

export function translateQuestionText(text: string, isEn: boolean): string {
  if (!isEn || !text) return text;
  if (text.includes('الدرقية')) return 'Do you suffer from hypothyroidism or hyperthyroidism?';
  if (text.includes('السكر')) return 'Do you have Diabetes?';
  if (text.includes('القلب') || text.includes('الضغط') || text.includes('السيولة')) {
    return 'Any cardiovascular issues, blood pressure or blood thinners?';
  }
  if (text.includes('أخرى') || (text.includes('مزمنة') && text.includes('أمراض'))) {
    return 'Do you suffer from any other chronic diseases?';
  }
  if (text.includes('حساسية')) return 'Do you have any drug or medication allergies?';
  if (text.includes('أدوية')) return 'Do you take any medications regularly?';
  if (text.includes('حمل') || text.includes('رضاعة')) return 'Is there pregnancy or breastfeeding?';
  if (text.includes('كبد') || text.includes('كلى')) return 'Any liver or kidney conditions?';
  return text;
}

export function translateQuestionCategory(cat?: string, isEn: boolean = false): string {
  if (!cat || !isEn) return cat || '';
  if (cat.includes('الدرقية')) return 'Thyroid';
  if (cat.includes('مزمنة')) return 'Chronic Disease';
  if (cat.includes('القلب') || cat.includes('الضغط')) return 'Cardiovascular & BP';
  if (cat.includes('حساسية')) return 'Allergies & Meds';
  if (cat.includes('أدوية')) return 'Medications';
  if (cat.includes('حرج') || cat.includes('تنبيه')) return 'Critical Alert';
  if (cat.includes('نساء') || cat.includes('المرأة')) return "Women's Health";
  return cat;
}

export function translateQuestionPlaceholder(
  placeholder?: string,
  questionText?: string,
  isEn: boolean = false
): string {
  if (!isEn) return placeholder || 'اكتب التفاصيل (اختياري)...';
  
  if (placeholder) {
    if (placeholder.includes('الدرقية') || placeholder.includes('خمول')) {
      return 'Enter thyroid details (hypo / hyper / medications)...';
    }
    if (placeholder.includes('السكر') || placeholder.includes('تراكمي')) {
      return 'Enter diabetes details (Type 1 / Type 2 / HbA1c)...';
    }
    if (placeholder.includes('القلب') || placeholder.includes('دعامات') || placeholder.includes('سيولة')) {
      return 'Enter heart/BP details (hypertension / stents / blood thinners)...';
    }
    if (placeholder.includes('مزمن') || placeholder.includes('ربو') || placeholder.includes('كبد')) {
      return 'Enter chronic condition details (asthma / liver / kidney / pregnancy)...';
    }
    if (placeholder.includes('حساسية') || placeholder.includes('بنسيلين') || placeholder.includes('مخدر')) {
      return 'Enter allergy details (penicillin / aspirin / local anesthesia)...';
    }
  }

  if (questionText) {
    if (questionText.includes('الدرقية')) return 'Enter thyroid details (hypo / hyper / medications)...';
    if (questionText.includes('السكر')) return 'Enter diabetes details (Type 1 / Type 2 / HbA1c)...';
    if (questionText.includes('القلب') || questionText.includes('الضغط')) return 'Enter heart & BP details...';
    if (questionText.includes('حساسية')) return 'Enter allergy details (penicillin / aspirin / anesthesia)...';
    if (questionText.includes('مزمنة') || questionText.includes('أخرى')) return 'Enter condition details...';
  }

  return 'Enter details and medical notes (optional)...';
}
