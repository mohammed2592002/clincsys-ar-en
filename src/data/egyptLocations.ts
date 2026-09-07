export interface Governorate {
  id: string;
  name: string;
  nameEn: string;
  centers: string[];
  centersEn: string[];
}

export const EGYPT_GOVERNORATES: Governorate[] = [
  {
    id: "cairo",
    name: "القاهرة",
    nameEn: "Cairo",
    centers: [
      "مصر الجديدة", "النزهة", "شيراتون", "مدينة نصر (شرق)", "مدينة نصر (غرب)",
      "التجمع الخامس", "التجمع الأول", "التجمع الثالث", "الرحاب", "مدينتي",
      "الشروق", "بدر", "العاصمة الإدارية الجديدة", "حدائق العاصمة", "المطرية",
      "عين شمس", "السلام أول", "السلام ثان", "المرج", "الزيتون", "حدائق القبة",
      "الأميرية", "شبرا", "الشرابية", "الزاوية الحمراء", "روض الفرج", "الساحل",
      "وسط البلد", "عابدين", "الموسكي", "باب الشعرية", "الدرب الأحمر", "الأزبكية",
      "بولاق أبو العلا", "الزمالك", "جاردن سيتي", "الوايلي", "العباسية", "منشأة ناصر",
      "السيدة زينب", "مصر القديمة", "الفسطاط", "الخليفة", "المقطم", "البساتين",
      "دار السلام", "المعادي", "زهراء المعادي", "طرة", "المعصرة", "حلوان", "التبين", "15 مايو"
    ],
    centersEn: [
      "Heliopolis", "El Nozha", "Sheraton", "Nasr City (East)", "Nasr City (West)",
      "5th Settlement", "1st Settlement", "3rd Settlement", "El Rehab", "Madinaty",
      "El Shorouk", "Badr City", "New Administrative Capital", "Capital Gardens", "El Matareya",
      "Ain Shams", "El Salam 1", "El Salam 2", "El Marg", "El Zaytoun", "Hadaek El Qobbah",
      "El Amiria", "Shubra", "El Sharabiya", "El Zawya El Hamra", "Rod El Farag", "El Sahel",
      "Downtown", "Abdeen", "El Mosky", "Bab El Shaariya", "El Darb El Ahmar", "El Azbakeya",
      "Bulaq Abu El Ela", "Zamalek", "Garden City", "El Weili", "Abbassia", "Manshiyat Naser",
      "Sayeda Zeinab", "Old Cairo", "El Fostat", "El Khalifa", "El Mokattam", "El Basatin",
      "Dar El Salam", "Maadi", "Zahraa El Maadi", "Tora", "El Maasara", "Helwan", "El Tebbin", "15th of May"
    ]
  },
  {
    id: "giza",
    name: "الجيزة",
    nameEn: "Giza",
    centers: [
      "الدقي", "العجوزة", "الهرم", "فيصل", "العمرانية", "الطالبية", "بولاق الدكرور",
      "الوراق", "إمبابة", "الجيزة", "المنيب", "6 أكتوبر", "الشيخ زايد",
      "حدائق الأهرام", "حدائق أكتوبر", "أكتوبر الجديدة", "كرداسة", "أوسيم",
      "منشأة القناطر", "أبو النمرس", "البدرشين", "العياط", "الصف", "أطفيح", "الواحات البحرية"
    ],
    centersEn: [
      "Dokki", "Agouza", "Haram", "Faisal", "Omrania", "Talbiya", "Bulaq El Dakrour",
      "El Warraq", "Imbaba", "Giza City", "El Mounib", "6th of October", "Sheikh Zayed",
      "Hadayek El Ahram", "Hadayek October", "New October", "Kerdasa", "Oseem",
      "Manshiyet El Qanater", "Abu El Nomros", "El Badrasheen", "El Ayat", "El Saff", "Atfih", "Bahariya Oasis"
    ]
  },
  {
    id: "alexandria",
    name: "الإسكندرية",
    nameEn: "Alexandria",
    centers: [
      "المنتزه أول", "المنتزه ثان", "شرق الإسكندرية (سموحة/سيدي جابر/رشدي)",
      "وسط الإسكندرية (محرم بك/الشاطبي)", "غرب الإسكندرية (مينا البصل/القباري)",
      "العجمي (البيطاش/الهانوفيل)", "العامرية أول", "العامرية ثان", "برج العرب", "الجمرك (بحري)"
    ],
    centersEn: [
      "Montaza 1", "Montaza 2", "East Alexandria (Smouha/Sidi Gaber/Roushdy)",
      "Central Alexandria (Moharam Bek/Shatby)", "West Alexandria (Mina El Bassal/Qabbari)",
      "Agami (Bitash/Hanoville)", "Ameriya 1", "Ameriya 2", "Borg El Arab", "El Gomrok (Bahary)"
    ]
  },
  {
    id: "qalyubia",
    name: "القليوبية",
    nameEn: "Qalyubia",
    centers: [
      "بنها", "شبرا الخيمة (شرق)", "شبرا الخيمة (غرب)", "الخانكة", "الخصوص",
      "العبور", "العبور الجديدة", "قها", "قليوب", "طوخ", "شبين القناطر",
      "القناطر الخيرية", "كفر شكر"
    ],
    centersEn: [
      "Banha", "Shubra El Kheima (East)", "Shubra El Kheima (West)", "El Khankah", "El Khosoos",
      "El Obour", "New Obour", "Qaha", "Qalyub", "Toukh", "Shebin El Qanater",
      "El Qanater El Khayreya", "Kafr Shukr"
    ]
  },
  {
    id: "sharqia",
    name: "الشرقية",
    nameEn: "Sharqia",
    centers: [
      "الزقازيق (حي أول)", "الزقازيق (حي ثان)", "العاشر من رمضان", "بلبيس",
      "فاقوس", "أبو كبير", "ههيا", "أبو حماد", "ديرب نجم", "كفر صقر",
      "أولاد صقر", "الحسينية", "مشتول السوق", "الإبراهيمية", "منيا القمح",
      "الصالحية الجديدة", "صان الحجر", "القنايات"
    ],
    centersEn: [
      "Zagazig (District 1)", "Zagazig (District 2)", "10th of Ramadan", "Belbeis",
      "Faqous", "Abu Kabir", "Hehya", "Abu Hammad", "Deyarb Negm", "Kafr Saqr",
      "Awlad Saqr", "El Husseiniya", "Mashtool El Souk", "El Ibrahimiya", "Minya El Qamh",
      "New Salhia", "San El Hagar", "El Qanayat"
    ]
  },
  {
    id: "dakahlia",
    name: "الدقهلية",
    nameEn: "Dakahlia",
    centers: [
      "المنصورة (حي شرق)", "المنصورة (حي غرب)", "المنصورة الجديدة", "طلخا", "ميت غمر",
      "دكرنس", "أجا", "شربين", "السنبلاوين", "بلقاس", "منية النصر", "تمي الأمديد",
      "الجمالية", "المطرية", "نبروه", "الكردي", "بني عبيد", "محلة دمنة", "جمصة"
    ],
    centersEn: [
      "Mansoura (East)", "Mansoura (West)", "New Mansoura", "Talkha", "Mit Ghamr",
      "Dikirnis", "Aga", "Sherbin", "Sinbillawein", "Belqas", "Menyet El Nasr", "Tami El Amdid",
      "El Gamaliya", "El Matareya", "Nabaroh", "El Kurdi", "Bani Ebeid", "Mahalat Damana", "Gamasa"
    ]
  },
  {
    id: "gharbia",
    name: "الغربية",
    nameEn: "Gharbia",
    centers: [
      "طنطا (حي أول)", "طنطا (حي ثان)", "المحلة الكبرى (حي أول)",
      "المحلة الكبرى (حي ثان)", "كفر الزيات", "زفتى", "السنطة", "بسيون", "قطور", "سمنود"
    ],
    centersEn: [
      "Tanta (District 1)", "Tanta (District 2)", "El Mahalla El Kubra (District 1)",
      "El Mahalla El Kubra (District 2)", "Kafr El Zayat", "Zifta", "El Santa", "Basyoun", "Qutour", "Samannoud"
    ]
  },
  {
    id: "monufia",
    name: "المنوفية",
    nameEn: "Monufia",
    centers: [
      "شبين الكوم", "أشمون", "منوف", "تلا", "قويسنا", "الشهداء",
      "مدينة السادات", "الباجور", "بركة السبع", "سرس الليان"
    ],
    centersEn: [
      "Shebin El Koum", "Ashmoun", "Menouf", "Tala", "Quesna", "El Shohada",
      "Sadat City", "El Bagour", "Berket El Saba", "Sars El Lyan"
    ]
  },
  {
    id: "kafr_elsheikh",
    name: "كفر الشيخ",
    nameEn: "Kafr El Sheikh",
    centers: [
      "كفر الشيخ", "دسوق", "فوه", "مطوبس", "قلين", "سيدي سالم",
      "الرياض", "بيلا", "الحامول", "بلطيم", "مصيف بلطيم", "البرلس", "سيدي غازي"
    ],
    centersEn: [
      "Kafr El Sheikh", "Desouk", "Fuwwah", "Metobas", "Qallin", "Sidi Salem",
      "El Reyad", "Biyala", "El Hamoul", "Baltim", "Baltim Resort", "El Borollos", "Sidi Ghazi"
    ]
  },
  {
    id: "beheira",
    name: "البحيرة",
    nameEn: "Beheira",
    centers: [
      "دمنهور", "كفر الدوار", "إيتاي البارود", "أبو حمص", "حوش عيسى",
      "رشيد", "المحمودية", "كوم حمادة", "الدلنجات", "وادي النطرون",
      "شبراخيت", "إدكو", "بدر", "النوبارية الجديدة"
    ],
    centersEn: [
      "Damanhour", "Kafr El Dawwar", "Itay El Baroud", "Abu Hommos", "Hosh Issa",
      "Rashid", "El Mahmoudiyah", "Kom Hamada", "El Delengat", "Wadi El Natroun",
      "Shubrakhit", "Edko", "Badr", "New Nubaria"
    ]
  },
  {
    id: "damietta",
    name: "دمياط",
    nameEn: "Damietta",
    centers: [
      "دمياط (حي أول)", "دمياط (حي ثان)", "فارسكور", "الزرقا", "كفر البطيخ",
      "كفر سعد", "رأس البر", "دمياط الجديدة", "السرو", "ميت أبو غالب"
    ],
    centersEn: [
      "Damietta (District 1)", "Damietta (District 2)", "Faraskour", "El Zarqa", "Kafr El Battikh",
      "Kafr Saad", "Ras El Bar", "New Damietta", "El Serw", "Mit Abu Ghaleb"
    ]
  },
  {
    id: "port_said",
    name: "بورسعيد",
    nameEn: "Port Said",
    centers: [
      "حي الشرق", "حي العرب", "حي المناخ", "حي الضواحي", "حي الزهور",
      "حي الجنوب", "حي الغرب", "بورفؤاد", "مدينة سلام مصر (شرق بورسعيد)"
    ],
    centersEn: [
      "El Sharq", "El Arab", "El Manakh", "El Dawahy", "El Zohour",
      "El Ganoub", "El Gharb", "Port Fouad", "Salam Misr City (East Port Said)"
    ]
  },
  {
    id: "ismailia",
    name: "الإسماعيلية",
    nameEn: "Ismailia",
    centers: [
      "الإسماعيلية (حي أول)", "الإسماعيلية (حي ثان)", "الإسماعيلية (حي ثالث)",
      "الإسماعيلية الجديدة", "التل الكبير", "فايد", "القنطرة شرق", "القنطرة غرب", "أبو صوير", "القصاصين"
    ],
    centersEn: [
      "Ismailia (District 1)", "Ismailia (District 2)", "Ismailia (District 3)",
      "New Ismailia", "El Tal El Kebir", "Fayed", "Qantara East", "Qantara West", "Abu Suwir", "El Qasasin"
    ]
  },
  {
    id: "suez",
    name: "السويس",
    nameEn: "Suez",
    centers: [
      "حي السويس", "حي الأربعين", "حي عتاقة", "حي الفيصل", "حي الجناين"
    ],
    centersEn: [
      "Suez District", "El Arbaeen", "Attaka", "Faisal", "El Ganayen"
    ]
  },
  {
    id: "north_sinai",
    name: "شمال سيناء",
    nameEn: "North Sinai",
    centers: [
      "العريش", "الشيخ زويد", "رفح", "بئر العبد", "الحسنة", "نخل"
    ],
    centersEn: [
      "Arish", "Sheikh Zuweid", "Rafah", "Bir El Abd", "Hassana", "Nakhl"
    ]
  },
  {
    id: "south_sinai",
    name: "جنوب سيناء",
    nameEn: "South Sinai",
    centers: [
      "طور سيناء", "شرم الشيخ", "دهب", "نويبع", "طابا",
      "سانت كاترين", "أبو رديس", "أبو زنيمة", "رأس سدر"
    ],
    centersEn: [
      "Tor Sinai", "Sharm El Sheikh", "Dahab", "Nuweiba", "Taba",
      "Saint Catherine", "Abu Rudeis", "Abu Zenima", "Ras Sedr"
    ]
  },
  {
    id: "beni_suef",
    name: "بني سويف",
    nameEn: "Beni Suef",
    centers: [
      "بني سويف", "بني سويف الجديدة", "الواسطى", "ناصر", "ببا", "الفشن", "إهناسيا", "سمسطا"
    ],
    centersEn: [
      "Beni Suef", "New Beni Suef", "El Wasti", "Nasser", "Beba", "El Fashn", "Ihnasiya", "Somasta"
    ]
  },
  {
    id: "faiyum",
    name: "الفيوم",
    nameEn: "Faiyum",
    centers: [
      "الفيوم", "الفيوم الجديدة", "سنورس", "إطسا", "طامية", "أبشواي", "يوسف الصديق"
    ],
    centersEn: [
      "Faiyum", "New Faiyum", "Sinnuris", "Itsa", "Tamia", "Ibshaway", "Youssef El Seddik"
    ]
  },
  {
    id: "minya",
    name: "المنيا",
    nameEn: "Minya",
    centers: [
      "المنيا", "المنيا الجديدة", "مغاغة", "بني مزار", "مطاي", "سمالوط",
      "أبو قرقاص", "ملوي", "دير مواس", "العدوة"
    ],
    centersEn: [
      "Minya", "New Minya", "Maghagha", "Beni Mazar", "Matay", "Samalut",
      "Abu Qurqas", "Mallawi", "Deir Mawas", "El Idwa"
    ]
  },
  {
    id: "asyut",
    name: "أسيوط",
    nameEn: "Asyut",
    centers: [
      "أسيوط (حي شرق)", "أسيوط (حي غرب)", "أسيوط الجديدة", "مدينة ناصر (غرب أسيوط)",
      "ديروط", "القوصية", "أبنوب", "منفلوط", "الفتح", "أبو تيج", "الغنايم",
      "ساحل سليم", "البداري", "صدفا"
    ],
    centersEn: [
      "Asyut (East)", "Asyut (West)", "New Asyut", "Nasser City (West Asyut)",
      "Dairut", "El Qusiya", "Abnoub", "Manfalut", "El Fateh", "Abu Tig", "El Ghanayem",
      "Sahel Selim", "El Badari", "Sidfa"
    ]
  },
  {
    id: "sohag",
    name: "سوهاج",
    nameEn: "Sohag",
    centers: [
      "سوهاج (حي شرق)", "سوهاج (حي غرب)", "سوهاج الجديدة", "أخميم", "أخميم الجديدة",
      "البلينا", "المراغة", "المنشأة", "دار السلام", "جهينة", "طهطا", "طما",
      "ساقلتة", "العسيرات"
    ],
    centersEn: [
      "Sohag (East)", "Sohag (West)", "New Sohag", "Akhmim", "New Akhmim",
      "El Balyana", "El Maragha", "El Monshah", "Dar El Salam", "Gohina", "Tahta", "Tama",
      "Saqalta", "El Osayrat"
    ]
  },
  {
    id: "qena",
    name: "قنا",
    nameEn: "Qena",
    centers: [
      "قنا", "قنا الجديدة", "مدينة غرب قنا", "نجع حمادي", "دشنا", "قوص",
      "نقادة", "فرشوط", "أبو تشت", "الوقف", "قفط"
    ],
    centersEn: [
      "Qena", "New Qena", "West Qena", "Nag Hammadi", "Deshna", "Qus",
      "Naqada", "Farshut", "Abu Tesht", "El Waqf", "Qift"
    ]
  },
  {
    id: "luxor",
    name: "الأقصر",
    nameEn: "Luxor",
    centers: [
      "الأقصر", "الأقصر الجديدة", "مدينة طيبة الجديدة", "البياضية", "الطود",
      "أرمنت", "إسنا", "القرنة", "الزينية"
    ],
    centersEn: [
      "Luxor", "New Luxor", "New Tiba", "Bayadiya", "Tod",
      "Armant", "Esna", "Qurna", "Zayniya"
    ]
  },
  {
    id: "aswan",
    name: "أسوان",
    nameEn: "Aswan",
    centers: [
      "أسوان", "أسوان الجديدة", "توشكى الجديدة", "إدفو", "كوم أمبو",
      "نصر النوبة", "دراو", "أبو سمبل السياحية", "كلابشة"
    ],
    centersEn: [
      "Aswan", "New Aswan", "New Toshka", "Edfu", "Kom Ombo",
      "Nasr El Nuba", "Daraw", "Abu Simbel", "Kalabsha"
    ]
  },
  {
    id: "red_sea",
    name: "البحر الأحمر",
    nameEn: "Red Sea",
    centers: [
      "الغردقة (حي شمال)", "الغردقة (حي جنوب)", "رأس غارب", "سفاجا", "القصير", "مرسى علم", "شلاتين", "حلايب"
    ],
    centersEn: [
      "Hurghada (North)", "Hurghada (South)", "Ras Gharib", "Safaga", "Quseir", "Marsa Alam", "Shalateen", "Halaib"
    ]
  },
  {
    id: "new_valley",
    name: "الوادي الجديد",
    nameEn: "New Valley",
    centers: [
      "الخارجة", "الداخلة", "الفرافرة", "باريس", "بلاط"
    ],
    centersEn: [
      "Kharga", "Dakhla", "Farafra", "Paris", "Balat"
    ]
  },
  {
    id: "matrouh",
    name: "مطروح",
    nameEn: "Matrouh",
    centers: [
      "مرسى مطروح", "الحمام", "العلمين", "العلمين الجديدة", "الضبعة", "النجيلة", "سيدي براني", "السلوم", "سيوة"
    ],
    centersEn: [
      "Marsa Matrouh", "El Hamam", "El Alamein", "New Alamein", "El Dabaa", "El Negaila", "Sidi Barrani", "Sallum", "Siwa"
    ]
  }
];

