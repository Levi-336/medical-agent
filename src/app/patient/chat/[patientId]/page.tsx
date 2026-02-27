import Link from 'next/link';
import { getChatHistory, getPatient } from '@/app/actions';
import PatientWeChatChat from '@/components/patient/PatientWeChatChat';

export const dynamic = 'force-dynamic';

interface PatientChatPageProps {
  params: Promise<{ patientId: string }>;
}

export default async function PatientChatPage({ params }: PatientChatPageProps) {
  const { patientId } = await params;
  const patient = await getPatient(patientId);

  if (!patient) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f2f2f2] p-6 text-slate-700">
        <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-md w-full">
          <div className="text-lg font-bold mb-2">未找到该会话</div>
          <div className="text-sm text-slate-500 mb-4">请返回消息列表重新选择。</div>
          <Link
            href="/patient"
            className="inline-flex items-center justify-center w-full bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 transition"
          >
            返回消息列表
          </Link>
        </div>
      </div>
    );
  }

  const history = await getChatHistory(patient.id);
  return <PatientWeChatChat patient={patient} initialHistory={history} />;
}

