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

  return (
    <div className="flex justify-center">
      <div className="relative mx-auto flex h-screen max-h-screen w-full max-w-md flex-col overflow-hidden bg-[#f2f2f2] shadow-2xl">
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 top-24 z-50 flex justify-center" aria-live="polite">
            <div className="rounded-md bg-black/70 px-4 py-2 text-[14px] text-white">{toast}</div>
          </div>
        )}
        <div className="h-8 w-full bg-[#f2f2f2] sticky top-0 z-20 shrink-0" />

        <header className="bg-[#f2f2f2] sticky top-8 z-20 px-4 pb-2">
          <div className="flex items-center justify-between h-11 relative">
            <h1 className="text-[17px] font-bold tracking-tight text-gray-900 flex-1 text-center">
              {activeTab === 'wechat'
                ? '微信'
                : activeTab === 'contacts'
                  ? '通讯录'
                  : activeTab === 'discover'
                    ? '发现'
                    : '我'}
            </h1>
            <div className="absolute right-0 flex items-center gap-5 pr-0">
              <button
                type="button"
                className="flex items-center justify-center text-gray-900 hover:text-gray-600 transition-colors"
                aria-label="搜索"
              >
                <span className="material-symbols-outlined text-[26px] font-light leading-none" style={tabIconBaseStyle}>
                  search
                </span>
              </button>
              <button
                type="button"
                className="flex items-center justify-center text-gray-900 hover:text-gray-600 transition-colors"
                aria-label="添加"
              >
                <span className="material-symbols-outlined text-[26px] font-light leading-none" style={tabIconBaseStyle}>
                  add_circle
                </span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto w-full bg-white border-t border-[#e5e5ea]">
          {activeTab === 'wechat' && (
            <div className="flex flex-col w-full">
              {patients.length === 0 ? (
                <div className="p-8 text-center text-gray-500">请先在医生助理端创建患者</div>
              ) : (
                wechatItems.map((item) => {
                  const isDoctor = item.key.startsWith('doctor_');
                  const content = (
                    <>
                      <div className="relative shrink-0">
                        <div
                          className="h-[48px] w-[48px] rounded-[4px] flex items-center justify-center text-white border border-transparent text-[18px] font-semibold"
                          style={{ backgroundColor: item.avatarBg }}
                        >
                          {item.avatarKind === 'doctorPhoto' ? (
                            <img
                              src={doctorAvatarSrc}
                              alt="医生头像"
                              className="h-full w-full object-cover rounded-[4px]"
                              draggable={false}
                            />
                          ) : item.avatarIcon ? (
                            <span
                              className="material-symbols-outlined leading-none text-white"
                              style={{ ...avatarIconStyle, fontSize: item.avatarIconSize ?? 28 }}
                            >
                              {item.avatarIcon}
                            </span>
                          ) : (
                            item.avatarText
                          )}
                        </div>
                      </div>

                      <div className="ml-3 flex flex-1 flex-col justify-center overflow-hidden border-b border-[#e5e5ea] pb-3 pt-1 group-last:border-none">
                        <div className="flex items-baseline justify-between">
                          <h3 className="truncate text-[17px] font-normal text-gray-900">{item.title}</h3>
                          <span className="shrink-0 text-[11px] text-gray-400 ml-2">{item.time}</span>
                        </div>
                        <div className="mt-0.5 flex items-center pr-2">
                          <p className="truncate text-[14px] text-gray-500 flex-1 mr-2">{item.preview}</p>
                        </div>
                      </div>
                    </>
                  );

                  if (isDoctor) {
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        className="group relative flex w-full items-center active:bg-gray-100 transition-colors cursor-pointer px-4 py-3 bg-white"
                      >
                        {content}
                      </Link>
                    );
                  }

                  return (
                    <div
                      key={item.key}
                      className="group relative flex w-full items-center px-4 py-3 bg-white cursor-not-allowed opacity-80"
                      aria-disabled="true"
                    >
                      {content}
                    </div>
                  );
                })
              )}
              <div className="h-24 bg-white" />
            </div>
          )}

          {activeTab === 'contacts' && (
            <div className="p-8 text-center text-gray-500">通讯录（演示）</div>
          )}
          {activeTab === 'discover' && (
            <div className="p-8 text-center text-gray-500">发现（演示）</div>
          )}
          {activeTab === 'me' && (
            <div className="p-6 space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-sm text-slate-500 mb-2">当前模拟身份</div>
                <select
                  className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-slate-50 text-slate-900"
                  value={selectedPatientId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedPatientId(nextId);
                    const p = patients.find((x) => x.id === nextId);
                    setToast(p ? `已切换为：${p.name}` : '切换成功');
                  }}
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}（{p.gender || '—'}，{p.age != null ? `${p.age}岁` : '—'}）
                    </option>
                  ))}
                </select>
                {selectedPatient && (
                  <div className="mt-3 text-xs text-slate-500">
                    当前患者：{selectedPatient.name} · {selectedPatient.condition || '—'}
                  </div>
                )}
              </div>

              <Link
                href="/"
                className="block bg-white rounded-xl border border-slate-200 p-4 text-slate-900 active:bg-slate-50 transition"
              >
                <div className="font-medium">返回首页</div>
                <div className="text-xs text-slate-500 mt-1">切换到患者端 / 医生助理端 / 医生端</div>
              </Link>
            </div>
          )}
        </main>

        <nav className="h-[56px] w-full bg-[#f7f7f7] border-t border-gray-300 flex justify-between items-center px-4 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('wechat')}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[64px]"
          >
            <div className="relative">
              <span
                className={
                  activeTab === 'wechat'
                    ? 'material-symbols-outlined text-[#07C160] text-[24px] leading-none'
                    : 'material-symbols-outlined text-gray-800 text-[24px] leading-none'
                }
                style={activeTab === 'wechat' ? tabIconActiveStyle : tabIconBaseStyle}
              >
                chat_bubble
              </span>
              <div className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-500" />
            </div>
            <span className={activeTab === 'wechat' ? 'text-[10px] font-normal text-[#07C160]' : 'text-[10px] font-normal text-gray-800'}>
              微信
            </span>
          </button>
          <button
            type="button"
            disabled
            className="flex flex-col items-center justify-center gap-0.5 min-w-[64px]"
            aria-disabled="true"
          >
            <span
              className={activeTab === 'contacts' ? 'material-symbols-outlined text-[#07C160] text-[24px] leading-none' : 'material-symbols-outlined text-gray-800 text-[24px] leading-none'}
              style={activeTab === 'contacts' ? tabIconActiveStyle : tabIconBaseStyle}
            >
              group
            </span>
            <span className={activeTab === 'contacts' ? 'text-[10px] font-normal text-[#07C160]' : 'text-[10px] font-normal text-gray-800'}>
              通讯录
            </span>
          </button>
          <button
            type="button"
            disabled
            className="flex flex-col items-center justify-center gap-0.5 min-w-[64px]"
            aria-disabled="true"
          >
            <div className="relative">
              <span
                className={activeTab === 'discover' ? 'material-symbols-outlined text-[#07C160] text-[24px] leading-none' : 'material-symbols-outlined text-gray-800 text-[24px] leading-none'}
                style={activeTab === 'discover' ? tabIconActiveStyle : tabIconBaseStyle}
              >
                explore
              </span>
              <div className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-500" />
            </div>
            <span className={activeTab === 'discover' ? 'text-[10px] font-normal text-[#07C160]' : 'text-[10px] font-normal text-gray-800'}>
              发现
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('me')}
            className="flex flex-col items-center justify-center gap-0.5 min-w-[64px]"
          >
            <span
              className={activeTab === 'me' ? 'material-symbols-outlined text-[#07C160] text-[24px] leading-none' : 'material-symbols-outlined text-gray-800 text-[24px] leading-none'}
              style={activeTab === 'me' ? tabIconActiveStyle : tabIconBaseStyle}
            >
              person
            </span>
            <span className={activeTab === 'me' ? 'text-[10px] font-normal text-[#07C160]' : 'text-[10px] font-normal text-gray-800'}>
              我
            </span>
          </button>
        </nav>
      </div>
    </div>
  );
}
