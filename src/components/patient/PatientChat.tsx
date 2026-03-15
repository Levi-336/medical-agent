'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Patient, ChatMessage, processUserMessage, getChatHistory } from '@/app/actions';
import { Home, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import VoiceInput from "@/components/patient/VoiceInput";

interface PatientChatProps {
  patients: Patient[];
}

type PatientVisibleRole = 'user' | 'assistant' | 'doctor' | 'ai';

function formatAiQuestions(content: string) {
  return content
    .replace(/([?.!])(?!\s*\n)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatPatientVisibleContent(role: PatientVisibleRole, content: string) {
  const trimmed = content.trim();
  if (/^\[(Doctor|Assistant|AI Auto Reply)\]/.test(trimmed)) return content;

  if (role === 'assistant') {
    const c = formatAiQuestions(content);
    return `[Assistant] ${c}\n(AI-generated content for reference only)`;
  }
  if (role === 'ai') {
    const c = formatAiQuestions(content);
    return `[AI Auto Reply] ${c}\n(AI-generated content for reference only)`;
  }
  if (role === 'doctor') {
    return `[Doctor] ${content}`;
  }
  return content;
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

export default function PatientChat({ patients }: PatientChatProps) {
  const [selectedPatientId, setSelectedPatientId] = useState<string>(patients[0]?.id || '');
  const [messages, setMessages] = useState<{ id: string; role: PatientVisibleRole; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
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
      if (result.response) {
        setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'ai', content: result.response }]);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to send message.');
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceInput = (text: string) => {
    const confirmed = window.confirm(`Speech recognition result: "${text}"\nAdd it to the input box?`);
    if (confirmed) {
      setInput((prev) => (prev ? prev + text : text));
    }
    setVoiceProcessing(false);
  };

  if (patients.length === 0) {
    return <div className="p-8 text-center text-slate-500">Please create a patient in the assistant portal first.</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-[#0f1419] max-w-md mx-auto shadow-2xl overflow-hidden border-x border-[#313d44] whatsapp-theme">
      <div className="h-[44px] w-full bg-[#202c33] sticky top-0 z-20 shrink-0 flex items-center justify-center">
        <div className="w-[134px] h-[20px] bg-black rounded-full"></div>
      </div>

      <div className="bg-[#202c33] p-4 shadow-sm z-10 border-b border-[#313d44] flex justify-between items-center gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-[#8696a0] mb-2">Current simulated identity</label>
          <select
            className="w-full p-2.5 border border-[#313d44] rounded-lg text-sm bg-[#2a3942] text-[#e9edef] focus:outline-none focus:border-[#00d95f] transition-colors"
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
          >
            {patients.map(p => (
              <option key={p.id} value={p.id} className="bg-[#2a3942] text-[#e9edef]">
                {p.name} ({p.gender || '-'}, {p.age != null ? `${p.age} yrs` : '-'})
              </option>
            ))}
          </select>
        </div>
        <Link
          href="/"
          className="flex flex-col items-center justify-center p-2 text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] rounded-lg transition text-xs"
          title="Back to home"
        >
          <Home size={20} />
          <span className="scale-90 mt-0.5">Home</span>
        </Link>
      </div>

      <div
        className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0f1419]"
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
            <p className="text-[16px]">Start chatting with the doctor</p>
            <p className="text-[13px] text-[#667781]">Choose an identity and send a message to begin</p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={cn("flex", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] px-3 py-2.5 rounded-2xl text-[15px] shadow-sm whitespace-pre-wrap",
                  msg.role === 'user'
                    ? "bg-[#005c4b] text-[#e9edef] rounded-br-md"
                    : "bg-[#202c33] text-[#e9edef] rounded-bl-md"
                )}
              >
                {renderContentWithPayLink(formatPatientVisibleContent(msg.role, msg.content))}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[#202c33] p-4 rounded-2xl rounded-bl-md shadow-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-[#00d95f] rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-[#00d95f] rounded-full animate-bounce delay-75"></span>
                <span className="w-2 h-2 bg-[#00d95f] rounded-full animate-bounce delay-150"></span>
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="bg-[#202c33] p-4 flex items-center gap-3">
        <VoiceInput
          onTextRecognized={(text) => {
            setVoiceProcessing(true);
            handleVoiceInput(text);
          }}
        />

        <div className="flex-1 flex items-center rounded-full bg-[#2a3942] px-4 py-2.5 min-h-[44px]">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={voiceProcessing ? "Processing voice..." : "Message"}
            className="flex-1 bg-transparent text-[16px] text-[#e9edef] placeholder-[#8696a0] focus:outline-none border-none"
            disabled={loading || voiceProcessing}
          />
          <button
            type="button"
            className="ml-2 p-1 text-[#8696a0] hover:text-[#e9edef] transition-colors"
            aria-label="Emoji"
          >
            <span className="material-symbols-outlined !text-[20px]">sentiment_satisfied</span>
          </button>
        </div>

        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="h-11 w-11 shrink-0 rounded-full bg-[#00d95f] text-white flex items-center justify-center disabled:opacity-60 disabled:bg-[#8696a0] transition-all shadow-sm"
          aria-label="Send"
        >
          <Send size={20} />
        </button>
      </form>
    </div>
  );
}
