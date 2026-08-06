import React, { useState, useEffect } from 'react';
import { apiRequest } from '../services/api';
import { Download, CheckCircle, AlertTriangle } from 'lucide-react';
import { Toast } from '../components/Toast';

export const StudentPortal: React.FC = () => {
  const [profile, setProfile] = useState<any>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchStudentData();
  }, []);

  const fetchStudentData = async () => {
    try {
      const [profileRes, qrRes, summaryRes] = await Promise.allSettled([
        apiRequest<any>('/student/profile'),
        apiRequest<any>('/student/qr-code'),
        apiRequest<any>('/student/attendance-summary')
      ]);

      if (profileRes.status === 'fulfilled') {
        setProfile(profileRes.value);
      }
      if (qrRes.status === 'fulfilled') {
        setQrCodeUrl(qrRes.value.qr_code_url);
      }
      if (summaryRes.status === 'fulfilled') {
        setSummary(summaryRes.value);
      }

      if (profileRes.status === 'rejected' || qrRes.status === 'rejected') {
        const errObj: any = profileRes.status === 'rejected' ? profileRes.reason : (qrRes as PromiseRejectedResult).reason;
        setToast({ message: errObj?.message || 'Could not connect to attendance server. Please ensure backend is running.', type: 'error' });
      }
    } catch (err: any) {
      setToast({ message: err.message || 'Error loading student profile', type: 'error' });
    }
  };

  const downloadQR = () => {
    if (!qrCodeUrl || !profile) return;
    const a = document.createElement('a');
    a.href = qrCodeUrl;
    a.download = `QR_${profile.roll_number}.png`;
    a.click();
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {profile && (
        <div className="snist-card p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
          
          {/* Profile Details */}
          <div className="space-y-3 text-center md:text-left">
            <span className="px-3.5 py-1.5 bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-full text-xs font-bold uppercase">
              Student Identity Portal
            </span>
            <h2 className="font-heading text-2xl sm:text-3xl font-extrabold text-[#15347e]">{profile.name}</h2>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 text-xs">
              <span className="px-3 py-1 bg-slate-100 border border-slate-300 text-[#2f53d7] font-mono font-bold rounded-lg">
                Roll No: {profile.roll_number}
              </span>
              <span className="px-3 py-1 bg-slate-100 border border-slate-300 text-slate-700 font-semibold rounded-lg">
                {profile.department} • {profile.section}
              </span>
              <span className="px-3 py-1 bg-slate-100 border border-slate-300 text-slate-600 rounded-lg">
                {profile.year}
              </span>
            </div>
          </div>

          {/* Download QR Button */}
          <button
            onClick={downloadQR}
            className="px-5 py-3 snist-btn-primary font-bold text-xs flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> Download Official QR Code
          </button>

        </div>
      )}

      {/* Main QR Display Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Encrypted QR Card */}
        <div className="snist-card p-6 flex flex-col items-center justify-center text-center space-y-4">
          <h3 className="text-xs font-bold text-[#6a7894] uppercase tracking-wider">Official Attendance Encrypted QR</h3>
          
          {qrCodeUrl ? (
            <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-lg">
              <img src={qrCodeUrl} alt="Student Encrypted QR" className="w-64 h-64 object-contain" />
            </div>
          ) : (
            <div className="w-64 h-64 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
              Loading QR...
            </div>
          )}

          <p className="text-xs text-slate-500 max-w-xs font-medium">
            Show this QR code to your faculty member during class for automated attendance recording.
          </p>
        </div>

        {/* Overall Percentage Card */}
        {summary && (
          <div className="snist-card p-6 flex flex-col justify-between space-y-6">
            <div>
              <h3 className="text-xs font-bold text-[#6a7894] uppercase tracking-wider">Attendance Percentage</h3>
              
              <div className="mt-4 flex items-center gap-6">
                <div className="font-heading text-5xl font-extrabold text-[#15347e]">
                  {summary.overall_percentage}%
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-600">Total Conducted: {summary.total_conducted}</p>
                  <p className="text-xs font-bold text-emerald-700 mt-0.5">Classes Attended: {summary.total_present}</p>
                </div>
              </div>
            </div>

            {summary.overall_percentage < 75 ? (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-rose-800">Low Attendance Warning (&lt; 75%)</h4>
                  <p className="text-[11px] text-rose-700 mt-0.5">Maintain at least 75% attendance to qualify for semester examinations.</p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-emerald-800">Good Standing (&ge; 75%)</h4>
                  <p className="text-[11px] text-emerald-700 mt-0.5">Your attendance satisfies the examination eligibility requirement.</p>
                </div>
              </div>
            )}

            {/* Subject Breakdown */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#6a7894] uppercase">Subject Breakdown</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {summary.subjects.map((sub: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <span className="font-bold text-[#17233c]">{sub.subject_name}</span>
                    <span className={`font-mono font-bold ${sub.percentage >= 75 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {sub.percentage}% ({sub.present}/{sub.conducted})
                    </span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>

    </div>
  );
};
