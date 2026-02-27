const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const defaultDbPath = path.join(process.cwd(), 'data', 'local.db');
const dbPath = process.env.DB_PATH || defaultDbPath;
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    age INTEGER,
    gender TEXT,
    condition TEXT,
    persona TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS patient_ai_state (
    patient_id TEXT PRIMARY KEY,
    medical_inquiry_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS doctor_consultations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    status TEXT NOT NULL,
    fee_cents INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    trigger TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    paid_at TEXT,
    ended_at TEXT,
    FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    embedding TEXT,
    category TEXT DEFAULT 'general',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

db.prepare('DELETE FROM doctor_consultations').run();
db.prepare('DELETE FROM knowledge_base').run();
db.prepare('DELETE FROM patient_ai_state').run();
db.prepare('DELETE FROM memories').run();
db.prepare('DELETE FROM chat_messages').run();
db.prepare('DELETE FROM patients').run();

const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

const base = new Date(Date.now() - 1000 * 60 * 90);
const t = (minOffset) => fmt(new Date(base.getTime() + minOffset * 60 * 1000));

const intro = [
  '您好，我是张医生的助理。',
  '我会先帮您把情况记录清楚，方便医生更快了解。',
  '您现在最主要哪里不舒服？',
  '从什么时候开始的？最近有没有加重或缓解？',
  '有没有发烧/胸痛/气短/说话不清/单侧无力/黑蒙晕厥等情况？',
].join('\n');

const patients = [
  {
    id: `p_${Date.now()}_lihua`,
    name: '李华',
    age: 28,
    gender: '男',
    condition: '咳嗽发热',
    persona: '年轻男性，急性上呼吸道感染样不适，近期出现发热与咳嗽。',
    created_at: t(0),
    chat: [
      { role: 'ai', at: t(0), content: intro },
      { role: 'user', at: t(2), content: '咳嗽两天了，今天开始发烧，嗓子疼。' },
      { role: 'ai', at: t(3), content: '体温最高多少℃？现在有没有胸痛或气短？\n咳嗽是干咳还是有痰？痰的颜色怎样？\n有没有流鼻涕、肌肉酸痛或接触过感冒的人？' },
      { role: 'user', at: t(6), content: '体温最高38.6℃，没有胸痛气短，咳嗽有点黄痰，鼻塞。' },
      { role: 'ai', at: t(7), content: '发热一般在一天中哪个时间段更明显？\n嗓子疼吞咽会明显加重吗？\n有没有药物过敏或正在用药？' },
      { role: 'user', at: t(10), content: '晚上更明显，吞咽会疼；无药物过敏，目前没用药。' },
      { role: 'assistant', at: t(15), content: '已记录：发热最高38.6℃、咳嗽黄痰、鼻塞、咽痛吞咽加重；无胸痛气短；无药物过敏；目前未用药。' },
    ],
    memories: [
      { at: t(6), source: 'patient', content: '体温最高38.6℃' },
      { at: t(6), source: 'patient', content: '咳嗽黄痰，伴鼻塞' },
      { at: t(6), source: 'patient', content: '无胸痛/气短' },
      { at: t(10), source: 'patient', content: '无药物过敏，当前未用药' },
    ],
    ai_state: { count: 2, at: t(12) },
  },
  {
    id: `p_${Date.now()}_wangmin`,
    name: '王敏',
    age: 35,
    gender: '女',
    condition: '胃痛反酸',
    persona: '近一周反酸、胃部不适，作息不规律，压力偏大。',
    created_at: t(1),
    chat: [
      { role: 'ai', at: t(1), content: intro },
      { role: 'user', at: t(4), content: '最近一周老是反酸，胃有点烧灼感。' },
      { role: 'ai', at: t(5), content: '反酸一般在饭后还是空腹更明显？\n有没有恶心呕吐或黑便？\n最近是否熬夜、喝酒、咖啡或辛辣油腻增多？' },
      { role: 'user', at: t(8), content: '饭后更明显，没有呕吐黑便，最近熬夜比较多，也喝咖啡。' },
      { role: 'assistant', at: t(12), content: '已记录：反酸/烧灼感饭后加重；无呕吐黑便；近期熬夜+咖啡。' },
    ],
    memories: [
      { at: t(8), source: 'patient', content: '反酸与烧灼感饭后更明显' },
      { at: t(8), source: 'patient', content: '无呕吐/黑便' },
      { at: t(8), source: 'patient', content: '近期熬夜与咖啡摄入较多' },
    ],
    ai_state: { count: 1, at: t(9) },
  },
  {
    id: `p_${Date.now()}_zhaoqiang`,
    name: '赵强',
    age: 62,
    gender: '男',
    condition: '高血压糖尿病',
    persona: '既往高血压/糖尿病，近期血压波动，主诉头晕发飘，偶有心慌。',
    created_at: t(2),
    chat: [
      { role: 'ai', at: t(2), content: intro },
      { role: 'user', at: t(6), content: '这两天头晕发飘，偶尔心慌。血压最高160/95，最低110/70。' },
      { role: 'ai', at: t(7), content: '头晕时是天旋地转还是发飘/站不稳？和体位变化有关吗？\n测血压时有没有按坐位休息5分钟、同一手臂重复测量？\n有没有胸痛/气短/说话不清/单侧无力/黑蒙晕厥等情况？' },
      { role: 'user', at: t(10), content: '是发飘，起身时更明显；测量前休息过；没有说话不清，也没单侧无力。' },
      { role: 'ai', at: t(12), content: '目前有没有在用降压药/降糖药？\n头晕时心率大概多少？有没有出冷汗或手抖？\n今天饮食、睡眠和饮水情况如何？' },
      { role: 'user', at: t(15), content: '目前没用药，心率有时100左右，睡眠一般，喝水不多。' },
      { role: 'ai', at: t(16), content: '关于用药/治疗方案需要由医生在会诊中确认（演示）。\n请回复数字 1 确认接入医生会诊，确认后我将发送支付链接。\n（提示：支付后医生端才可见并建立会话）' },
      { role: 'user', at: t(18), content: '1' },
      { role: 'ai', at: t(19), content: '已确认接入医生会诊。请点击链接完成支付：/patient/pay/tok_demo_zhaoqiang（演示版本：点击即视为已支付）' },
      { role: 'doctor', at: t(25), content: '收到。先把这两天早晚血压（坐位静息5分钟后测2次取平均）、心率、指尖血糖记录一下发我；头晕如果与起身相关，也测一次站立1分钟后的血压心率。' },
    ],
    memories: [
      { at: t(6), source: 'patient', content: '血压最高160/95，最低110/70' },
      { at: t(6), source: 'patient', content: '头晕发飘，偶尔心慌' },
      { at: t(10), source: 'patient', content: '无说话不清/单侧无力' },
      { at: t(15), source: 'patient', content: '目前未用药，心率有时约100，饮水偏少' },
    ],
    consult: {
      token: 'tok_demo_zhaoqiang',
      status: 'paid',
      fee_cents: 1999,
      trigger: 'ai',
      created_at: t(16),
      paid_at: t(20),
      ended_at: null,
    },
    ai_state: { count: 3, at: t(16) },
  },
  {
    id: `p_${Date.now()}_chenjing`,
    name: '陈静',
    age: 41,
    gender: '女',
    condition: '咨询挂号与发票',
    persona: '用户主要咨询挂号流程与发票等行政问题。',
    created_at: t(3),
    chat: [
      { role: 'ai', at: t(3), content: '您好，我可以帮您解答挂号、发票、报告领取等问题。请问您想咨询哪一项？' },
      { role: 'user', at: t(5), content: '我想问下发票怎么开？门诊几点上班？' },
      { role: 'ai', at: t(6), content: '发票可在缴费后在自助机或收费窗口开具；如需电子票据可通过公众号/小程序查询下载。\n门诊时间一般为：工作日 8:00-12:00、14:00-17:30；周末以医院公告为准。\n如您提供医院名称/院区，我可以给出更准确的入口与流程。' },
    ],
    memories: [
      { at: t(5), source: 'patient', content: '咨询发票开具与门诊上班时间' },
    ],
    ai_state: { count: 0, at: t(6) },
  },
];

const insPatient = db.prepare(
  'INSERT INTO patients (id, name, age, gender, condition, persona, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const insChat = db.prepare('INSERT INTO chat_messages (patient_id, role, content, created_at) VALUES (?, ?, ?, ?)');
const insMemory = db.prepare('INSERT INTO memories (patient_id, content, embedding, source, created_at) VALUES (?, ?, ?, ?, ?)');
const insAiState = db.prepare('INSERT OR REPLACE INTO patient_ai_state (patient_id, medical_inquiry_count, updated_at) VALUES (?, ?, ?)');
const insConsult = db.prepare(
  'INSERT INTO doctor_consultations (patient_id, status, fee_cents, token, trigger, created_at, paid_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
const insKnowledge = db.prepare('INSERT INTO knowledge_base (content, embedding, category, created_at) VALUES (?, ?, ?, ?)');

const knowledge = [
  { category: 'admin', content: '门诊时间：工作日 8:00-12:00、14:00-17:30；节假日以公告为准。', at: t(0) },
  { category: 'admin', content: '发票：缴费后可在自助机/收费窗口开具；电子票据可通过公众号/小程序下载。', at: t(0) },
  { category: 'admin', content: '地址：到院路线请提供院区名称，我可以给出更准确指引（示例：地铁/公交/停车）。', at: t(0) },
  { category: 'general', content: '高血压随访：建议记录家庭血压（早晚各一次，坐位静息5分钟后测2次取平均）。', at: t(0) },
  { category: 'general', content: '发热伴咳嗽：需要关注体温、呼吸困难、胸痛及基础病情况，必要时进一步评估。', at: t(0) },
];

for (const k of knowledge) {
  insKnowledge.run(k.content, null, k.category, k.at);
}

for (const p of patients) {
  insPatient.run(p.id, p.name, p.age, p.gender, p.condition, p.persona, p.created_at);
  for (const m of p.chat) insChat.run(p.id, m.role, m.content, m.at);
  for (const m of p.memories) insMemory.run(p.id, m.content, null, m.source, m.at);
  if (p.ai_state) insAiState.run(p.id, p.ai_state.count, p.ai_state.at);
  if (p.consult) {
    insConsult.run(
      p.id,
      p.consult.status,
      p.consult.fee_cents,
      p.consult.token,
      p.consult.trigger,
      p.consult.created_at,
      p.consult.paid_at,
      p.consult.ended_at
    );
  }
}

console.log('seeded', { patients: patients.length, knowledge: knowledge.length });
