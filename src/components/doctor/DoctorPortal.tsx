'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { ChatMessage, DoctorConsultation, Patient } from '@/app/actions';
import { endDoctorConsultation, getChatHistory, getDoctorCopilot, getPaidDoctorConsultPatients, getPatient, getPatientMemories, sendRealDoctorMessage } from '@/app/actions';
import { Activity, Brain, FileText, Home, Lightbulb, RefreshCw, Send, Sparkles, User } from 'lucide-react';
import PatientOverview from '@/components/PatientOverview';

type DoctorPortalItem = { consultation: DoctorConsultation; patient: Patient };

export default function DoctorPortal({ initialItems }: { initialItems: DoctorPortalItem[] }) {
  type MemoryItem = { id: number; content: string; source: string | null; created_at: string };
  const [items, setItems] = useState<DoctorPortalItem[]>(initialItems);
  const [selectedConsultationId, setSelectedConsultationId] = useState<number | null>(initialItems[0]?.consultation.id ?? null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(initialItems[0]?.patient.id ?? null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(initialItems[0]?.patient ?? null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'persona' | 'info' | 'memories'>('persona');
  const [copilotSuggestion, setCopilotSuggestion] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  const [lastSuggestedMsgId, setLastSuggestedMsgId] = useState<number | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastChatMsgIdRef = useRef<number | null>(null);

  const refreshList = async () => {
    const next = await getPaidDoctorConsultPatients();
    setItems(next);
    if (selectedConsultationId && next.some((x) => x.consultation.id === selectedConsultationId)) return;
    setSelectedConsultationId(next[0]?.consultation.id ?? null);
    setSelectedPatientId(next[0]?.patient.id ?? null);
  };

  const loadChat = async (pid: string) => {
    const history = await getChatHistory(pid);
    setChatHistory(history);
  };

  const loadMemories = async (pid: string) => {
    const ms = await getPatientMemories(pid);
    setMemories(ms);
  };

  const loadPatientData = async (pid: string) => {
    const p = await getPatient(pid);
    if (p) setSelectedPatient(p);
  };

  useEffect(() => {
    if (!selectedPatientId) return;
    loadPatientData(selectedPatientId);
    loadChat(selectedPatientId);
    loadMemories(selectedPatientId);
    setCopilotSuggestion('');
    setLastSuggestedMsgId(null);
    isNearBottomRef.current = true;
    lastChatMsgIdRef.current = null;
    const interval = setInterval(() => {
      loadPatientData(selectedPatientId);
      loadChat(selectedPatientId);
      loadMemories(selectedPatientId);
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedPatientId]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshList();
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedConsultationId]);

  useEffect(() => {
    if (!chatRef.current) return;
    const lastId = chatHistory[chatHistory.length - 1]?.id ?? null;
    const prevId = lastChatMsgIdRef.current;
    lastChatMsgIdRef.current = lastId;
    if (lastId !== prevId && isNearBottomRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    if (!selectedPatientId) return;
    if (chatHistory.length === 0) return;
    const lastMsg = chatHistory[chatHistory.length - 1];
    if (lastMsg.role !== 'user') return;
    if (copilotSuggestion || isCopilotLoading) return;
    if (lastSuggestedMsgId === lastMsg.id) return;
    handleGetCopilot();
  }, [chatHistory, selectedPatientId]);

  const handleSelect = (it: DoctorPortalItem) => {
    setSelectedConsultationId(it.consultation.id);
    setSelectedPatientId(it.patient.id);
    setSelectedPatient(it.patient);
    setActiveTab('persona');
  };

  const handleEnd = async () => {
    if (!selectedConsultationId) return;
    await endDoctorConsultation(selectedConsultationId);
    const nextItems = items.filter((x) => x.consultation.id !== selectedConsultationId);
    setItems(nextItems);
    setSelectedConsultationId(nextItems[0]?.consultation.id ?? null);
    setSelectedPatientId(nextItems[0]?.patient.id ?? null);
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedPatientId || !input.trim() || sending) return;
    setSending(true);
    try {
      await sendRealDoctorMessage(selectedPatientId, input.trim());
      setInput('');
      setCopilotSuggestion('');
      await loadChat(selectedPatientId);
    } finally {
      setSending(false);
    }
  };

  const handleGetCopilot = async () => {
    if (!selectedPatientId) return;
    setIsCopilotLoading(true);
    try {
      const lastMsg = chatHistory[chatHistory.length - 1];
      if (lastMsg) setLastSuggestedMsgId(lastMsg.id);
      const suggestion = await getDoctorCopilot(selectedPatientId, 'doctor');
      setCopilotSuggestion(suggestion);
    } finally {
      setIsCopilotLoading(false);
    }
  };

  const selected = items.find((x) => x.patient.id === selectedPatientId) ?? null;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <div className="w-72 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white/80 backdrop-blur">
          <h2 className="font-bold text-slate-900">医生会话</h2>
          <Link href="/" className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition border border-blue-100">
            <Home size={14} />
            返回首页
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {items.length === 0 ? (
            <div className="p-6 text-sm text-slate-500 rounded-xl border border-dashed border-slate-200 bg-slate-50">
              暂无已支付会话
            </div>
          ) : (
            items.map((it) => (
              <div
                key={it.consultation.id}
                onClick={() => handleSelect(it)}
                className={cn(
                  'cursor-pointer rounded-xl border p-3 transition shadow-sm hover:shadow-md',
                  selectedConsultationId === it.consultation.id
                    ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white ring-1 ring-emerald-100'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 font-semibold">
                    {(it.patient.name || '患').slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900 truncate">{it.patient.name}</div>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap">
                        {(it.patient.gender || '—') + ' · ' + (it.patient.age != null ? `${it.patient.age}岁` : '—')}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="inline-flex max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 border border-slate-200">
                        {it.patient.condition || '—'}
                      </span>
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700 border border-emerald-200">
                        已支付
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col border-r border-slate-200 bg-gradient-to-b from-slate-50 to-white">
        <div className="p-4 bg-white/80 backdrop-blur border-b border-slate-200 shadow-sm z-10 flex justify-between items-center">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-9 w-9 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 font-semibold">
              {(selected?.patient.name || '患').slice(0, 1)}
            </div>
            <div className="font-bold text-lg text-slate-900 truncate">{selected ? `${selected.patient.name}` : '医生会话'}</div>
            {selected && <span className="text-xs text-slate-500 whitespace-nowrap">医生会话</span>}
          </div>
          <button
            type="button"
            onClick={handleEnd}
            disabled={!selectedConsultationId}
            className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50 transition"
          >
            结束会话
          </button>
        </div>

        <div
          ref={chatRef}
          className="flex-1 overflow-y-auto p-4 space-y-4"
          onScroll={(e) => {
            const el = e.currentTarget;
            const threshold = 80;
            isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
          }}
        >
          {selectedPatientId ? (
            chatHistory.length === 0 ? (
              <div className="text-center text-slate-400 mt-10">暂无对话记录</div>
            ) : (
              chatHistory.map((msg) => {
                const isDoctor = msg.role === 'doctor';
                const isUser = msg.role === 'user';
                const isAssistant = msg.role === 'assistant';
                const isAi = msg.role === 'ai';
                return (
                  <div
                    key={msg.id}
                    className={cn('flex flex-col mb-4', isAi ? 'items-center' : isDoctor ? 'items-end' : 'items-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[78%] px-4 py-3 text-[15px] leading-relaxed shadow-sm',
                        isDoctor
                          ? 'rounded-2xl rounded-tr-md bg-emerald-600 text-white border border-white/10'
                          : isUser
                            ? 'rounded-2xl rounded-tl-md bg-white text-slate-800 border border-slate-200'
                            : isAi
                              ? 'rounded-2xl bg-slate-100 text-slate-600 border border-slate-200'
                              : 'rounded-2xl bg-white text-slate-700 border border-slate-200'
                      )}
                    >
                      {isUser && <span className="block text-[11px] text-slate-500 mb-1 font-semibold">患者</span>}
                      {isAssistant && <span className="block text-[11px] text-slate-500 mb-1 font-semibold">医生助理</span>}
                      {isAi && <span className="block text-[11px] text-slate-500 mb-1 font-semibold">系统</span>}
                      {isDoctor && <span className="block text-xs text-white mb-1 font-bold">医生</span>}
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            <div className="text-center text-slate-400 mt-10">请先等待患者支付并接入</div>
          )}
        </div>

        <div className="p-4 bg-white/80 backdrop-blur border-t border-slate-200">
          {copilotSuggestion && (
            <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl relative shadow-sm">
              <div className="flex items-start gap-2">
                <Lightbulb className="text-amber-500 mt-0.5 flex-shrink-0" size={16} />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-amber-700 mb-1">医生建议回复 (点击填入):</h4>
                  <div className="max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-amber-200 pr-1">
                    <p
                      className="text-sm text-amber-900 cursor-pointer hover:bg-amber-100 p-1 rounded transition whitespace-pre-wrap"
                      onClick={() => setInput(copilotSuggestion)}
                    >
                      {copilotSuggestion}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-1 ml-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInput(copilotSuggestion);
                    }}
                    className="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-300 whitespace-nowrap transition"
                  >
                    填入
                  </button>
                  <button type="button" onClick={() => setCopilotSuggestion('')} className="text-amber-400 hover:text-amber-600 text-xs text-right">
                    忽略
                  </button>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSend} className="flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <button
                type="button"
                onClick={() => {
                  if (isCopilotLoading || !selectedPatientId) return;
                  handleGetCopilot();
                }}
                aria-disabled={isCopilotLoading || !selectedPatientId}
                className={cn(
                  "text-xs flex items-center gap-1 px-2 py-1 rounded-lg transition text-purple-700",
                  isCopilotLoading || !selectedPatientId ? "cursor-not-allowed text-purple-400" : "hover:bg-purple-50"
                )}
                style={{ color: isCopilotLoading || !selectedPatientId ? "#c084fc" : "#7e22ce" }}
              >
                {isCopilotLoading ? <RefreshCw className="animate-spin" size={12} /> : <Sparkles size={12} />}
                {isCopilotLoading ? '正在生成建议...' : '重新生成建议'}
              </button>
            </div>
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="医生回复... (Shift+Enter 换行)"
                className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-slate-900 resize-none h-20 shadow-sm"
                disabled={sending || !selectedPatientId}
              />
              <button
                type="submit"
                disabled={sending || !input.trim() || !selectedPatientId}
                className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition shadow-sm whitespace-nowrap h-20 flex items-center justify-center w-14"
              >
                <Send size={18} />
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="w-96 bg-white flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-white sticky top-0 z-10">
          <button
            onClick={() => setActiveTab('persona')}
            className={cn(
              'flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2',
              activeTab === 'persona' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500'
            )}
          >
            <Activity size={16} /> 画像
          </button>
          <button
            onClick={() => setActiveTab('info')}
            className={cn(
              'flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2',
              activeTab === 'info' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500'
            )}
          >
            <User size={16} /> 信息
          </button>
          <button
            onClick={() => setActiveTab('memories')}
            className={cn(
              'flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2',
              activeTab === 'memories' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500'
            )}
          >
            <Brain size={16} /> 记忆
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {selectedPatient ? (
            <>
              {activeTab === 'persona' && (
                <div className="space-y-4">
                  <PatientOverview patient={selectedPatient} memories={memories} chatHistory={chatHistory} />
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <h4 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
                      <Activity size={16} /> 当前画像
                    </h4>
                    <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
                      {selectedPatient.persona || ''}
                    </p>
                  </div>
                  <div className="text-xs text-slate-400">
                    画像会根据导入的资料和对话自动更新。
                  </div>
                </div>
              )}

              {activeTab === 'info' && (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2">
                        <FileText size={16} /> 档案详情
                      </h4>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-slate-500">ID:</span>
                        <span className="col-span-2 text-slate-900 font-mono text-xs">{selectedPatient.id}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-slate-500">姓名:</span>
                        <span className="col-span-2 text-slate-900 font-medium">{selectedPatient.name}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-slate-500">性别:</span>
                        <span className="col-span-2 text-slate-900">{selectedPatient.gender || '—'}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-slate-500">年龄:</span>
                        <span className="col-span-2 text-slate-900">{selectedPatient.age != null ? `${selectedPatient.age} 岁` : '—'}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <span className="text-slate-500">建档时间:</span>
                        <span className="col-span-2 text-slate-900">{new Date(selectedPatient.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="pt-2 border-t border-slate-100">
                        <span className="block text-slate-500 mb-1">基础病情:</span>
                        <div className="bg-red-50 text-red-700 p-2 rounded border border-red-100">
                          {selectedPatient.condition || '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'memories' && (
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-700 text-sm">最近记忆 (RAG)</h4>
                  {memories.length === 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      暂无记忆记录
                    </div>
                  ) : (
                    memories.map((m) => (
                      <div key={m.id} className="p-3 bg-white rounded-lg border border-slate-200 text-sm shadow-sm">
                        <div className="mb-1 text-slate-800">{m.content}</div>
                        <div className="flex justify-between items-center text-xs text-slate-400">
                          <span className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">{m.source}</span>
                          <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-slate-500 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">等待会话</div>
          )}
        </div>
      </div>
    </div>
  );
}
