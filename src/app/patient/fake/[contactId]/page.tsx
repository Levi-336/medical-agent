import Link from 'next/link';

export const dynamic = 'force-dynamic';

type ContactId = 'filehelper' | 'wechatpay' | 'official';

const CONTACTS: Record<
  ContactId,
  { title: string; messages: Array<{ side: 'left' | 'right'; text: string }>; avatarText: string; avatarBg: string }
> = {
  filehelper: {
    title: '文件传输助手',
    avatarText: '文',
    avatarBg: '#2e62d9',
    messages: [
      { side: 'left', text: '欢迎使用文件传输助手。' },
      { side: 'left', text: '你可以在这里发送文件、图片、文字到电脑端。' },
      { side: 'right', text: '收到' },
    ],
  },
  wechatpay: {
    title: '微信支付',
    avatarText: '￥',
    avatarBg: '#fa9d3b',
    messages: [
      { side: 'left', text: '微信支付凭证' },
      { side: 'left', text: '支付成功：¥12.50' },
      { side: 'right', text: '好的' },
    ],
  },
  official: {
    title: '订阅号消息',
    avatarText: '订',
    avatarBg: '#2e62d9',
    messages: [
      { side: 'left', text: '今日要闻：AI 医疗应用加速落地…' },
      { side: 'left', text: '健康提醒：规律作息、适度运动，有助于提高免疫力。' },
      { side: 'right', text: '了解' },
    ],
  },
};

interface PageProps {
  params: Promise<{ contactId: string }>;
}

function iconThinStyle() {
  return { fontVariationSettings: "'wght' 300, 'FILL' 0, 'GRAD' 0, 'opsz' 24" } as const;
}

export default async function FakeChatPage({ params }: PageProps) {
  const { contactId } = await params;
  const id = (contactId as ContactId) in CONTACTS ? (contactId as ContactId) : 'filehelper';
  const contact = CONTACTS[id];

  return (
    <div className="relative mx-auto flex h-screen max-h-screen w-full max-w-md flex-col overflow-hidden bg-[#f2f2f2] shadow-2xl">
      <header className="z-20 flex h-14 w-full items-center justify-between bg-[#f2f2f2] px-4">
        <div className="flex items-center w-[88px]">
          <Link href="/patient" className="flex items-center text-[#181818] hover:text-gray-600 transition-colors" aria-label="返回">
            <span className="material-symbols-outlined !text-[30px] leading-none" style={iconThinStyle()}>
              arrow_back_ios_new
            </span>
          </Link>
        </div>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-[#181818] tracking-wide">{contact.title}</h1>
        <div className="flex items-center justify-end w-[88px]">
          <button type="button" className="flex items-center justify-center text-[#181818] hover:text-gray-600 transition-colors" aria-label="更多">
            <span className="material-symbols-outlined !text-[28px] leading-none" style={iconThinStyle()}>
              more_horiz
            </span>
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#f2f2f2] border-t border-[#e5e5e5]">
        {contact.messages.map((m, idx) =>
          m.side === 'left' ? (
            <div key={idx} className="flex items-start gap-3">
              <div
                className="h-10 w-10 shrink-0 overflow-hidden rounded-md shadow-sm flex items-center justify-center text-[16px] font-semibold text-white"
                style={{ backgroundColor: contact.avatarBg }}
              >
                {contact.avatarText}
              </div>
              <div className="flex max-w-[70%] flex-col gap-1">
                <div className="relative rounded-md bg-white px-3 py-2 text-[16px] leading-relaxed text-black shadow-sm">
                  <span className="absolute top-3 -left-[6px] w-0 h-0 border-t-[6px] border-t-transparent border-r-[8px] border-r-white border-b-[6px] border-b-transparent" />
                  {m.text}
                </div>
              </div>
            </div>
          ) : (
            <div key={idx} className="flex items-start justify-end gap-3">
              <div className="flex max-w-[70%] flex-col gap-1 items-end">
                <div className="relative rounded-md bg-[#95ec69] px-3 py-2 text-[16px] leading-relaxed text-black shadow-sm">
                  <span className="absolute top-3 -right-[6px] w-0 h-0 border-t-[6px] border-t-transparent border-l-[8px] border-l-[#95ec69] border-b-[6px] border-b-transparent" />
                  {m.text}
                </div>
              </div>
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md shadow-sm bg-white flex items-center justify-center text-[16px] font-semibold text-[#2e62d9]">
                我
              </div>
            </div>
          )
        )}
        <div className="h-2" />
      </main>

      <footer
        className="z-20 w-full border-t border-[#e5e5e5] bg-[#f7f7f7] px-3 py-2"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 20px) + 1rem)' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#181818] text-[#181818]"
            aria-label="语音"
            disabled
          >
            <span className="material-symbols-outlined !text-[20px] leading-none rotate-90 opacity-60" style={iconThinStyle()}>
              wifi_tethering
            </span>
          </button>
          <div className="flex flex-1 items-center rounded-md bg-white px-3 py-[9px]">
            <input
              placeholder="输入消息"
              className="w-full bg-transparent p-0 text-[16px] text-[#111711] focus:outline-none border-none h-5 leading-5"
              disabled
            />
          </div>
          <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#181818]" aria-label="表情" disabled>
            <span className="material-symbols-outlined !text-[32px] leading-none opacity-60" style={iconThinStyle()}>
              sentiment_satisfied
            </span>
          </button>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#181818] text-[#181818]"
            aria-label="更多功能"
            disabled
          >
            <span className="material-symbols-outlined !text-[22px] leading-none opacity-60" style={iconThinStyle()}>
              add
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}