// Translation Maps for fast bidirectional lookups
const GOV_AR_TO_EN: Record<string, string> = {};
const GOV_EN_TO_AR: Record<string, string> = {};
const CENTER_AR_TO_EN: Record<string, string> = {};
const CENTER_EN_TO_AR: Record<string, string> = {};

EGYPT_GOVERNORATES.forEach(gov => {
  GOV_AR_TO_EN[gov.name] = gov.nameEn;
  GOV_EN_TO_AR[gov.nameEn.toLowerCase()] = gov.name;
  GOV_EN_TO_AR[gov.name.toLowerCase()] = gov.name;

  gov.centers.forEach((centerAr, idx) => {
    const centerEn = gov.centersEn[idx] || centerAr;
    CENTER_AR_TO_EN[centerAr] = centerEn;
    CENTER_EN_TO_AR[centerEn.toLowerCase()] = centerAr;
    CENTER_EN_TO_AR[centerAr.toLowerCase()] = centerAr;
  });
});

/**
 * Translates a governorate name to either English or Arabic based on isEn flag
 */
export function translateGovernorate(gov: string | undefined | null, isEn: boolean): string {
  if (!gov) return '';
  const trimmed = gov.trim();
  if (isEn) {
    return GOV_AR_TO_EN[trimmed] || trimmed;
  } else {
    return GOV_EN_TO_AR[trimmed.toLowerCase()] || trimmed;
  }
}

