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
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#111b21] p-6 whatsapp-theme">
        <div className="bg-[#202c33] rounded-2xl border border-[#313d44] p-8 max-w-md w-full text-center shadow-2xl">
          <div className="mb-6">
            <span className="material-symbols-outlined !text-[64px] text-[#54656f]">chat_bubble_outline</span>
          </div>
          <div className="text-[18px] font-medium mb-3 text-[#e9edef]">未找到该会话</div>
          <div className="text-[14px] text-[#8696a0] mb-6">请返回消息列表重新选择</div>
          <Link
            href="/patient"
            className="inline-flex items-center justify-center w-full bg-[#00d95f] text-white rounded-lg px-6 py-3 hover:bg-[#00c851] transition-colors font-medium"
          >
            <span className="material-symbols-outlined !text-[18px] mr-2">arrow_back</span>
            返回消息列表
          </Link>
        </div>
      </div>
    );
  }

  const history = await getChatHistory(patient.id);
  return <PatientWeChatChat patient={patient} initialHistory={history} />;
}

