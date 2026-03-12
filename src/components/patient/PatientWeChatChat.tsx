'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import type { Patient, ChatMessage } from '@/app/actions';
import { processUserMessage } from '@/app/actions';
import VoiceInput from './VoiceInput';
import doctorAvatar from '@/app/character-7166558_1280.png';
import cn from 'classnames'; // 添加此行以导入 cn 函数

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
        <Link key={`${part}_${idx}`} href={part} className="text-[#53bdeb] underline underline-offset-2 hover:text-[#4a9eda]">
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
    <div className="relative mx-auto flex h-screen max-h-screen w-full max-w-md flex-col overflow-hidden bg-[#0f1419] shadow-2xl whatsapp-theme">
      <div className="h-[44px] w-full bg-[#202c33] sticky top-0 z-20 shrink-0 flex items-center justify-center">
        <div className="w-[134px] h-[20px] bg-black rounded-full"></div>
      </div>
      
      <header className="z-20 flex h-16 w-full items-center justify-between bg-[#202c33] px-4 border-b border-[#313d44]">
        <div className="flex items-center w-[50px]">
          <Link
            href="/patient"
            className="flex items-center text-[#8696a0] hover:text-white transition-colors p-1"
            aria-label="返回"
          >
            <span className="material-symbols-outlined !text-[24px] leading-none" style={iconThinStyle}>
              arrow_back
            </span>
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center gap-3">
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white">
            <img src={doctorAvatarSrc} alt="医生头像" className="h-full w-full object-cover" draggable={false} />
          </div>
          <div className="text-center">
            <h1 className="text-[16px] font-medium text-[#e9edef]">{doctorDisplayName}</h1>
            <p className="text-[12px] text-[#8696a0]">在线</p>
          </div>
        </div>
        <div className="flex items-center justify-end w-[50px]">
          <button
            type="button"
            className="flex items-center justify-center text-[#8696a0] hover:text-white transition-colors p-1"
            aria-label="更多"
          >
            <span className="material-symbols-outlined !text-[24px] leading-none" style={iconThinStyle}>
              more_vert
            </span>
          </button>
        </div>
      </header>

      <main
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0f1419] no-scrollbar"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3e%3cdefs%3e%3cpattern id='a' patternUnits='userSpaceOnUse' width='20' height='20' patternTransform='scale(0.5) rotate(0)'%3e%3crect x='0' y='0' width='100%25' height='100%25' fill='hsla(0, 0%25, 100%25, 0)'/%3e%3cpath d='M 10,-2.55e-7 V 20 Z M -1.1677362e-8,10 H 20 Z' stroke-width='0.2' stroke='hsla(0, 0%25, 100%25, 0.01)' fill='none'/%3e%3c/pattern%3e%3c/defs%3e%3crect width='100%25' height='100%25' fill='url(%23a)'/%3e%3c/svg%3e")`,
        }}
        ref={scrollRef}
      >
        {messages.length === 0 ? (
          <div className="text-center text-[#8696a0] mt-10 space-y-2">
            <div className="mb-4">
              <span className="material-symbols-outlined !text-[64px] text-[#54656f]">chat_bubble_outline</span>
            </div>
            <p className="text-[16px]">开始与医生对话</p>
            <p className="text-[13px] text-[#667781]">发送消息开始咨询</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const timeText = formatChatTime(msg.created_at);

            return (
              <div key={msg.id} className={cn('flex items-start gap-3', isUser ? 'justify-end' : 'justify-start')}>
                {!isUser && (
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm bg-white">
                    <img src={doctorAvatarSrc} alt="医生头像" className="h-full w-full object-cover" draggable={false} />
                  </div>
                )}

                <div className={cn('flex max-w-[75%] flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'relative rounded-2xl px-3 py-2.5 text-[15px] leading-relaxed shadow-sm',
                      isUser
                        ? 'bg-[#005c4b] text-[#e9edef] rounded-br-md'
                        : 'bg-[#202c33] text-[#e9edef] rounded-bl-md'
                    )}
                  >
                    <div className="whitespace-pre-wrap">
                      {renderContentWithPayLink(formatPatientVisibleContent(msg.role, msg.content))}
                    </div>
                    {/* Message status indicator for user messages */}
                    {isUser && (
                      <div className="flex items-center justify-end mt-1">
                        <span className="text-xs text-[#8ce8c7] mr-1">{timeText}</span>
                        <span className="material-symbols-outlined !text-[14px] text-[#53bdeb]">done_all</span>
                      </div>
                    )}
                  </div>
                  {!isUser && (
                    <span className="text-xs text-[#8696a0] ml-2">{timeText}</span>
                  )}
                </div>

                {isUser && (
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm bg-[#00d95f] flex items-center justify-center text-[16px] font-semibold text-white">
                    {patientAvatarText}
                  </div>
                )}
              </div>
            );
          })
        )}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm bg-white">
              <img src={doctorAvatarSrc} alt="医生头像" className="h-full w-full object-cover" draggable={false} />
            </div>
            <div className="flex max-w-[70%] flex-col gap-1">
              <div className="bg-[#202c33] p-4 rounded-2xl rounded-bl-md shadow-sm">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-[#00d95f] rounded-full animate-bounce"></span>
                  <span className="w-2 h-2 bg-[#00d95f] rounded-full animate-bounce delay-75"></span>
                  <span className="w-2 h-2 bg-[#00d95f] rounded-full animate-bounce delay-150"></span>
                </div>
              </div>
              <span className="text-xs text-[#8696a0] ml-2">正在输入...</span>
            </div>
          </div>
        )}
      </main>

      <footer
        className="z-20 w-full bg-[#202c33] px-3 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 20px) + 1rem)' }}
      >
        <form onSubmit={handleSend} className="flex items-center gap-3">
          <VoiceInput 
                onTextRecognized={(text) => {
                    setInput((prev) => prev ? prev + text : text);
                }} 
            />

          <div className="flex flex-1 items-center rounded-full bg-[#2a3942] px-4 py-2.5 min-h-[44px]">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="消息"
              className="w-full bg-transparent p-0 text-[16px] text-[#e9edef] placeholder-[#8696a0] focus:outline-none border-none h-5 leading-5"
              disabled={loading}
            />
            <button
              type="button"
              className="ml-2 p-1 text-[#8696a0] hover:text-[#e9edef] transition-colors"
              aria-label="表情"
            >
              <span className="material-symbols-outlined !text-[20px]">sentiment_satisfied</span>
            </button>
            <button
              type="button"
              className="ml-1 p-1 text-[#8696a0] hover:text-[#e9edef] transition-colors"
              aria-label="附件"
            >
              <span className="material-symbols-outlined !text-[20px]">attach_file</span>
            </button>
          </div>

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="h-11 w-11 shrink-0 rounded-full bg-[#00d95f] text-white flex items-center justify-center disabled:opacity-60 disabled:bg-[#8696a0] transition-all shadow-sm"
            aria-label="发送"
          >
            <span className="material-symbols-outlined !text-[20px]">send</span>
          </button>
        </form>
      </footer>
    </div>
  );
}
