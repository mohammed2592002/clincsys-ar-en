import React, { useState } from 'react';
import { useClinic } from '../context/ClinicContext';
import { isAppointmentTimeConflict } from '../utils/appointmentUtils';
import { AppointmentStatus } from '../types/clinic';
import {
  CalendarDays,
  Clock,
  Plus,
  Play,
  CheckCircle2,
  XCircle,
  Search,
  User,
  Stethoscope,
  X
} from 'lucide-react';

export const AppointmentsView: React.FC = () => {
  const {
    language,
    appointments,
    doctors,
    patients,
    addAppointment,
    updateAppointmentStatus,
    setActiveAppointmentId,
    setActiveTab
  } = useClinic();

  const isAr = language === 'ar';

  const [isBookModalOpen, setIsBookModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [doctorFilter, setDoctorFilter] = useState<string>('all');

  // New Appointment Form
  const [bookForm, setBookForm] = useState({
    patientId: patients[0]?.id || '',
    doctorId: doctors[0]?.id || '',
    date: new Date().toISOString().split('T')[0],
    time: '10:00 AM',
    type: 'Consultation' as const,
    symptoms: '',
    notes: ''
  });

  const filteredAppointments = appointments.filter((apt) => {
    const matchesStatus = statusFilter === 'all' || apt.status === statusFilter;
    const matchesDoctor = doctorFilter === 'all' || apt.doctorId === doctorFilter;
    return matchesStatus && matchesDoctor;
  });

  const handleBookAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedPat = patients.find((p) => p.id === bookForm.patientId);
    const selectedDoc = doctors.find((d) => d.id === bookForm.doctorId);

    if (!selectedPat || !selectedDoc) return;

    // Check double-booking conflict
    const activeSameDayApps = appointments.filter(
      (a) => a.date === bookForm.date && a.status !== 'Cancelled' && a.status !== 'cancelled'
    );
    const hasConflict = activeSameDayApps.some((a) =>
      isAppointmentTimeConflict(a.time, bookForm.time)
    );

    if (hasConflict) {
      alert(isAr ? 'عفواً، يوجد موعد محجوز مسبقاً في نفس الساعة/الوقت!' : 'Sorry, an appointment is already booked at the same hour/time slot!');
      return;
    }

    addAppointment({
      patientId: selectedPat.id,
      patientName: isAr ? `${selectedPat.fullNameAr} (${selectedPat.fullName})` : selectedPat.fullName,
      patientPhone: selectedPat.phone,
      doctorId: selectedDoc.id,
      doctorName: selectedDoc.name,
      specialty: selectedDoc.specialty,
      date: bookForm.date,
      time: bookForm.time,
      type: bookForm.type,
      status: 'Waiting',
      symptoms: bookForm.symptoms || 'General Checkup',
      notes: bookForm.notes
    });

    setIsBookModalOpen(false);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {isAr ? 'حجز وتنسيق المواعيد والطابور' : 'Appointment Scheduling & Queue'}
          </h2>
          <p className="text-xs text-slate-500">
            {isAr ? 'متابعة طابور عيادات الأطباء، تغيير حالة المريض، واستدعاء المرضى' : 'Manage doctor consultation queues, status transitions, and appointment booking'}
          </p>
        </div>

        <button
          onClick={() => setIsBookModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{isAr ? 'حجز موعد جديد' : 'Book New Appointment'}</span>
        </button>
      </div>

      {/* Filter Options Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-4 text-xs">
        {/* Status Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-slate-400">{isAr ? 'الحالة:' : 'Status:'}</span>
          {[
            { id: 'all', labelAr: 'الكل', labelEn: 'All' },
            { id: 'Waiting', labelAr: 'في الانتظار', labelEn: 'Waiting' },
            { id: 'In Progress', labelAr: 'في الكشف', labelEn: 'In Progress' },
            { id: 'Completed', labelAr: 'مكتمل', labelEn: 'Completed' },
            { id: 'Scheduled', labelAr: 'مجدول', labelEn: 'Scheduled' }
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 rounded-xl font-semibold transition-colors cursor-pointer ${
                statusFilter === s.id
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {isAr ? s.labelAr : s.labelEn}
            </button>
          ))}
        </div>

        {/* Doctor Filter */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-400">{isAr ? 'الطبيب:' : 'Doctor:'}</span>
          <select
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(e.target.value)}
            className="p-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
          >
            <option value="all">{isAr ? 'جميع الأطباء' : 'All Doctors'}</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {isAr ? d.nameAr : d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Appointments Queue Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase tracking-wider">
              <tr>
                <th className="p-3.5 text-center w-16">{isAr ? 'رقم الطابور' : 'Queue #'}</th>
                <th className="p-3.5 text-start">{isAr ? 'اسم المريض' : 'Patient Name'}</th>
                <th className="p-3.5 text-start">{isAr ? 'الطبيب المعالج' : 'Doctor'}</th>
                <th className="p-3.5 text-start">{isAr ? 'الموعد والوقت' : 'Date & Time'}</th>
                <th className="p-3.5 text-start">{isAr ? 'سبب الزيارة / الأعراض' : 'Symptoms / Type'}</th>
                <th className="p-3.5 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="p-3.5 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {filteredAppointments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400">
                    {isAr ? 'لا توجد مواعيد مطابقة للفلاتر' : 'No appointments matching selected filters'}
                  </td>
                </tr>
              ) : (
                filteredAppointments.map((apt) => (
                  <tr key={apt.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3.5 text-center">
                      <span className="w-8 h-8 rounded-xl bg-teal-50 text-teal-800 font-black flex items-center justify-center mx-auto border border-teal-200">
                        #{apt.queueNumber}
                      </span>
                    </td>

                    <td className="p-3.5 font-bold text-slate-900">
                      <div>{apt.patientName}</div>
                      <div className="text-[11px] font-normal text-slate-500">{apt.patientPhone}</div>
                    </td>

                    <td className="p-3.5">
                      <div className="font-semibold text-slate-800">{apt.doctorName}</div>
                      <div className="text-[11px] text-teal-600">{apt.specialty}</div>
                    </td>

                    <td className="p-3.5">
                      <div className="flex items-center gap-1 text-slate-700">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{apt.time}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">{apt.date}</div>
                    </td>

                    <td className="p-3.5 max-w-xs truncate text-slate-600">
                      {apt.symptoms}
                    </td>

                    <td className="p-3.5">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          apt.status === 'In Progress'
                            ? 'bg-teal-100 text-teal-800 animate-pulse'
                            : apt.status === 'Waiting'
                            ? 'bg-amber-100 text-amber-800'
                            : apt.status === 'Completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {apt.status === 'In Progress'
                          ? (isAr ? 'في غرفة الكشف' : 'In Consultation')
                          : apt.status === 'Waiting'
                          ? (isAr ? 'في الانتظار' : 'Waiting')
                          : apt.status === 'Completed'
                          ? (isAr ? 'مكتمل' : 'Completed')
                          : (isAr ? 'مجدول' : 'Scheduled')}
                      </span>
                    </td>

                    <td className="p-3.5 text-end">
                      <div className="flex items-center justify-end gap-1.5">
                        {apt.status === 'Waiting' && (
                          <button
                            onClick={() => {
                              updateAppointmentStatus(apt.id, 'In Progress');
                              setActiveAppointmentId(apt.id);
                              setActiveTab('consultation');
                            }}
                            className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Play className="w-3 h-3" />
                            <span>{isAr ? 'بدء الكشف' : 'Examine'}</span>
                          </button>
                        )}

                        {apt.status === 'In Progress' && (
                          <button
                            onClick={() => {
                              setActiveAppointmentId(apt.id);
                              setActiveTab('consultation');
                            }}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs cursor-pointer"
                          >
                            {isAr ? 'إدخال الروشتة' : 'EHR Screen'}
                          </button>
                        )}

                        {apt.status !== 'Completed' && (
                          <button
                            onClick={() => updateAppointmentStatus(apt.id, 'Completed')}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-md cursor-pointer"
                            title={isAr ? 'إنهاء الموعد' : 'Mark Completed'}
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Book Appointment Modal */}
      {isBookModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {isAr ? 'حجز موعد كشف جديد' : 'Book New Appointment'}
              </h3>
              <button onClick={() => setIsBookModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleBookAppointment} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'اختر المريض' : 'Select Patient'}</label>
                <select
                  value={bookForm.patientId}
                  onChange={(e) => setBookForm({ ...bookForm, patientId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {isAr ? p.fullNameAr || p.fullName : p.fullName} ({p.fileNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'اختر الطبيب والعيادة' : 'Select Doctor & Clinic'}</label>
                <select
                  value={bookForm.doctorId}
                  onChange={(e) => setBookForm({ ...bookForm, doctorId: e.target.value })}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-teal-500"
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {isAr ? d.nameAr : d.name} - {isAr ? d.specialtyAr : d.specialty}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'التاريخ' : 'Date'}</label>
                  <input
                    type="date"
                    value={bookForm.date}
                    onChange={(e) => setBookForm({ ...bookForm, date: e.target.value })}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">{isAr ? 'الوقت' : 'Time'}</label>
                  <input
                    type="text"
                    value={bookForm.time}
                    onChange={(e) => setBookForm({ ...bookForm, time: e.target.value })}
                    placeholder="10:30 AM"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">{isAr ? 'سبب الزيارة والأعراض' : 'Symptoms & Complaint'}</label>
                <textarea
                  rows={2}
                  value={bookForm.symptoms}
                  onChange={(e) => setBookForm({ ...bookForm, symptoms: e.target.value })}
                  placeholder={isAr ? 'اكتب الأعراض المبدئية للعيادة...' : 'Brief description of symptoms...'}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsBookModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-teal-600 text-white font-bold rounded-xl hover:bg-teal-700 transition-colors cursor-pointer"
                >
                  {isAr ? 'تأكيد الحجز' : 'Confirm Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
