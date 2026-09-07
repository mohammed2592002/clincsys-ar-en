import { Clinic, CustomPrescriptionPadConfig, DEFAULT_CUSTOM_PRESCRIPTION_PAD_CONFIG } from '../types';
import { getEffectivePadConfig } from './storage';

interface GeneratePrescriptionHtmlParams {
  clinic: Clinic;
  patientName: string;
  patientAge?: string;
  dateStr?: string;
  medications: Array<{ name: string; dose: string; frequency: string; duration: string }>;
  notes?: string;
  prescriptionStyle?: 'classic' | 'modern' | 'minimal' | 'elegant' | 'custom_pad';
  prescriptionLayout?: 'traditional' | 'table';
  customPrescriptionPadConfig?: CustomPrescriptionPadConfig;
  isEn?: boolean;
}

export function generatePrescriptionHTML({
  clinic,
  patientName,
  patientAge,
  dateStr,
  medications,
  notes,
  prescriptionStyle,
  prescriptionLayout,
  customPrescriptionPadConfig,
  isEn = false
}: GeneratePrescriptionHtmlParams): string {
  const pStyle = prescriptionStyle || clinic.prescriptionStyle || 'classic';
  const pLayout = prescriptionLayout || clinic.prescriptionLayout || 'traditional';
  
  const formatPrescriptionDate = (dInput?: string): string => {
    if (!dInput) {
      const d = new Date();
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    }
    const d = new Date(dInput);
    if (!isNaN(d.getTime())) {
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
    }
    return dInput;
  };

  const formattedDate = formatPrescriptionDate(dateStr);

  // Check if Custom Prescription Pad style is selected
  if (pStyle === 'custom_pad') {
    const padConfig = getEffectivePadConfig(clinic.id, customPrescriptionPadConfig || clinic.customPrescriptionPadConfig);

    const medicationsHtmlList = pLayout === 'table' ? `
      <table style="width: 100%; border-collapse: collapse; text-align: ${isEn ? 'left' : 'right'}; font-size: 0.9em;">
        <thead>
          <tr style="border-bottom: 2px solid #0f172a; color: #0f172a; font-weight: 800;">
            <th style="padding: 4px; text-align: ${isEn ? 'left' : 'right'};">${isEn ? 'Medication' : 'الدواء'}</th>
            <th style="padding: 4px; text-align: center;">${isEn ? 'Dose' : 'الجرعة'}</th>
            <th style="padding: 4px; text-align: center;">${isEn ? 'Frequency & Duration' : 'التكرار والمدة'}</th>
          </tr>
        </thead>
        <tbody>
          ${medications.map(med => `
            <tr style="border-bottom: 1px dashed #cbd5e1;">
              <td style="padding: 6px 4px; font-weight: 800; font-family: 'JetBrains Mono', sans-serif; direction: ltr; text-align: left;">${med.name}</td>
              <td style="padding: 6px 4px; text-align: center;">${med.dose}</td>
              <td style="padding: 6px 4px; text-align: center;">${med.frequency} • ${med.duration}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : `
      <div style="text-align: ${isEn ? 'left' : 'right'}; direction: ${isEn ? 'ltr' : 'rtl'};">
        ${medications.map((med, idx) => `
          <div style="margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px dashed #cbd5e1;">
            <div style="font-size: 1.1em; font-weight: 800; color: #0f172a; font-family: 'JetBrains Mono', sans-serif; direction: ltr; text-align: left;">
              ${idx + 1}. ${med.name}
            </div>
            <div style="font-size: 0.9em; font-weight: 700; color: #334155; margin-top: 3px; ${isEn ? 'padding-left: 8px;' : 'padding-right: 8px;'}">
              ${med.dose} • ${med.frequency} • ${med.duration}
            </div>
          </div>
        `).join('')}
      </div>
    `;

    return `
      <!DOCTYPE html>
      <html lang="${isEn ? 'en' : 'ar'}" dir="${isEn ? 'ltr' : 'rtl'}">
      <head>
        <meta charset="UTF-8">
        <title>${isEn ? 'Medical Prescription' : 'روشتة علاجية'} - ${patientName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
          
          @page {
            size: A4 portrait;
            margin: 0;
          }
          
          body {
            font-family: 'Cairo', sans-serif;
            background-color: #ffffff;
            color: #0f172a;
            margin: 0;
            padding: 0;
            direction: ${isEn ? 'ltr' : 'rtl'};
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .custom-pad-wrapper {
            position: relative;
            width: 100%;
            max-width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            box-sizing: border-box;
            background-color: #ffffff;
            overflow: hidden;
          }

          .custom-pad-bg-img {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: fill;
            z-index: 1;
          }

          ${padConfig.hideBackgroundOnPrint ? `
          @media print {
            .custom-pad-bg-img {
              display: none !important;
              visibility: hidden !important;
            }
          }
          ` : ''}

          .pad-element {
            position: absolute;
            z-index: 10;
            box-sizing: border-box;
            color: #0f172a;
            line-height: 1.4;
          }
        </style>
      </head>
      <body>
        <div class="custom-pad-wrapper">
          ${padConfig.backgroundImage && padConfig.backgroundImage.trim() !== '' ? `<img src="${padConfig.backgroundImage}" class="custom-pad-bg-img" alt="Prescription Pad" />` : ''}

          <!-- Patient Name -->
          <div class="pad-element" style="top: ${padConfig.patientName.top}%; left: ${padConfig.patientName.left}%; font-size: ${padConfig.patientName.fontSize || 15}px; font-weight: 800;">
            ${patientName}
          </div>

          <!-- Patient Age -->
          <div class="pad-element" style="top: ${padConfig.patientAge.top}%; left: ${padConfig.patientAge.left}%; font-size: ${padConfig.patientAge.fontSize || 15}px; font-weight: 700;">
            ${patientAge ? `${patientAge} ${isEn ? 'yrs' : 'سنة'}` : ''}
          </div>

          <!-- Date -->
          <div class="pad-element" style="top: ${padConfig.date.top}%; left: ${padConfig.date.left}%; font-size: ${padConfig.date.fontSize || 14}px; font-weight: 700;">
            ${formattedDate}
          </div>

          <!-- Medications Box -->
          <div class="pad-element" style="top: ${padConfig.medicationsBox.top}%; left: ${padConfig.medicationsBox.left}%; width: ${padConfig.medicationsBox.width || 84}%; height: ${padConfig.medicationsBox.height || 50}%; font-size: ${padConfig.medicationsBox.fontSize || 14}px; overflow-y: auto; direction: ${isEn ? 'ltr' : 'rtl'};">
            ${medicationsHtmlList}
          </div>

          <!-- Notes Box -->
          <div class="pad-element" style="top: ${padConfig.notesBox.top}%; left: ${padConfig.notesBox.left}%; width: ${padConfig.notesBox.width || 84}%; height: ${padConfig.notesBox.height || 16}%; font-size: ${padConfig.notesBox.fontSize || 13}px; overflow-y: auto; direction: ${isEn ? 'ltr' : 'rtl'}; color: #334155;">
            ${notes ? `<div><strong>${isEn ? 'Notes & Directions:' : 'ملاحظات وطريقة الاستعمال:'}</strong> ${notes}</div>` : ''}
          </div>
        </div>
      </body>
      </html>
    `;
  }

  // Standard prescription styles (classic, modern, minimal, elegant)
  const themeColors = (() => {
    switch (pStyle) {
      case 'modern':
        return { primary: '#10b981', headerBg: '#f0fdf4' };
      case 'minimal':
        return { primary: '#1e293b', headerBg: '#f8fafc' };
      case 'elegant':
        return { primary: '#7c3aed', headerBg: '#faf5ff' };
      case 'classic':
      default:
        return { primary: '#06b6d4', headerBg: '#f0fdfa' };
    }
  })();

  const primaryColor = themeColors.primary;
  const borderStyle = pStyle === 'classic' || pStyle === 'elegant' ? `4px double ${primaryColor}` : `2px solid ${primaryColor}`;
  const headerBg = themeColors.headerBg;

  const logoHTML = (clinic.logoUrl && clinic.logoUrl.trim() !== '')
    ? `<img src="${clinic.logoUrl}" alt="Logo" class="clinic-logo-img" />`
    : `<div class="clinic-logo-placeholder">⚕</div>`;

  const watermarkStyle = (clinic.logoUrl && clinic.logoUrl.trim() !== '')
    ? `background-image: url('${clinic.logoUrl}');`
    : `background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23cccccc" stroke-width="1"><path d="M4.5 16.5c-1.5 1.26-2.5 3.19-2.5 5.5h20c0-2.31-1-4.24-2.5-5.5M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>');`;

  let medsHTML = '';
  if (pLayout === 'traditional') {
    medsHTML = `
      <div class="prescription-meds-list">
        ${medications.map((med, index) => `
          <div class="med-item">
            <div class="med-name">${index + 1}. ${med.name}</div>
            <div class="med-instructions">${med.dose} • ${med.frequency} • ${med.duration}</div>
          </div>
        `).join('')}
      </div>
    `;
  } else {
    medsHTML = `
      <table class="med-table">
        <thead>
          <tr>
            <th style="width: 45%">${isEn ? 'Medication Name (Drug Name)' : 'اسم المستحضر الطبي (Drug Name)'}</th>
            <th style="width: 15%">${isEn ? 'Dosage' : 'الجرعة'}</th>
            <th style="width: 25%">${isEn ? 'Frequency & Directions' : 'التكرار والتعليمات'}</th>
            <th style="width: 15%">${isEn ? 'Duration' : 'المدة'}</th>
          </tr>
        </thead>
        <tbody>
          ${medications.map((med) => `
            <tr>
              <td><strong>${med.name}</strong></td>
              <td>${med.dose}</td>
              <td>${med.frequency}</td>
              <td>${med.duration}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="${isEn ? 'en' : 'ar'}" dir="${isEn ? 'ltr' : 'rtl'}">
    <head>
      <meta charset="UTF-8">
      <title>${isEn ? 'Medical Prescription' : 'روشتة علاجية'} - ${clinic.nameEn || clinic.name}</title>
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        
        body {
          font-family: 'Cairo', sans-serif;
          background-color: #ffffff;
          color: #0f172a;
          margin: 0;
          padding: 0;
          direction: ${isEn ? 'ltr' : 'rtl'};
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .prescription-container {
          width: 100%;
          max-width: 800px;
          min-height: 98vh;
          margin: 0 auto;
          box-sizing: border-box;
          border: ${borderStyle};
          padding: 40px;
          position: relative;
          display: flex;
          flex-direction: column;
          background-color: #ffffff;
        }

        .watermark-bg {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 520px;
          height: 520px;
          opacity: 0.15;
          ${watermarkStyle}
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          z-index: 1;
          pointer-events: none;
        }

        .header-layout {
          display: grid;
          grid-template-columns: 2.5fr 1.2fr 2.5fr;
          align-items: center;
          background-color: ${primaryColor};
          color: #ffffff;
          padding: 24px 30px;
          border-radius: 12px;
          margin-bottom: 25px;
          z-index: 10;
          position: relative;
        }
        .header-right { text-align: right; }
        .header-left { text-align: left; }
        .header-center {
          text-align: center;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .clinic-logo-img {
          width: 75px;
          height: 75px;
          object-fit: contain;
          border-radius: 12px;
          background-color: #ffffff;
          padding: 6px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .clinic-logo-placeholder {
          width: 70px;
          height: 70px;
          border-radius: 12px;
          background-color: rgba(255, 255, 255, 0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 32px;
        }

        .doctor-name-ar {
          font-size: 20px;
          font-weight: 900;
          margin: 0;
          line-height: 1.2;
        }
        .specialty-ar {
          font-size: 12.5px;
          color: #f1f5f9;
          margin: 4px 0 0 0;
          font-weight: 700;
        }
        .doctor-name-en {
          font-size: 18px;
          font-weight: 800;
          margin: 0;
          line-height: 1.2;
          font-family: system-ui, sans-serif;
        }
        .specialty-en {
          font-size: 11.5px;
          color: #e2e8f0;
          margin: 3px 0 0 0;
          font-weight: 600;
          line-height: 1.3;
          font-family: system-ui, sans-serif;
        }

        .patient-card {
          background-color: ${headerBg};
          border-radius: 12px;
          padding: 14px 20px;
          margin-bottom: 30px;
          font-size: 13.5px;
          border: 1px solid ${primaryColor}25;
          z-index: 10;
          position: relative;
          display: grid;
          grid-template-columns: 2.2fr 1fr 1.3fr;
          gap: 15px;
        }
        .patient-field {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .patient-field strong {
          color: ${primaryColor};
          font-weight: 700;
        }

        .rx-logo {
          font-size: 45px;
          font-weight: 900;
          color: ${primaryColor};
          line-height: 1;
          margin-bottom: 25px;
          font-style: italic;
          z-index: 10;
          position: relative;
          font-family: 'Times New Roman', Times, serif;
        }

        .prescription-body {
          flex: 1;
          z-index: 10;
          position: relative;
        }

        .prescription-meds-list {
          margin-top: 15px;
          margin-bottom: 30px;
          text-align: ${isEn ? 'left' : 'right'};
        }
        .med-item {
          margin-bottom: 22px;
          padding-bottom: 12px;
          border-bottom: 1px dashed #e2e8f0;
        }
        .med-item:last-child {
          border-bottom: none;
        }
        .med-name {
          font-size: 17px;
          font-weight: 800;
          color: #0f172a;
          font-family: 'JetBrains Mono', 'Inter', system-ui, sans-serif;
          text-align: left;
          direction: ltr;
        }
        .med-instructions {
          font-size: 13px;
          font-weight: 600;
          color: #475569;
          margin-top: 5px;
          ${isEn ? 'padding-left: 15px; text-align: left; direction: ltr;' : 'padding-right: 15px; text-align: right; direction: rtl;'}
        }

        .med-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 40px;
        }
        .med-table th {
          background-color: ${primaryColor};
          color: white;
          padding: 12px 14px;
          font-size: 13px;
          text-align: ${isEn ? 'left' : 'right'};
          font-weight: 700;
        }
        .med-table th:first-child { border-radius: ${isEn ? '10px 0 0 10px' : '0 10px 10px 0'}; }
        .med-table th:last-child { border-radius: ${isEn ? '0 10px 10px 0' : '10px 0 0 10px'}; }
        .med-table td {
          border-bottom: 1px solid #e2e8f0;
          padding: 14px 14px;
          font-size: 13.5px;
          color: #334155;
          text-align: ${isEn ? 'left' : 'right'};
        }

        .notes-section {
          background-color: #f8fafc;
          ${isEn ? `border-left: 4px solid ${primaryColor}; border-radius: 12px 4px 4px 12px;` : `border-right: 4px solid ${primaryColor}; border-radius: 4px 12px 12px 4px;`}
          padding: 15px 20px;
          font-size: 13px;
          color: #475569;
          line-height: 1.6;
          margin-top: 30px;
          text-align: ${isEn ? 'left' : 'right'};
        }
        .notes-section strong {
          color: #1e293b;
          display: block;
          margin-bottom: 6px;
          font-weight: 700;
        }

        .prescription-footer {
          margin-top: auto;
          padding-top: 25px;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11.5px;
          color: #64748b;
          z-index: 10;
          position: relative;
        }
        .footer-info {
          display: flex;
          gap: 20px;
        }
        .doctor-signature {
          text-align: center;
        }
        .signature-line {
          width: 140px;
          border-bottom: 1px dashed #94a3b8;
          margin-top: 30px;
        }

        @media print {
          body {
            background-color: #ffffff !important;
          }
          .prescription-container {
            border: none !important;
            padding: 20px !important;
            width: 100% !important;
            max-width: none !important;
            box-shadow: none !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="prescription-container">
        <div class="watermark-bg"></div>

        <div class="header-layout">
          <div class="header-right">
            <h1 class="doctor-name-ar">${clinic.doctorName || 'د. محمد السعدني'}</h1>
            <p class="specialty-ar">${clinic.doctorSpecialtyAr || 'أخصائي طب وجراحة الأسنان'}</p>
          </div>
          <div class="header-center">
            ${logoHTML}
          </div>
          <div class="header-left">
            <h2 class="doctor-name-en">${clinic.doctorNameEn || 'Dr. Mohamed El-Saadany'}</h2>
            <p class="specialty-en">${clinic.doctorSpecialtyEn || 'Dental & Oral Surgeon'}</p>
          </div>
        </div>

        <div class="patient-card">
          <div class="patient-field">
            <span>${isEn ? 'Patient Name:' : 'اسم المريض:'}</span>
            <strong>${patientName}</strong>
          </div>
          <div class="patient-field">
            <span>${isEn ? 'Age:' : 'السن:'}</span>
            <strong>${patientAge ? `${patientAge} ${isEn ? 'yrs' : 'سنة'}` : (isEn ? 'Unspecified' : 'غير محدد')}</strong>
          </div>
          <div class="patient-field">
            <span>${isEn ? 'Date:' : 'التاريخ:'}</span>
            <strong>${formattedDate}</strong>
          </div>
        </div>

        <div class="prescription-body">
          <div class="rx-logo">Rx</div>
          ${medsHTML}

          ${notes ? `
            <div class="notes-section">
              <strong>${isEn ? 'Doctor Instructions & Notes:' : 'تعليمات وملاحظات الطبيب:'}</strong>
              <div>${notes}</div>
            </div>
          ` : ''}
        </div>

        <div class="prescription-footer">
          <div class="footer-info">
            <span>📍 ${clinic.address || (isEn ? 'Address Unspecified' : 'العنوان غير محدد')}</span>
            <span>📞 ${clinic.doctorPhone || clinic.additionalPhones?.[0] || (isEn ? 'Phone Unspecified' : 'الهاتف غير محدد')}</span>
          </div>
          <div class="doctor-signature">
            <span>${isEn ? "Doctor's Signature & Stamp" : 'توقيع الطبيب المعالج'}</span>
            <div class="signature-line"></div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}
