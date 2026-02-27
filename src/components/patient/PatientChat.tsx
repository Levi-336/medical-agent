'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Patient, ChatMessage, processUserMessage, getChatHistory } from '@/app/actions';
import { Home, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PatientChatProps {
  patients: Patient[];
}

type PatientVisibleRole = 'user' | 'assistant' | 'doctor' | 'ai';

function formatAiQuestions(content: string) {
  return content
    .replace(/([?？])(?!\s*\n)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatPatientVisibleContent(role: PatientVisibleRole, content: string) {
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

function renderContentWithPayLink(content: string) {
  const parts = content.split(/(\/patient\/pay\/[a-zA-Z0-9_-]+)/g);
  return parts.map((part, idx) => {
    if (/^\/patient\/pay\/[a-zA-Z0-9_-]+$/.test(part)) {
      return (
        <Link key={`${part}_${idx}`} href={part} className="text-blue-600 underline underline-offset-2">
          {part}
        </Link>
      );
    }
    return <span key={`${idx}`}>{part}</span>;
  });
}

export default function PatientChat({ patients }: PatientChatProps) {
  const [selectedPatientId, setSelectedPatientId] = useState<string>(patients[0]?.id || '');
  const [messages, setMessages] = useState<{ id: string; role: PatientVisibleRole; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedPatientId) {
      loadHistory(selectedPatientId);
    }
  }, [selectedPatientId]);

  useEffect(() => {
    if (!selectedPatientId) return;
    const interval = setInterval(() => {
      loadHistory(selectedPatientId);
    }, 1200);
    return () => clearInterval(interval);
  }, [selectedPatientId]);

  useEffect(() => {
    // Scroll to bottom
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadHistory = async (id: string) => {
    const history = (await getChatHistory(id)) as ChatMessage[];
    setMessages(
      history.map((h) => ({
        id: h.id.toString(),
        role: h.role,
        content: h.content,
      }))
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !selectedPatientId || loading) return;

    const userMsg = input;
    setInput('');
    setLoading(true);

    // Optimistic update
    const tempId = Date.now().toString();
    setMessages(prev => [...prev, { id: tempId, role: 'user', content: userMsg }]);

    try {
      const historyForAI = messages.map(
        (m): { role: 'user' | 'ai' | 'assistant' | 'doctor'; content: string } => ({
          role:
            m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : m.role === 'doctor' ? 'doctor' : 'ai',
          content: m.content,
        })
      );
      
      const result = await processUserMessage(selectedPatientId, userMsg, historyForAI);
      
      // If result.response is empty (e.g. medical consult that shouldn't have auto reply), 
      // we don't add an AI message.
      if (result.response) {
          setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'ai', content: result.response }]);
      }
    } catch (err) {
      console.error(err);
      alert('发送失败');
    } finally {
      setLoading(false);
    }
  };

  if (patients.length === 0) {
    return <div className="p-8 text-center text-slate-500">请先在医生助理端创建患者</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100 max-w-md mx-auto shadow-2xl overflow-hidden border-x border-slate-200">
        {/* Header */}
        <div className="bg-white p-4 shadow-sm z-10 border-b border-slate-200 flex justify-between items-center gap-2">
            <div className="flex-1">
                <label className="block text-xs font-bold text-slate-500 mb-1">当前模拟身份</label>
                <select 
                    className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-900"
                    value={selectedPatientId}
                    onChange={(e) => setSelectedPatientId(e.target.value)}
                >
                    {patients.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.gender || '—'}, {p.age != null ? `${p.age}岁` : '—'})
                        </option>
                    ))}
                </select>
            </div>
            <Link 
                href="/" 
                className="flex flex-col items-center justify-center p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition text-xs"
                title="返回首页"
            >
                <Home size={20} />
                <span className="scale-90">首页</span>
            </Link>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50" ref={scrollRef}>
            {messages.map(msg => (
                <div key={msg.id} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
                    <div className={cn(
                        "max-w-[85%] p-3 rounded-2xl text-sm shadow-sm",
                        msg.role === 'user' 
                            ? "bg-blue-600 text-white rounded-br-none" 
                            : "bg-white text-slate-800 rounded-bl-none border border-slate-100"
                    )}>
                        {renderContentWithPayLink(formatPatientVisibleContent(msg.role, msg.content))}
                    </div>
                </div>
            ))}
            {loading && (
                <div className="flex justify-start">
                    <div className="bg-white p-3 rounded-2xl rounded-bl-none border border-slate-100 shadow-sm">
                        <div className="flex gap-1">
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-75"></span>
                            <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-150"></span>
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* Input Area */}
        <form onSubmit={handleSend} className="bg-white p-4 border-t border-slate-200 flex gap-2">
            <input 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="描述你的症状..."
                className="flex-1 p-3 bg-slate-100 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-slate-900"
                disabled={loading}
            />
            <button 
                type="submit" 
                disabled={loading || !input.trim()}
                className="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
            >
                <Send size={18} />
            </button>
        </form>
    </div>
  );
}