/**
 * Translates a city / district / center name to either English or Arabic based on isEn flag
 */
export function translateCenter(center: string | undefined | null, isEn: boolean): string {
  if (!center) return '';
  const trimmed = center.trim();
  if (isEn) {
    return CENTER_AR_TO_EN[trimmed] || trimmed;
  } else {
    return CENTER_EN_TO_AR[trimmed.toLowerCase()] || trimmed;
  }
}

/**
 * Formats a full location string (Gov - City - Area) translated according to language
 */
export function formatLocationDisplayName(
  governorate?: string,
  cityOrDistrict?: string,
  area?: string,
  isEn: boolean = false
): string {
  const g = translateGovernorate(governorate, isEn);
  const c = translateCenter(cityOrDistrict, isEn);
  
  if (g && c) {
    return `${g} - ${c}`;
  }
  if (g) {
    return g;
  }
  if (c) {
    return c;
  }
  if (area) {
    // If area contains ' - ' we can translate both parts
    if (area.includes(' - ')) {
      const [part1, part2] = area.split(' - ');
      const t1 = translateGovernorate(part1, isEn) || translateCenter(part1, isEn);
      const t2 = translateCenter(part2, isEn) || translateGovernorate(part2, isEn);
      return `${t1} - ${t2}`;
    }
    return translateGovernorate(area, isEn) || translateCenter(area, isEn);
  }
  return '';
}
