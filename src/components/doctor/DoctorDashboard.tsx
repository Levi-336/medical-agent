'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { PatientWithConsultStatus, ChatMessage, KnowledgeItem, createPatient, updatePatient, deletePatient, importPatientData, getChatHistory, getPatientMemories, getPatientsWithConsultStatus, getPatientWithConsultStatus, sendDoctorMessage, getDoctorCopilot, getKnowledgeList, addKnowledge, importKnowledge, getMessageAnalysis, updateKnowledge, deleteKnowledge, resetPatientsAndSeedDemo, startDoctorConsultation } from '@/app/actions';
import { Plus, Upload, MessageSquare, Brain, Activity, RefreshCw, Send, User, Home, Sparkles, Lightbulb, BookOpen, Database, FileText, Trash2, Edit2, Save, X, Search, ChevronDown, ChevronUp, Stethoscope } from 'lucide-react';
import { cn } from '@/lib/utils';
import PatientOverview from '@/components/PatientOverview';

interface DoctorDashboardProps {
  initialPatients: PatientWithConsultStatus[];
}

export default function DoctorDashboard({ initialPatients }: DoctorDashboardProps) {
  type MemoryItem = { id: number; content: string; source: string | null; created_at: string };
  type MsgAnalysis = {
    related_memories: Array<{ content: string; source: string; created_at: string; score: number }>;
    related_knowledge: Array<{ content: string; category: string; score: number }>;
  };
  const [patients, setPatients] = useState<PatientWithConsultStatus[]>(initialPatients);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(initialPatients[0]?.id || null);
  const [selectedPatient, setSelectedPatient] = useState<PatientWithConsultStatus | null>(initialPatients[0] || null);
  
  // Modals & Tabs
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'persona' | 'info' | 'import' | 'memories' | 'knowledge'>('persona');
  
  // Edit Mode
  const [isEditingInfo, setIsEditingInfo] = useState(false);

  // Data
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);
  
  // Analysis View
  const [expandedMsgId, setExpandedMsgId] = useState<number | null>(null);
  const [msgAnalysis, setMsgAnalysis] = useState<MsgAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Import State
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  
  // Knowledge Base State
  const [kbInput, setKbInput] = useState('');
  const [isKbAdding, setIsKbAdding] = useState(false);
  const [editingKbId, setEditingKbId] = useState<number | null>(null);
  const [editKbContent, setEditKbContent] = useState('');

  // Chat Input & Copilot
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copilotSuggestion, setCopilotSuggestion] = useState('');
  const [isCopilotLoading, setIsCopilotLoading] = useState(false);
  // Track the last user message ID we generated a suggestion for
  const [lastSuggestedMsgId, setLastSuggestedMsgId] = useState<number | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const lastChatMsgIdRef = useRef<number | null>(null);

  // Auto-scroll only when new messages arrive and user is near bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      const lastId = chatHistory[chatHistory.length - 1]?.id ?? null;
      const prevId = lastChatMsgIdRef.current;
      lastChatMsgIdRef.current = lastId;
      if (lastId !== prevId && isNearBottomRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
    }
  }, [chatHistory]);

  // Load patient details when selection changes
  useEffect(() => {
    if (selectedPatientId) {
      setIsEditingInfo(false); // Reset edit mode on switch
      isNearBottomRef.current = true;
      lastChatMsgIdRef.current = null;
      // 1. Instant update from local list to prevent UI lag/mix-up
      const localPatient = patients.find(p => p.id === selectedPatientId);
      if (localPatient) {
          setSelectedPatient(localPatient);
      }
      
      // 2. Fetch fresh data (persona, etc.)
      loadPatientData(selectedPatientId);
      
      // Set up polling for chat
      const interval = setInterval(() => loadChat(selectedPatientId), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedPatientId]);

  // Load KB on mount
  useEffect(() => {
      loadKnowledge();
  }, []);

  const loadKnowledge = async () => {
      const list = await getKnowledgeList();
      setKnowledgeList(list);
  };

  const handleAddKnowledge = async () => {
      if (!kbInput.trim()) return;
      setIsKbAdding(true);
      try {
          // Detect if multiline (batch import) or single line
          if (kbInput.includes('\n')) {
              await importKnowledge(kbInput);
              alert('批量导入知识库成功！');
          } else {
              await addKnowledge(kbInput);
              alert('添加知识条目成功！');
          }
          setKbInput('');
          loadKnowledge();
      } catch (e) {
          console.error(e);
          alert('操作失败');
      } finally {
          setIsKbAdding(false);
      }
  };

  const handleDeleteKb = async (id: number) => {
    if (!confirm('确定删除该知识条目吗？')) return;
    await deleteKnowledge(id);
    loadKnowledge();
  };

  const startEditKb = (k: KnowledgeItem) => {
    setEditingKbId(k.id);
    setEditKbContent(k.content);
  };

  const saveEditKb = async (id: number) => {
    if (!editKbContent.trim()) return;
    await updateKnowledge(id, editKbContent);
    setEditingKbId(null);
    setEditKbContent('');
    loadKnowledge();
  };

  // Auto-trigger copilot when new user message arrives (simple logic: if last msg is User)
  useEffect(() => {
    if (chatHistory.length > 0) {
      const lastMsg = chatHistory[chatHistory.length - 1];
      if (lastMsg.role === 'user') {
        // 自动触发建议
        // 增加去重逻辑：如果已经有 Copilot 建议了，或者正在加载，就不重复触发
        // 但如果用户连发两条，我们可能想更新建议？
        // 简单起见，只要是 User 消息且当前没有建议，就触发
        // FIX: Check if we already suggested for this message ID (ignored case)
        if (!copilotSuggestion && !isCopilotLoading && lastSuggestedMsgId !== lastMsg.id) {
             handleGetCopilot();
        }
      }
    }
  }, [chatHistory]);

  const toggleAnalysis = async (msgId: number) => {
      if (expandedMsgId === msgId) {
          setExpandedMsgId(null);
          setMsgAnalysis(null);
          return;
      }
      
      setExpandedMsgId(msgId);
      setIsAnalyzing(true);
      if (selectedPatientId) {
        const analysis = await getMessageAnalysis(msgId, selectedPatientId);
        setMsgAnalysis(analysis);
      }
      setIsAnalyzing(false);
  };

  const loadPatientData = async (id: string) => {
    const p = await getPatientWithConsultStatus(id);
    if (p) setSelectedPatient(p);
    loadChat(id);
    loadMemories(id);
    setCopilotSuggestion(''); // Reset suggestion on switch
    setLastSuggestedMsgId(null); // Reset suggestion tracking
  };

  const loadChat = async (id: string) => {
    const history = await getChatHistory(id);
    setChatHistory(history);
  };

  const loadMemories = async (id: string) => {
    const mems = await getPatientMemories(id);
    setMemories(mems);
  };

  const handleCreatePatient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const result = await createPatient(formData);
    if (result.success) {
      setShowAddModal(false);
      // Refresh list
      const newPatients = await getPatientsWithConsultStatus();
      setPatients(newPatients);
      setSelectedPatientId(result.id); // Select new patient
    }
  };

  const handleResetDemo = async () => {
    if (!confirm('将清空所有患者与对话记录，并重建演示数据。确定继续吗？')) return;
    await resetPatientsAndSeedDemo();
    const newPatients = await getPatientsWithConsultStatus();
    setPatients(newPatients);
    if (newPatients.length > 0) {
      setSelectedPatientId(newPatients[0].id);
    } else {
      setSelectedPatientId(null);
      setSelectedPatient(null);
    }
  };

  const handleUpdatePatient = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!selectedPatientId) return;
      
      const formData = new FormData(e.currentTarget);
      const result = await updatePatient(selectedPatientId, formData);
      if (result.success) {
          setIsEditingInfo(false);
          // Refresh patient list and current patient data
          const newPatients = await getPatientsWithConsultStatus();
          setPatients(newPatients);
          loadPatientData(selectedPatientId);
      } else {
          alert('更新失败');
      }
  };

  const handleDeletePatient = async () => {
      if (!selectedPatientId || !confirm('确定要删除该患者档案吗？此操作不可恢复。')) return;
      
      const result = await deletePatient(selectedPatientId);
      if (result.success) {
          const newPatients = await getPatientsWithConsultStatus();
          setPatients(newPatients);
          // Select another patient if available
          if (newPatients.length > 0) {
              setSelectedPatientId(newPatients[0].id);
          } else {
              setSelectedPatientId(null);
              setSelectedPatient(null);
          }
      } else {
          alert('删除失败');
      }
  };

  const handleImport = async () => {
    if (!selectedPatientId || !importText.trim()) return;
    setIsImporting(true);
    try {
      await importPatientData(selectedPatientId, importText);
      setImportText('');
      alert('资料分析并导入成功！');
      // Refresh data
      loadPatientData(selectedPatientId);
    } catch (err) {
      console.error(err);
      alert('导入失败');
    } finally {
      setIsImporting(false);
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedPatientId || !inputMessage.trim() || isSending) return;

    setIsSending(true);
    try {
      await sendDoctorMessage(selectedPatientId, inputMessage);
      setInputMessage('');
      setCopilotSuggestion(''); // Clear suggestion after sending
      loadChat(selectedPatientId);
    } catch (err) {
      console.error(err);
      alert('发送失败');
    } finally {
      setIsSending(false);
    }
  };

  const handleGetCopilot = async () => {
    if (!selectedPatientId) return;
    setIsCopilotLoading(true);
    try {
      // Record the ID of the last message we are generating for
      if (chatHistory.length > 0) {
          setLastSuggestedMsgId(chatHistory[chatHistory.length - 1].id);
      }
      const suggestion = await getDoctorCopilot(selectedPatientId, 'assistant');
      setCopilotSuggestion(suggestion);
    } catch (err) {
      console.error(err);
    } finally {
      setIsCopilotLoading(false);
    }
  };
 
  const handleStartDoctorConsultation = async () => {
    if (!selectedPatientId) return;
    try {
      const { payLink } = await startDoctorConsultation(selectedPatientId, 'manual');
      const msg = `如需医生会诊，请点击链接完成支付：${payLink}（演示版本：点击即视为已支付）`;
      await sendDoctorMessage(selectedPatientId, msg);
      loadChat(selectedPatientId);
    } catch (err) {
      console.error(err);
      alert('发起失败');
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar: Patient List */}
      <div className="w-72 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white/80 backdrop-blur">
          <h2 className="font-bold text-slate-900">患者列表</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetDemo}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition"
              title="重建演示数据"
              type="button"
            >
              <Database size={20} />
            </button>
            <button 
              onClick={() => setShowAddModal(true)}
              className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition"
              title="新增患者"
              type="button"
            >
              <Plus size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {patients.map(p => (
            <div 
              key={p.id}
              onClick={() => setSelectedPatientId(p.id)}
              className={cn(
                "cursor-pointer rounded-xl border p-3 transition shadow-sm hover:shadow-md",
                selectedPatientId === p.id
                  ? "border-blue-200 bg-gradient-to-r from-blue-50 to-white ring-1 ring-blue-100"
                  : "border-slate-200 bg-white hover:border-slate-300"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "h-10 w-10 rounded-full border flex items-center justify-center font-semibold",
                    p.hasActiveConsultation
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-slate-100 border-slate-200 text-slate-700"
                  )}
                >
                  {(p.name || '患').slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                      {p.hasActiveConsultation && (
                        <span className="inline-flex shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 border border-emerald-200 whitespace-nowrap">
                          已建立医生会话
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 whitespace-nowrap">
                      {(p.gender || '—') + ' · ' + (p.age != null ? `${p.age}岁` : '—')}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 border border-slate-200">
                      {p.condition || '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      {selectedPatient ? (
        <>
          {/* Middle: Chat Window */}
          <div className="flex-1 flex flex-col border-r border-slate-200 bg-gradient-to-b from-slate-50 to-white">
            <div className="p-4 bg-white/80 backdrop-blur border-b border-slate-200 shadow-sm z-10 flex justify-between items-center">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={cn(
                    "h-9 w-9 rounded-full border flex items-center justify-center font-semibold",
                    selectedPatient.hasActiveConsultation
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-blue-50 border-blue-100 text-blue-700"
                  )}
                >
                  {(selectedPatient.name || '患').slice(0, 1)}
                </div>
                <h3 className="font-bold text-lg text-slate-900 truncate">{selectedPatient.name}</h3>
                {selectedPatient.hasActiveConsultation && (
                  <span className="text-xs text-emerald-700 whitespace-nowrap">已建立医生会话</span>
                )}
                <span className="text-xs text-slate-500 whitespace-nowrap">实时对话</span>
              </div>
              <Link 
                  href="/" 
                  className="flex items-center gap-1 text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition border border-blue-100"
                  title="返回首页"
              >
                  <Home size={14} />
                  <span>返回首页</span>
              </Link>
            </div>
            <div
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4"
              onScroll={(e) => {
                const el = e.currentTarget;
                const threshold = 80;
                isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
              }}
            >
              {chatHistory.length === 0 ? (
                <div className="text-center text-slate-400 mt-10">暂无对话记录</div>
              ) : (
                chatHistory.map(msg => {
                    const isUser = msg.role === 'user';
                    const isDoctor = msg.role === 'assistant';
                    const isAI = msg.role === 'ai';
                    const text = msg.content;

                    return (
                        <div
                          key={msg.id}
                          className={cn(
                            'flex flex-col mb-4',
                            isAI ? 'items-center' : isDoctor ? 'items-end' : 'items-start'
                          )}
                        >
                            <div
                              className={cn(
                                'max-w-[78%] px-4 py-3 text-[15px] leading-relaxed shadow-sm',
                                isAI
                                  ? 'rounded-2xl bg-slate-100 text-slate-600 border border-slate-200'
                                  : isDoctor
                                    ? 'rounded-2xl rounded-tr-md bg-blue-600 text-white border border-white/10'
                                    : 'rounded-2xl rounded-tl-md bg-white text-slate-800 border border-slate-200'
                              )}
                            >
                                {isUser && <span className="block text-[11px] text-slate-500 mb-1 font-semibold">患者</span>}
                                {isDoctor && <span className="block text-xs text-white mb-1 font-bold">医生助理</span>}
                                {isAI && <span className="block text-[11px] text-slate-500 mb-1 font-semibold">系统</span>}
                                <span className="whitespace-pre-wrap">{text}</span>
                            </div>

                            {/* Analysis Button for User Messages */}
                            {isUser && (
                                <div className={cn("mt-1 w-full max-w-[80%]", isDoctor ? "self-end" : "self-start")}>
                                    <button 
                                        onClick={() => toggleAnalysis(msg.id)}
                                        className="text-xs text-slate-600 hover:text-blue-700 flex items-center gap-1 transition"
                                    >
                                        {expandedMsgId === msg.id ? <ChevronUp size={12}/> : <Search size={12}/>}
                                        {expandedMsgId === msg.id ? '收起分析' : '查看 AI 提取与关联'}
                                    </button>
                                    
                                    {expandedMsgId === msg.id && (
                                        <div className="mt-2 bg-slate-50 border border-slate-200 rounded p-3 text-xs animate-in slide-in-from-top-2">
                                            {isAnalyzing ? (
                                                <div className="flex items-center gap-2 text-slate-500">
                                                    <RefreshCw className="animate-spin" size={12}/> 正在检索关联记忆与知识...
                                                </div>
                                            ) : msgAnalysis ? (
                                                <div className="space-y-3">
                                                    <div>
                                                        <h5 className="font-bold text-slate-700 mb-1 flex items-center gap-1">
                                                            <Brain size={12} className="text-purple-500"/> 关联记忆 (RAG)
                                                        </h5>
                                                        {msgAnalysis.related_memories.length > 0 ? (
                                                            <ul className="space-y-1">
                                                                {msgAnalysis.related_memories.map((m, idx: number) => (
                                                                    <li key={idx} className="bg-white p-1.5 rounded border border-slate-100 text-slate-600">
                                                                        {m.content} <span className="text-slate-300 ml-1">({(m.score * 100).toFixed(0)}%)</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        ) : <span className="text-slate-400 italic">无强关联记忆</span>}
                                                    </div>
                                                    
                                                    <div>
                                                        <h5 className="font-bold text-slate-700 mb-1 flex items-center gap-1">
                                                            <BookOpen size={12} className="text-green-500"/> 关联知识库
                                                        </h5>
                                                        {msgAnalysis.related_knowledge.length > 0 ? (
                                                            <ul className="space-y-1">
                                                                {msgAnalysis.related_knowledge.map((k, idx: number) => (
                                                                    <li key={idx} className="bg-white p-1.5 rounded border border-slate-100 text-slate-600">
                                                                        <span className="text-green-600 font-bold mr-1">[{k.category}]</span>
                                                                        {k.content} <span className="text-slate-300 ml-1">({(k.score * 100).toFixed(0)}%)</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        ) : <span className="text-slate-400 italic">无强关联知识</span>}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-red-400">无法获取分析数据</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Time */}
                            <div className={cn("text-[10px] text-slate-400 mt-1 px-1", isAI && "text-center")}>
                                {new Date(msg.created_at).toLocaleTimeString()}
                            </div>
                        </div>
                    );
                })
              )}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white/80 backdrop-blur border-t border-slate-200">
                {/* Copilot Suggestion Area */}
                {copilotSuggestion && (
                    <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl relative shadow-sm">
                        <div className="flex items-start gap-2">
                            <Lightbulb className="text-amber-500 mt-0.5 flex-shrink-0" size={16} />
                            <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-bold text-amber-700 mb-1">医生助理建议回复 (点击填入):</h4>
                                <div className="max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-amber-200 pr-1">
                                    <p className="text-sm text-amber-900 cursor-pointer hover:bg-amber-100 p-1 rounded transition whitespace-pre-wrap" 
                                    onClick={() => setInputMessage(copilotSuggestion)}>
                                        {copilotSuggestion}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col gap-1 ml-2">
                                <button 
                                    onClick={() => {
                                        setInputMessage(copilotSuggestion);
                                    }}
                                    className="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded-lg hover:bg-amber-300 whitespace-nowrap transition"
                                >
                                    填入
                                </button>
                                <button onClick={() => setCopilotSuggestion('')} className="text-amber-400 hover:text-amber-600 text-xs text-right">忽略</button>
                            </div>
                        </div>
                    </div>
                )}
                
                <form onSubmit={handleSendMessage} className="flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                        <button 
                            type="button"
                            onClick={() => {
                              if (isCopilotLoading) return;
                              handleGetCopilot();
                            }}
                            aria-disabled={isCopilotLoading}
                            className={cn(
                              "text-xs flex items-center gap-1 px-2 py-1 rounded-lg transition text-purple-700",
                              isCopilotLoading ? "cursor-not-allowed text-purple-400" : "hover:bg-purple-50"
                            )}
                            style={{ color: isCopilotLoading ? "#c084fc" : "#7e22ce" }}
                        >
                            {isCopilotLoading ? <RefreshCw className="animate-spin" size={12}/> : <Sparkles size={12}/>}
                            {isCopilotLoading ? '正在生成建议...' : '重新生成建议'}
                        </button>
                        <button
                            type="button"
                            onClick={handleStartDoctorConsultation}
                            className="text-xs flex items-center gap-1 text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg transition border border-emerald-100"
                        >
                            发起医生会诊
                        </button>
                    </div>
                    <div className="flex gap-2 items-end">
                        <textarea 
                            value={inputMessage}
                            onChange={(e) => setInputMessage(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            placeholder="输入回复... (Shift+Enter 换行)"
                            className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-slate-900 resize-none h-20 shadow-sm"
                            disabled={isSending}
                        />
                        <button 
                            type="submit" 
                            disabled={isSending || !inputMessage.trim()}
                            className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition shadow-sm whitespace-nowrap h-20 flex items-center justify-center w-14"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </form>
            </div>
          </div>

          {/* Right: Intelligence Panel */}
          <div className="w-96 bg-white flex flex-col">
            {/* Tabs */}
            <div className="flex border-b border-slate-200">
              <button 
                onClick={() => setActiveTab('persona')}
                className={cn("flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2", activeTab === 'persona' ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500")}
              >
                <Activity size={16} /> 画像
              </button>
              <button 
                onClick={() => setActiveTab('info')}
                className={cn("flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2", activeTab === 'info' ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500")}
              >
                <User size={16} /> 信息
              </button>
              <button 
                onClick={() => setActiveTab('import')}
                className={cn("flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2", activeTab === 'import' ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500")}
              >
                <Upload size={16} /> 导入
              </button>
              <button 
                onClick={() => setActiveTab('memories')}
                className={cn("flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2", activeTab === 'memories' ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500")}
              >
                <Brain size={16} /> 记忆
              </button>
              <button 
                onClick={() => setActiveTab('knowledge')}
                className={cn("flex-1 p-3 text-sm font-medium flex justify-center items-center gap-2", activeTab === 'knowledge' ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500")}
              >
                <BookOpen size={16} /> 知识库
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'persona' && (
                <div className="space-y-4">
                  <PatientOverview patient={selectedPatient} memories={memories} chatHistory={chatHistory} />
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                    <h4 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
                        <Activity size={16}/> 当前画像
                    </h4>
                    <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
                      {selectedPatient.persona}
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
                            <FileText size={16}/> 档案详情
                        </h4>
                        {!isEditingInfo ? (
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setIsEditingInfo(true)}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition"
                                    title="编辑"
                                >
                                    <Edit2 size={16} />
                                </button>
                                <button 
                                    onClick={handleDeletePatient}
                                    className="p-1.5 text-red-600 hover:bg-red-50 rounded transition"
                                    title="删除"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ) : (
                            <button 
                                onClick={() => setIsEditingInfo(false)}
                                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded transition"
                                title="取消"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                    
                    {!isEditingInfo ? (
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
                    ) : (
                        <form onSubmit={handleUpdatePatient} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700">姓名</label>
                                <input name="name" defaultValue={selectedPatient.name} required className="w-full p-2 border rounded mt-1 text-slate-900 text-sm" />
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-slate-700">年龄</label>
                                <input name="age" type="number" defaultValue={selectedPatient.age ?? ''} required className="w-full p-2 border rounded mt-1 text-slate-900 text-sm" />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-slate-700">性别</label>
                                    <select name="gender" defaultValue={selectedPatient.gender ?? ''} className="w-full p-2 border rounded mt-1 text-slate-900 text-sm">
                                        <option>男</option>
                                        <option>女</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700">基础病情</label>
                                <textarea 
                                    name="condition" 
                                    defaultValue={selectedPatient.condition ?? ''} 
                                    required 
                                    className="w-full p-2 border rounded mt-1 text-slate-900 text-sm h-32 resize-none" 
                                />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button type="submit" className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
                                    <Save size={14} /> 保存
                                </button>
                            </div>
                        </form>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'import' && (
                <div className="space-y-4">
                  <textarea
                    className="w-full h-48 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-sm text-slate-900"
                    placeholder="在此粘贴患者过往病历、检查报告文本..."
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                  <button
                    onClick={handleImport}
                    disabled={isImporting || !importText.trim()}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex justify-center items-center gap-2"
                  >
                    {isImporting ? <RefreshCw className="animate-spin" size={16} /> : <Brain size={16} />}
                    AI 分析并导入
                  </button>
                  <p className="text-xs text-slate-500">
                    AI 将自动提取关键事实存入向量库，并更新患者画像。
                  </p>
                </div>
              )}

              {activeTab === 'memories' && (
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-700 text-sm">最近记忆 (RAG)</h4>
                  {memories.map((m) => (
                    <div key={m.id} className="p-3 bg-slate-50 rounded border border-slate-100 text-sm">
                      <div className="mb-1 text-slate-800">{m.content}</div>
                      <div className="flex justify-between items-center text-xs text-slate-400">
                        <span className="bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">{m.source}</span>
                        <span>{new Date(m.created_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'knowledge' && (
                  <div className="space-y-4">
                      <div className="bg-slate-50 p-3 rounded border border-slate-200">
                          <h4 className="font-bold text-slate-700 text-sm mb-2">添加知识 (支持批量)</h4>
                          <textarea
                              className="w-full h-24 p-2 border border-slate-300 rounded text-sm text-slate-900 resize-none mb-2"
                              placeholder="输入通用知识，例如：&#10;门诊时间：周一至周五 8:00-17:00&#10;挂号费：普通号10元，专家号50元"
                              value={kbInput}
                              onChange={(e) => setKbInput(e.target.value)}
                          />
                          <button
                              onClick={handleAddKnowledge}
                              disabled={isKbAdding || !kbInput.trim()}
                              className="w-full py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50 flex justify-center items-center gap-2"
                          >
                              {isKbAdding ? <RefreshCw className="animate-spin" size={14} /> : <Database size={14} />}
                              存入知识库
                          </button>
                      </div>

                      <div className="space-y-2">
                          <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                              <BookOpen size={14}/> 现有知识条目 ({knowledgeList.length})
                          </h4>
                          <div className="max-h-[300px] overflow-y-auto space-y-2">
                              {knowledgeList.length === 0 ? (
                                  <div className="text-center text-xs text-slate-400 py-4">暂无知识库内容</div>
                              ) : (
                                  knowledgeList.map((k) => (
                                      <div key={k.id} className="p-2 bg-white rounded border border-slate-100 text-xs shadow-sm group relative">
                                          {editingKbId === k.id ? (
                                            <div className="space-y-2">
                                              <textarea 
                                                className="w-full p-1 border rounded text-xs text-slate-900"
                                                value={editKbContent}
                                                onChange={(e) => setEditKbContent(e.target.value)}
                                              />
                                              <div className="flex gap-2 justify-end">
                                                <button onClick={() => setEditingKbId(null)} className="text-slate-600 hover:text-slate-800">取消</button>
                                                <button onClick={() => saveEditKb(k.id)} className="text-blue-600 hover:text-blue-700 font-bold">保存</button>
                                              </div>
                                            </div>
                                          ) : (
                                            <>
                                              <div className="text-slate-800 mb-1 pr-12">{k.content}</div>
                                              <div className="text-slate-400 scale-90 origin-left">{new Date(k.created_at).toLocaleDateString()}</div>
                                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                                  <button onClick={() => startEditKb(k)} className="p-1 hover:bg-slate-100 rounded text-blue-500" title="编辑">
                                                      <Edit2 size={12}/>
                                                  </button>
                                                  <button onClick={() => handleDeleteKb(k.id)} className="p-1 hover:bg-slate-100 rounded text-red-500" title="删除">
                                                      <Trash2 size={12}/>
                                                  </button>
                                              </div>
                                            </>
                                          )}
                                      </div>
                                  ))
                              )}
                          </div>
                      </div>
                  </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-400">
          请选择或创建一个患者
        </div>
      )}

      {/* Add Patient Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-96 shadow-xl">
            <h3 className="text-xl font-bold mb-4 text-slate-900">新增患者</h3>
            <form onSubmit={handleCreatePatient} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700">姓名</label>
                <input name="name" required className="w-full p-2 border rounded mt-1 text-slate-900" />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700">年龄</label>
                  <input name="age" type="number" required className="w-full p-2 border rounded mt-1 text-slate-900" />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700">性别</label>
                  <select name="gender" className="w-full p-2 border rounded mt-1 text-slate-900">
                    <option>男</option>
                    <option>女</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">基础病情</label>
                <input name="condition" required className="w-full p-2 border rounded mt-1 text-slate-900" placeholder="e.g. 高血压, 糖尿病" />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded">取消</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
