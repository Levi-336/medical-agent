'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Patient, LastDialogueMessage } from '@/app/actions';
import { getLastDialogueMessage } from '@/app/actions';
import doctorAvatar from '@/app/character-7166558_1280.png';

interface PatientInboxProps {
  patients: Patient[];
}

const tabIconBaseStyle: React.CSSProperties = {
  fontVariationSettings: "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24",
};

const tabIconActiveStyle: React.CSSProperties = {
  fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24",
};

const avatarIconStyle: React.CSSProperties = {
  fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
};

type TabKey = 'wechat' | 'contacts' | 'discover' | 'me';

function formatListTime(isoLike: string | null): string {
  if (!isoLike) return '';
  const d = new Date(isoLike.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function formatPreview(content: string | null): string {
  if (!content) return '暂无消息';
  return content
    .replace(/^User:\s*/i, '')
    .replace(/^AI:\s*/i, '')
    .replace(/^Doctor:\s*/i, '')
    .trim();
}

function formatPreviewFromRow(row: LastDialogueMessage | null): string {
  if (!row) return '暂无消息';
  return formatPreview(row.content);
}

function formatTimeFromRow(row: LastDialogueMessage | null): string {
  if (!row) return '';
  return formatListTime(row.created_at);
}

export default function PatientInbox({ patients }: PatientInboxProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('wechat');
  const [selectedPatientId, setSelectedPatientId] = useState<string>(patients[0]?.id || '');
  const [lastMsg, setLastMsg] = useState<LastDialogueMessage | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const doctorDisplayName = process.env.NEXT_PUBLIC_DOCTOR_NAME || '张医生';
  const doctorAvatarSrc = (doctorAvatar as unknown as { src?: string }).src || (doctorAvatar as unknown as string);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  const selectedPatient = useMemo(
    () => patients.find((p) => p.id === selectedPatientId) || null,
    [patients, selectedPatientId]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedPatientId) {
        setLastMsg(null);
        return;
      }
      const row = await getLastDialogueMessage(selectedPatientId);
      if (!cancelled) setLastMsg(row);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedPatientId]);

  const wechatItems = useMemo(() => {
    const items: Array<{
      key: string;
      href: string;
      title: string;
      time: string;
      preview: string;
      avatarKind?: 'doctorPhoto';
      avatarText?: string;
      avatarIcon?: string;
      avatarIconSize?: number;
      avatarBg: string;
      muted?: boolean;
    }> = [
      {
        key: 'filehelper',
        href: '/patient/fake/filehelper',
        title: '文件传输助手',
        time: '昨天',
        preview: '欢迎使用文件传输助手',
        avatarIcon: 'folder',
        avatarIconSize: 30,
        avatarBg: '#07c160',
      },
      {
        key: 'official',
        href: '/patient/fake/official',
        title: '订阅号消息',
        time: '上周',
        preview: '今日要闻：AI 医疗应用加速落地…',
        avatarIcon: 'rss_feed',
        avatarIconSize: 32,
        avatarBg: '#2e62d9',
      },
      {
        key: 'wechatpay',
        href: '/patient/fake/wechatpay',
        title: '微信支付',
        time: '1个月前',
        preview: '微信支付凭证',
        avatarIcon: 'payments',
        avatarIconSize: 28,
        avatarBg: '#fa9d3b',
      },
    ];

    if (selectedPatient) {
      items.unshift({
        key: `doctor_${selectedPatient.id}`,
        href: `/patient/chat/${encodeURIComponent(selectedPatient.id)}`,
        title: doctorDisplayName,
        time: formatTimeFromRow(lastMsg),
        preview: formatPreviewFromRow(lastMsg),
        avatarKind: 'doctorPhoto',
        avatarBg: '#ffffff',
      });
    }
    return items;
  }, [doctorDisplayName, lastMsg, selectedPatient]);

  const filteredWechatItems = useMemo(() => {
    if (!searchQuery.trim()) return wechatItems;
    return wechatItems.filter(item => 
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.preview.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [wechatItems, searchQuery]);

  return (
    <div className="flex justify-center bg-[#111b21] whatsapp-theme">
      <div className="relative mx-auto flex h-screen max-h-screen w-full max-w-md flex-col overflow-hidden bg-[#111b21] shadow-2xl">
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 top-24 z-50 flex justify-center" aria-live="polite">
            <div className="rounded-lg bg-black/80 px-4 py-2 text-[14px] text-white backdrop-blur-sm">{toast}</div>
          </div>
        )}
        <div className="h-[44px] w-full bg-[#202c33] sticky top-0 z-20 shrink-0 flex items-center justify-center">
          <div className="w-[134px] h-[20px] bg-black rounded-full"></div>
        </div>

        <header className="bg-[#202c33] sticky top-[44px] z-20 px-4 py-3 border-b border-[#313d44]">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-[20px] font-semibold text-white">
              微信
            </h1>
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="text-[#8696a0] hover:text-white transition-colors p-1"
                aria-label="搜索"
              >
                <span className="material-symbols-outlined !text-[22px] leading-none">search</span>
              </button>
              <button
                type="button"
                className="text-[#8696a0] hover:text-white transition-colors p-1"
                aria-label="添加"
              >
                <span className="material-symbols-outlined !text-[22px] leading-none">add</span>
              </button>
              <button
                type="button"
                className="text-[#8696a0] hover:text-white transition-colors p-1"
                aria-label="更多"
              >
                <span className="material-symbols-outlined !text-[22px] leading-none">more_vert</span>
              </button>
            </div>
          </div>
          
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
              <span className="material-symbols-outlined text-[#8696a0] !text-[18px]">search</span>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索"
              className="w-full bg-[#2a3942] text-white placeholder-[#8696a0] rounded-lg pl-10 pr-4 py-2 text-[15px] focus:outline-none focus:bg-[#3b4a54] transition-colors"
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto w-full bg-[#111b21]">
          {activeTab === 'wechat' && (
            <div className="flex flex-col w-full">
              {patients.length === 0 ? (
                <div className="p-8 text-center text-[#8696a0]">
                  <div className="mb-2">
                    <span className="material-symbols-outlined !text-[48px] text-[#54656f]">chat_bubble_outline</span>
                  </div>
                  <p className="text-[#8696a0]">暂无对话</p>
                  <p className="text-[13px] text-[#667781] mt-1">开始与医生的对话吧</p>
                </div>
              ) : (
                filteredWechatItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-[#202c33] transition-colors group"
                  >
                    <div className="relative">
                      {item.avatarKind === 'doctorPhoto' ? (
                        <div className="h-[49px] w-[49px] shrink-0 overflow-hidden rounded-full bg-white">
                          <img 
                            src={doctorAvatarSrc} 
                            alt="医生头像" 
                            className="h-full w-full object-cover" 
                          />
                        </div>
                      ) : (
                        <div
                          className="h-[49px] w-[49px] shrink-0 overflow-hidden rounded-full flex items-center justify-center text-white"
                          style={{ backgroundColor: item.avatarBg }}
                        >
                          {item.avatarIcon ? (
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: item.avatarIconSize || 24 }}
                            >
                              {item.avatarIcon}
                            </span>
                          ) : (
                            <span className="text-[18px] font-medium">{item.avatarText}</span>
                          )}
                        </div>
                      )}
                      {item.key.includes('doctor') && (
                        <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-[#00d95f] border-2 border-[#111b21] rounded-full flex items-center justify-center">
                          <span className="w-2 h-2 bg-white rounded-full"></span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 border-b border-[#313d44] group-last:border-b-0 pb-3">
                      <div className="flex justify-between items-start mb-1">
                        <h2 className="text-[16px] font-normal text-[#e9edef] truncate pr-2">
                          {item.title}
                        </h2>
                        <span className="text-[12px] text-[#8696a0] flex-shrink-0">
                          {item.time}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <p className="text-[14px] text-[#8696a0] truncate pr-2 flex-1">
                          {item.preview}
                        </p>
                        {item.key.includes('doctor') && (
                          <div className="flex-shrink-0">
                            <div className="w-5 h-5 bg-[#25d366] rounded-full flex items-center justify-center ml-2">
                              <span className="material-symbols-outlined !text-[12px] text-white">done_all</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))
              )}
              <div className="h-24 bg-[#111b21]" />
            </div>
          )}

          {activeTab === 'contacts' && (
            <div className="p-8 text-center text-[#8696a0]">
              <div className="mb-4">
                <span className="material-symbols-outlined !text-[48px] text-[#54656f]">group</span>
              </div>
              <p>通讯录</p>
              <p className="text-[13px] text-[#667781] mt-1">功能开发中</p>
            </div>
          )}
          {activeTab === 'discover' && (
            <div className="p-8 text-center text-[#8696a0]">
              <div className="mb-4">
                <span className="material-symbols-outlined !text-[48px] text-[#54656f]">explore</span>
              </div>
              <p>发现</p>
              <p className="text-[13px] text-[#667781] mt-1">功能开发中</p>
            </div>
          )}
          {activeTab === 'me' && (
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-4 p-4 bg-[#202c33] rounded-lg">
                <div className="h-16 w-16 bg-[#25d366] rounded-full flex items-center justify-center text-white text-xl font-semibold">
                  患
                </div>
                <div>
                  <h3 className="text-[#e9edef] text-[17px] font-medium">患者</h3>
                  <p className="text-[#8696a0] text-[14px]">微信号: patient_demo</p>
                </div>
              </div>
              
              <div className="space-y-1">
                <button className="w-full flex items-center gap-3 p-3 hover:bg-[#202c33] rounded-lg transition-colors text-left">
                  <span className="material-symbols-outlined text-[#8696a0] !text-[22px]">settings</span>
                  <span className="text-[#e9edef] text-[16px]">设置</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 hover:bg-[#202c33] rounded-lg transition-colors text-left">
                  <span className="material-symbols-outlined text-[#8696a0] !text-[22px]">support</span>
                  <span className="text-[#e9edef] text-[16px]">帮助与反馈</span>
                </button>
              </div>
            </div>
          )}
        </main>

        <nav className="h-[68px] w-full bg-[#202c33] border-t border-[#313d44] flex justify-between items-center px-6 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('wechat')}
            className="flex flex-col items-center justify-center gap-1 min-w-[64px] py-2"
          >
            <div className="relative">
              <span
                className={`material-symbols-outlined !text-[25px] leading-none transition-colors ${
                  activeTab === 'wechat' ? 'text-[#00d95f]' : 'text-[#8696a0]'
                }`}
                style={activeTab === 'wechat' ? tabIconActiveStyle : tabIconBaseStyle}
              >
                chat_bubble
              </span>
            </div>
            <span className={`text-[11px] font-normal transition-colors ${
              activeTab === 'wechat' ? 'text-[#00d95f]' : 'text-[#8696a0]'
            }`}>
              微信
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('contacts')}
            className="flex flex-col items-center justify-center gap-1 min-w-[64px] py-2"
          >
            <span
              className={`material-symbols-outlined !text-[25px] leading-none transition-colors ${
                activeTab === 'contacts' ? 'text-[#00d95f]' : 'text-[#8696a0]'
              }`}
              style={activeTab === 'contacts' ? tabIconActiveStyle : tabIconBaseStyle}
            >
              contacts
            </span>
            <span className={`text-[11px] font-normal transition-colors ${
              activeTab === 'contacts' ? 'text-[#00d95f]' : 'text-[#8696a0]'
            }`}>
              通讯录
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('discover')}
            className="flex flex-col items-center justify-center gap-1 min-w-[64px] py-2"
          >
            <div className="relative">
              <span
                className={`material-symbols-outlined !text-[25px] leading-none transition-colors ${
                  activeTab === 'discover' ? 'text-[#00d95f]' : 'text-[#8696a0]'
                }`}
                style={activeTab === 'discover' ? tabIconActiveStyle : tabIconBaseStyle}
              >
                explore
              </span>
            </div>
            <span className={`text-[11px] font-normal transition-colors ${
              activeTab === 'discover' ? 'text-[#00d95f]' : 'text-[#8696a0]'
            }`}>
              发现
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('me')}
            className="flex flex-col items-center justify-center gap-1 min-w-[64px] py-2"
          >
            <span
              className={`material-symbols-outlined !text-[25px] leading-none transition-colors ${
                activeTab === 'me' ? 'text-[#00d95f]' : 'text-[#8696a0]'
              }`}
              style={activeTab === 'me' ? tabIconActiveStyle : tabIconBaseStyle}
            >
              person
            </span>
            <span className={`text-[11px] font-normal transition-colors ${
              activeTab === 'me' ? 'text-[#00d95f]' : 'text-[#8696a0]'
            }`}>
              我
            </span>
          </button>
        </nav>
      </div>
    </div>
  );
}
