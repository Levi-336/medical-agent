'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import type { Patient, ChatMessage } from '@/app/actions';
import { processUserMessage } from '@/app/actions';
import { cn } from '@/lib/utils';
import doctorAvatar from '@/app/character-7166558_1280.png';

const iconThinStyle: React.CSSProperties = {
  fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 24",
};

type UiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'doctor' | 'ai';
  content: string;
  created_at?: string;
};

interface PatientWeChatChatProps {
  patient: Patient;
  initialHistory: ChatMessage[];
}

function parseHistoryItem(h: ChatMessage): UiMessage {
  return {
    id: h.id.toString(),
    role: h.role,
    content: h.content,
    created_at: h.created_at,
  };
}

function formatAiQuestions(content: string) {
  return content
    .replace(/([?？])(?!\s*\n)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatPatientVisibleContent(role: UiMessage['role'], content: string) {
  const trimmed = content.trim();
  if (/^【(医生|医生助理|AI自动回复)】/.test(trimmed)) return content;

  if (role === 'assistant') {
    const c = formatAiQuestions(content);
    return `【医生助理】 ${c}\n（AI生成内容，仅供参考，请注意甄别）`;
  }
  if (role === 'ai') {
    const c = formatAiQuestions(content);
    return `【AI自动回复】 ${c}\n（AI生成内容，仅供参考，请注意甄别）`;
  }
  if (role === 'doctor') {
    return `【医生】 ${content}`;
  }
  return content;
}

function formatChatTime(isoLike?: string): string {
  if (!isoLike) return '';
  const d = new Date(isoLike.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function renderContentWithPayLink(content: string) {
  const parts = content.split(/(\/patient\/pay\/[a-zA-Z0-9_-]+)/g);
  return parts.map((part, idx) => {
    if (/^\/patient\/pay\/[a-zA-Z0-9_-]+$/.test(part)) {
      return (
        <Link key={`${part}_${idx}`} href={part} className="text-[#07C160] underline underline-offset-2">
          {part}
        </Link>
      );
    }
    return <span key={`${idx}`}>{part}</span>;
  });
}

export default function PatientWeChatChat({ patient, initialHistory }: PatientWeChatChatProps) {
  const initialMessages = useMemo(() => initialHistory.map(parseHistoryItem), [initialHistory]);
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const doctorDisplayName = process.env.NEXT_PUBLIC_DOCTOR_NAME || '张医生';
  const doctorAvatarSrc = (doctorAvatar as unknown as { src?: string }).src || (doctorAvatar as unknown as string);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const patientAvatarText = useMemo(() => patient.name?.slice(0, 1) || '患', [patient.name]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setLoading(true);

    const tempId = `temp_${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, role: 'user', content: userMsg }]);

    try {
      const historyForAI = messages.map(
        (m): { role: 'user' | 'ai' | 'assistant' | 'doctor'; content: string } => ({
          role:
            m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : m.role === 'doctor' ? 'doctor' : 'ai',
          content: m.content,
        })
      );
      const result = await processUserMessage(patient.id, userMsg, historyForAI);
      if (result.response) {
        setMessages((prev) => [...prev, { id: `ai_${Date.now()}`, role: 'ai', content: result.response }]);
      }
    } catch (err) {
      console.error(err);
      alert('发送失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative mx-auto flex h-screen max-h-screen w-full max-w-md flex-col overflow-hidden bg-[#f2f2f2] shadow-2xl">
      <header className="z-20 flex h-14 w-full items-center justify-between bg-[#f2f2f2] px-4">
        <div className="flex items-center w-[88px]">
          <Link
            href="/patient"
            className="flex items-center text-[#181818] hover:text-gray-600 transition-colors"
            aria-label="返回"
          >
            <span className="material-symbols-outlined !text-[30px] leading-none" style={iconThinStyle}>
              arrow_back_ios_new
            </span>
          </Link>
        </div>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-[#181818] tracking-wide">{doctorDisplayName}</h1>
        <div className="flex items-center justify-end w-[88px]">
          <button
            type="button"
            className="flex items-center justify-center text-[#181818] hover:text-gray-600 transition-colors"
            aria-label="更多"
          >
            <span className="material-symbols-outlined !text-[28px] leading-none" style={iconThinStyle}>
              more_horiz
            </span>
          </button>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f2f2f2] border-t border-[#e5e5e5] no-scrollbar"
        ref={scrollRef}
      >
        {messages.length === 0 ? (
          <div className="text-center text-slate-400 mt-10">暂无对话记录</div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const timeText = formatChatTime(msg.created_at);

            return (
              <div key={msg.id} className={cn('flex items-start gap-3', isUser ? 'justify-end' : 'justify-start')}>
                {!isUser && (
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md shadow-sm bg-white">
                    <img src={doctorAvatarSrc} alt="医生头像" className="h-full w-full object-cover" draggable={false} />
                  </div>
                )}

                <div className={cn('flex max-w-[70%] flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'relative rounded-md px-3 py-2 text-[16px] leading-relaxed text-black shadow-sm',
                      isUser ? 'bg-[#95ec69]' : 'bg-white'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-3 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent',
                        isUser
                          ? '-right-[6px] border-l-[8px] border-l-[#95ec69]'
                          : '-left-[6px] border-r-[8px] border-r-white'
                      )}
                    />
                    {renderContentWithPayLink(formatPatientVisibleContent(msg.role, msg.content))}
                  </div>
                  {timeText && <div className="text-[10px] text-slate-400 px-1">{timeText}</div>}
                </div>

                {isUser && (
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md shadow-sm bg-white flex items-center justify-center text-[16px] font-semibold text-[#2e62d9]">
                    {patientAvatarText}
                  </div>
                )}
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md shadow-sm bg-white">
              <img src={doctorAvatarSrc} alt="医生头像" className="h-full w-full object-cover" draggable={false} />
            </div>
            <div className="flex max-w-[70%] flex-col gap-1">
              <div className="relative rounded-md bg-white px-3 py-2 text-[16px] leading-relaxed text-black shadow-sm">
                <span className="absolute top-3 -left-[6px] w-0 h-0 border-t-[6px] border-t-transparent border-r-[8px] border-r-white border-b-[6px] border-b-transparent" />
                <div className="flex gap-1 py-1">
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:75ms]" />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer
        className="z-20 w-full border-t border-[#e5e5e5] bg-[#f7f7f7] px-3 py-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 20px) + 1rem)' }}
      >
        <form onSubmit={handleSend} className="flex items-center gap-3">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#181818] text-[#181818]"
            aria-label="语音"
          >
            <span className="material-symbols-outlined !text-[20px] leading-none rotate-90" style={iconThinStyle}>
              wifi_tethering
            </span>
          </button>

          <div className="flex flex-1 items-center rounded-md bg-white px-3 py-[9px]">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息"
              className="w-full bg-transparent p-0 text-[16px] text-[#111711] focus:outline-none border-none h-5 leading-5"
              disabled={loading}
            />
          </div>

          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#181818]"
            aria-label="表情"
          >
            <span className="material-symbols-outlined !text-[32px] leading-none" style={iconThinStyle}>
              sentiment_satisfied
            </span>
          </button>

          {input.trim() ? (
            <button
              type="submit"
              disabled={loading}
              className="h-8 px-3 shrink-0 rounded-md bg-[#07C160] text-white text-[14px] font-medium disabled:opacity-60"
              aria-label="发送"
            >
              发送
            </button>
          ) : (
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#181818] text-[#181818]"
              aria-label="更多功能"
            >
              <span className="material-symbols-outlined !text-[22px] leading-none" style={iconThinStyle}>
                add
              </span>
            </button>
          )}
        </form>
      </footer>
    </div>
  );
}
