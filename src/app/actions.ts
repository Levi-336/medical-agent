'use server';

import { db } from '@/lib/db';
import { extractKeywords, getEmbedding, updatePersona, generateRAGResponse, generateDoctorCopilotSuggestion, classifyIntent, generateKnowledgeResponse, generateDoctorAssistantIntakeResponse } from '@/lib/ai';
import { cosineSimilarity, generateId } from '@/lib/utils'; // 使用 utils 中的 generateId 或 nanoid
import { revalidatePath } from 'next/cache';

// 定义类型
export interface Patient {
  id: string;
  name: string;
  age: number | null;
  gender: string | null;
  condition: string | null;
  persona: string | null;
  created_at: string;
}

export interface PatientWithConsultStatus extends Patient {
  hasActiveConsultation: boolean;
}

export interface Memory {
  id: number;
  patient_id: string;
  content: string;
  embedding: number[]; // 数据库存的是 string，这里解析后是 array
  source: string;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  patient_id: string;
  role: 'user' | 'ai' | 'assistant' | 'doctor';
  content: string;
  created_at: string;
}

export interface DoctorConsultation {
  id: number;
  patient_id: string;
  status: 'pending' | 'paid' | 'ended';
  fee_cents: number;
  token: string;
  trigger: 'ai' | 'manual';
  created_at: string;
  paid_at: string | null;
  ended_at: string | null;
}

export interface KnowledgeItem {
    id: number;
    content: string;
    category: string;
    created_at: string;
}

export interface PatientChatSummary {
  patient: Patient;
  last_content: string | null;
  last_created_at: string | null;
  unread_count: number;
}

export interface LastDialogueMessage {
  content: string;
  created_at: string;
}

const doctorName = process.env.NEXT_PUBLIC_DOCTOR_NAME || process.env.DOCTOR_NAME || '张医生';
let legacyDialogueCleaned = false;

function cleanupLegacyDialogueMemoriesOnce() {
  if (legacyDialogueCleaned) return;
  try {
    db.prepare("DELETE FROM memories WHERE source = 'dialogue'").run();
  } catch {}
  legacyDialogueCleaned = true;
}

async function safeGetEmbedding(text: string): Promise<number[] | null> {
  try {
    return await getEmbedding(text);
  } catch {
    return null;
  }
}

async function safeExtractKeywords(text: string, source: 'patient' | 'doctor' | 'ai' | 'import'): Promise<string[]> {
  try {
    const facts = await extractKeywords(text, source);
    return facts
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .filter((f) => f.length <= 80);
  } catch {
    return [];
  }
}

function buildDoctorAssistantIntro(): string {
  return [
    `您好，我是${doctorName}的助理。我会先帮您把情况记录清楚，方便医生更快了解。`,
    '您现在最主要哪里不舒服？',
    '从什么时候开始的？',
    '有没有发烧/咳嗽/疼痛等情况？',
  ].join('\n');
}

function isMedicalRelatedText(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return /药|用药|剂量|副作用|不良反应|过敏|症状|疼|痛|发烧|发热|咳嗽|头晕|腹泻|呕吐|心慌|胸闷|气短|呼吸困难|血压|血糖|心率|感染|炎|高血压|糖尿病|感冒|怀孕|哺乳|诊断|治疗|检查|化验|CT|核磁|B超/.test(t);
}

function ensurePatientAiStateRow(patientId: string) {
  const exists = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!exists) return;
  db.prepare(
    `INSERT OR IGNORE INTO patient_ai_state (patient_id, medical_inquiry_count) VALUES (?, 0)`
  ).run(patientId);
}

function getMedicalInquiryCount(patientId: string): number {
  ensurePatientAiStateRow(patientId);
  const row = db
    .prepare('SELECT medical_inquiry_count FROM patient_ai_state WHERE patient_id = ?')
    .get(patientId) as { medical_inquiry_count: number } | undefined;
  if (!row) return 0;
  if (row.medical_inquiry_count > 0) return row.medical_inquiry_count;

  const recent = db
    .prepare("SELECT content FROM chat_messages WHERE patient_id = ? AND role = 'ai' ORDER BY id ASC LIMIT 20")
    .all(patientId) as { content: string }[];

  const estimated = recent.reduce((acc, r) => {
    const c = r.content.trim();
    if (!c) return acc;
    if (c.includes('医生会诊') || c.includes('支付') || c.includes('确认接入')) return acc;
    if (c.includes('上班') || c.includes('营业') || c.includes('地址') || c.includes('挂号') || c.includes('发票') || c.includes('支付')) return acc;
    if (c.includes('助理') && (c.includes('请') || c.includes('麻烦') || c.includes('补充'))) return acc + 1;
    return acc;
  }, 0);

  const nextCount = Math.min(3, estimated);
  if (nextCount > 0) {
    db.prepare('UPDATE patient_ai_state SET medical_inquiry_count = ?, updated_at = datetime(\'now\', \'localtime\') WHERE patient_id = ?').run(nextCount, patientId);
  }
  return nextCount;
}

function incrementMedicalInquiryCount(patientId: string) {
  ensurePatientAiStateRow(patientId);
  db.prepare(
    'UPDATE patient_ai_state SET medical_inquiry_count = medical_inquiry_count + 1, updated_at = datetime(\'now\', \'localtime\') WHERE patient_id = ?'
  ).run(patientId);
}

function insertChatMessage(patientId: string, role: 'user' | 'ai' | 'assistant' | 'doctor', content: string): number {
  const exists = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!exists) return 0;
  const stmt = db.prepare('INSERT INTO chat_messages (patient_id, role, content) VALUES (?, ?, ?)');
  const info = stmt.run(patientId, role, content);
  return Number(info.lastInsertRowid);
}

function buildDoctorPayLink(token: string): string {
  return `/patient/pay/${encodeURIComponent(token)}`;
}

function generateToken(): string {
  return generateId();
}

function detectDoctorRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return (
    t.includes('找医生') ||
    t.includes('要医生') ||
    t.includes('转医生') ||
    t.includes('必须医生') ||
    t.includes('非要医生') ||
    t.includes('一定要医生') ||
    t.includes('医生亲自') ||
    t.includes('真人医生') ||
    t.includes('联系医生') ||
    t.includes('找专家') ||
    t.includes('找主治')
  );
}

function detectMedicationOrTreatmentAdviceRequest(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return /推荐.*药|开什么药|开药|处方|药方|剂量|怎么吃药|怎么用药|用药方案|治疗方案|怎么治|如何治疗|需要吃药吗|降压药|降糖药|胰岛素|二甲双胍/.test(
    t
  );
}

export async function startDoctorConsultation(
  patientId: string,
  trigger: 'ai' | 'manual' = 'manual',
  feeCents: number = 1999
): Promise<{ token: string; payLink: string; status: 'pending' | 'paid' }> {
  cleanupLegacyDialogueMemoriesOnce();
  const existing = db
    .prepare("SELECT id, token, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1")
    .get(patientId) as { id: number; token: string; status: 'pending' | 'paid' } | undefined;
  if (existing) {
    return { token: existing.token, payLink: buildDoctorPayLink(existing.token), status: existing.status };
  }

  const token = generateToken();
  db.prepare('INSERT INTO doctor_consultations (patient_id, status, fee_cents, token, trigger) VALUES (?, ?, ?, ?, ?)').run(
    patientId,
    'pending',
    feeCents,
    token,
    trigger
  );

  revalidatePath('/doctor');
  return { token, payLink: buildDoctorPayLink(token), status: 'pending' };
}

export async function markDoctorConsultationPaidByToken(token: string) {
  cleanupLegacyDialogueMemoriesOnce();
  const row = db
    .prepare('SELECT id, patient_id, status, fee_cents FROM doctor_consultations WHERE token = ? LIMIT 1')
    .get(token) as { id: number; patient_id: string; status: string; fee_cents: number } | undefined;
  if (!row) return { success: false, reason: 'not_found' as const };
  const existsPatient = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(row.patient_id);
  if (!existsPatient) {
    db.prepare('DELETE FROM doctor_consultations WHERE id = ?').run(row.id);
    return { success: false, reason: 'not_found' as const };
  }

  if (row.status === 'paid') return { success: true, patientId: row.patient_id, alreadyPaid: true as const };
  if (row.status === 'ended') return { success: false, reason: 'ended' as const };

  db.prepare("UPDATE doctor_consultations SET status = 'paid', paid_at = datetime('now', 'localtime') WHERE id = ?").run(row.id);
  insertChatMessage(row.patient_id, 'ai', `支付成功，已为您接入医生会诊。`);
  await storeKeywordsToMemories(row.patient_id, 'ai', '医生会诊已支付');

  return { success: true, patientId: row.patient_id, alreadyPaid: false as const };
}

export async function getPaidDoctorConsultPatients(): Promise<Array<{ consultation: DoctorConsultation; patient: Patient }>> {
  type PaidDoctorConsultRow = {
    c_id: number;
    c_patient_id: string;
    c_status: DoctorConsultation['status'];
    c_fee_cents: number;
    c_token: string;
    c_trigger: DoctorConsultation['trigger'];
    c_created_at: string;
    c_paid_at: string | null;
    c_ended_at: string | null;
    p_id: string;
    p_name: string;
    p_age: number | null;
    p_gender: string | null;
    p_condition: string | null;
    p_persona: string | null;
    p_created_at: string;
  };
  const rows = db
    .prepare(
      `
      SELECT
        c.id as c_id,
        c.patient_id as c_patient_id,
        c.status as c_status,
        c.fee_cents as c_fee_cents,
        c.token as c_token,
        c.trigger as c_trigger,
        c.created_at as c_created_at,
        c.paid_at as c_paid_at,
        c.ended_at as c_ended_at,
        p.id as p_id,
        p.name as p_name,
        p.age as p_age,
        p.gender as p_gender,
        p.condition as p_condition,
        p.persona as p_persona,
        p.created_at as p_created_at
      FROM doctor_consultations c
      JOIN patients p ON p.id = c.patient_id
      WHERE c.status = 'paid'
      ORDER BY c.paid_at DESC, c.id DESC
    `
    )
    .all() as PaidDoctorConsultRow[];

  return rows.map((r) => ({
    consultation: {
      id: r.c_id,
      patient_id: r.c_patient_id,
      status: r.c_status,
      fee_cents: r.c_fee_cents,
      token: r.c_token,
      trigger: r.c_trigger,
      created_at: r.c_created_at,
      paid_at: r.c_paid_at,
      ended_at: r.c_ended_at,
    },
    patient: {
      id: r.p_id,
      name: r.p_name,
      age: r.p_age,
      gender: r.p_gender,
      condition: r.p_condition,
      persona: r.p_persona,
      created_at: r.p_created_at,
    },
  }));
}

export async function endDoctorConsultation(consultationId: number) {
  const row = db
    .prepare('SELECT patient_id, status FROM doctor_consultations WHERE id = ? LIMIT 1')
    .get(consultationId) as { patient_id: string; status: string } | undefined;

  if (!row) return { success: false };
  if (row.status === 'ended') return { success: true };

  db.prepare("UPDATE doctor_consultations SET status = 'ended', ended_at = datetime('now','localtime') WHERE id = ?").run(
    consultationId
  );
  insertChatMessage(
    row.patient_id,
    'ai',
    [
      '本次医生会诊已结束，感谢您的信任。',
      '如需继续咨询或补充材料，可再次发起医生会诊。',
      '',
      '风险提示：本消息为 AI 自动生成，仅供健康科普与沟通参考，不能替代线下面诊与检查。',
      '如出现症状加重、持续高热不退、呼吸困难、胸痛、意识异常、严重过敏等紧急情况，请立即就近就医或拨打 120。',
    ].join('\n')
  );
  await storeKeywordsToMemories(row.patient_id, 'ai', '医生会诊结束');
  revalidatePath('/doctor');
  return { success: true };
}

async function ensurePatientIntroMessage(patientId: string) {
  cleanupLegacyDialogueMemoriesOnce();
  const existing = db
    .prepare("SELECT 1 FROM chat_messages WHERE patient_id = ? AND role = 'ai' ORDER BY id ASC LIMIT 1")
    .get(patientId);
  if (existing) return;

  const content = buildDoctorAssistantIntro();
  insertChatMessage(patientId, 'ai', content);
  ensurePatientAiStateRow(patientId);
  db.prepare('UPDATE patient_ai_state SET medical_inquiry_count = 1, updated_at = datetime(\'now\', \'localtime\') WHERE patient_id = ?').run(patientId);
}

async function storeKeywordsToMemories(
  patientId: string,
  source: 'patient' | 'doctor' | 'ai' | 'import',
  text: string
) {
  const existsPatient = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!existsPatient) return;
  const facts = await safeExtractKeywords(text, source);
  const uniq = Array.from(new Set(facts)).slice(0, 12);
  if (uniq.length === 0) return;

  const existsStmt = db.prepare('SELECT 1 FROM memories WHERE patient_id = ? AND source = ? AND content = ? LIMIT 1');
  const insertStmt = db.prepare('INSERT INTO memories (patient_id, content, embedding, source) VALUES (?, ?, ?, ?)');

  const items: Array<{ fact: string; embedding: number[] | null }> = [];
  for (const fact of uniq) {
    const exists = existsStmt.get(patientId, source, fact);
    if (exists) continue;
    const vec = await safeGetEmbedding(fact);
    items.push({ fact, embedding: vec });
  }

  if (items.length === 0) return;

  db.transaction(() => {
    for (const item of items) {
      insertStmt.run(patientId, item.fact, item.embedding ? JSON.stringify(item.embedding) : null, source);
    }
  })();
}

function getRelevantPatientFacts(patientId: string, queryVec: number[] | null): string {
  const rows = db
    .prepare("SELECT content, embedding, source, created_at FROM memories WHERE patient_id = ? AND source != 'dialogue' ORDER BY created_at DESC LIMIT 300")
    .all(patientId) as Array<{ content: string; embedding: string | null; source: string; created_at: string }>;

  if (!queryVec) {
    return rows.slice(0, 8).map((r) => r.content).join('\n');
  }

  const scored = rows
    .map((r) => {
      if (!r.embedding) return null;
      try {
        const emb = JSON.parse(r.embedding) as number[];
        return { content: r.content, score: cosineSimilarity(queryVec, emb) };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<{ content: string; score: number }>;

  scored.sort((a, b) => b.score - a.score);
  const filtered = scored.filter((s) => s.score > 0.35).slice(0, 8).map((s) => s.content);
  return filtered.join('\n');
}

// Action: 获取所有患者
export async function getPatients(): Promise<Patient[]> {
  try {
    const stmt = db.prepare('SELECT * FROM patients ORDER BY created_at DESC');
    const result = stmt.all() as Patient[];
    return result;
  } catch (error) {
    console.error("Failed to get patients:", error);
    return [];
  }
}

export async function getPatientsWithConsultStatus(): Promise<PatientWithConsultStatus[]> {
  try {
    const stmt = db.prepare(`
      SELECT
        p.*,
        EXISTS(
          SELECT 1
          FROM doctor_consultations c
          WHERE c.patient_id = p.id
            AND c.status = 'paid'
            AND c.ended_at IS NULL
          LIMIT 1
        ) AS has_active_consultation
      FROM patients p
      ORDER BY p.created_at DESC
    `);
    const rows = stmt.all() as Array<Patient & { has_active_consultation: 0 | 1 }>;
    return rows.map((r) => ({
      ...r,
      hasActiveConsultation: Boolean(r.has_active_consultation),
    }));
  } catch (error) {
    console.error("Failed to get patients with consult status:", error);
    return [];
  }
}

// Action: 获取患者最近一条对话消息（用于消息列表预览）
export async function getLastDialogueMessage(patientId: string): Promise<LastDialogueMessage | null> {
  const stmt = db.prepare(
    'SELECT content, created_at FROM chat_messages WHERE patient_id = ? ORDER BY created_at DESC, id DESC LIMIT 1'
  );
  const row = stmt.get(patientId) as { content: string; created_at: string } | undefined;
  return row ?? null;
}

// Action: 获取患者消息列表（用于“微信样式”的会话列表）
export async function getPatientChatList(): Promise<PatientChatSummary[]> {
  try {
    const stmt = db.prepare(`
      SELECT
        p.*,
        m.content AS last_content,
        m.created_at AS last_created_at
      FROM patients p
      LEFT JOIN chat_messages m
        ON m.id = (
          SELECT id
          FROM chat_messages
          WHERE patient_id = p.id
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        )
      ORDER BY p.created_at DESC
    `);

    const rows = stmt.all() as (Patient & { last_content: string | null; last_created_at: string | null })[];
    return rows.map((r) => ({
      patient: {
        id: r.id,
        name: r.name,
        age: r.age,
        gender: r.gender,
        condition: r.condition,
        persona: r.persona,
        created_at: r.created_at,
      },
      last_content: r.last_content ?? null,
      last_created_at: r.last_created_at ?? null,
      unread_count: 0,
    }));
  } catch (error) {
    console.error("Failed to get patient chat list:", error);
    return [];
  }
}

// Action: 获取单个患者
export async function getPatient(id: string): Promise<Patient | undefined> {
  const stmt = db.prepare('SELECT * FROM patients WHERE id = ?');
  return stmt.get(id) as Patient | undefined;
}

export async function getPatientWithConsultStatus(id: string): Promise<PatientWithConsultStatus | undefined> {
  const stmt = db.prepare(`
    SELECT
      p.*,
      EXISTS(
        SELECT 1
        FROM doctor_consultations c
        WHERE c.patient_id = p.id
          AND c.status = 'paid'
          AND c.ended_at IS NULL
        LIMIT 1
      ) AS has_active_consultation
    FROM patients p
    WHERE p.id = ?
    LIMIT 1
  `);
  const row = stmt.get(id) as (Patient & { has_active_consultation: 0 | 1 }) | undefined;
  if (!row) return undefined;
  return { ...row, hasActiveConsultation: Boolean(row.has_active_consultation) };
}

export async function resetPatientsAndSeedDemo() {
  const now = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const toSqliteLocal = (d: Date) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const addMinutes = (base: Date, deltaMinutes: number) => new Date(base.getTime() + deltaMinutes * 60_000);

  const insertPatient = db.prepare('INSERT INTO patients (id, name, age, gender, condition, persona, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertChat = db.prepare('INSERT INTO chat_messages (patient_id, role, content, created_at) VALUES (?, ?, ?, ?)');
  const insertMemory = db.prepare('INSERT INTO memories (patient_id, content, embedding, source, created_at) VALUES (?, ?, ?, ?, ?)');
  const insertConsultation = db.prepare(
    'INSERT INTO doctor_consultations (patient_id, status, fee_cents, token, trigger, created_at, paid_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const makePatient = (name: string, age: number, gender: string, condition: string, persona: string, createdAt: Date) => {
    const id = generateId();
    insertPatient.run(id, name, age, gender, condition, persona, toSqliteLocal(createdAt));
    return id;
  };

  db.transaction(() => {
    db.prepare('DELETE FROM doctor_consultations').run();
    db.prepare('DELETE FROM chat_messages').run();
    db.prepare('DELETE FROM patient_ai_state').run();
    db.prepare('DELETE FROM memories').run();
    db.prepare('DELETE FROM patients').run();

    const t0 = addMinutes(now, -35);
    const pA = makePatient(
      '李华',
      28,
      '男',
      '咳嗽发热',
      '沟通偏好：希望简洁明确的建议；担心影响工作。\n健康标签：近期发热咳嗽。\n风险点：有药物过敏史（青霉素）。',
      addMinutes(t0, -2)
    );
    insertChat.run(pA, 'ai', buildDoctorAssistantIntro(), toSqliteLocal(t0));
    insertChat.run(pA, 'user', '医生您好，我这两天咳嗽、发热，晚上更明显。', toSqliteLocal(addMinutes(t0, 2)));
    insertChat.run(
      pA,
      'ai',
      [
        '收到。为了让医生更快判断，我先帮您把情况问清楚：',
        '体温最高多少？',
        '发热持续几天了？',
        '咳嗽是干咳还是有痰？',
        '痰什么颜色？',
        '有没有胸闷气短、胸痛、喘鸣？',
        '有没有流涕、咽痛、肌肉酸痛？',
        '最近是否接触感冒人群？',
        '目前在用什么药？',
        '有无药物过敏？',
      ].join('\n'),
      toSqliteLocal(addMinutes(t0, 3))
    );
    insertChat.run(
      pA,
      'user',
      '最高38.6，发热两天。咳嗽有点痰偏黄，嗓子疼。没有胸痛，就是有点喘。没吃抗生素，吃了点对乙酰氨基酚。青霉素过敏。',
      toSqliteLocal(addMinutes(t0, 7))
    );
    insertMemory.run(pA, '主诉=咳嗽发热2天', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, '体温最高=38.6℃', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, '咳嗽=有黄痰', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, '伴随=咽痛/轻微气喘', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, '用药=对乙酰氨基酚', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertMemory.run(pA, '过敏史=青霉素', null, 'patient', toSqliteLocal(addMinutes(t0, 7)));
    insertChat.run(
      pA,
      'assistant',
      [
        '我先帮您记录一下：发热2天最高38.6℃、黄痰咳嗽、咽痛、轻微喘、青霉素过敏，已服用对乙酰氨基酚。',
        '您方便再补充两点吗：',
        '血氧（如有）大概多少？',
        '喘是活动后明显还是静息也喘？',
      ].join('\n'),
      toSqliteLocal(addMinutes(t0, 9))
    );
    insertChat.run(pA, 'user', '我想直接找医生和我说话。', toSqliteLocal(addMinutes(t0, 12)));

    const tokenA = generateToken();
    insertConsultation.run(pA, 'pending', 1999, tokenA, 'ai', toSqliteLocal(addMinutes(t0, 12)), null, null);
    insertChat.run(
      pA,
      'ai',
      '已为您准备医生会诊服务（演示）。\n请回复数字 1 确认接入，确认后我将发送支付链接。\n（提示：支付后医生端才可见并建立会话）',
      toSqliteLocal(addMinutes(t0, 13))
    );

    const t1 = addMinutes(now, -25);
    const pB = makePatient(
      '王敏',
      35,
      '女',
      '胃痛反酸',
      '沟通偏好：希望先确认是否严重、再给可执行的日常注意事项。\n健康标签：上腹不适、反酸夜间加重。\n生活习惯：可能作息不规律（待补充）。',
      addMinutes(t1, -2)
    );
    insertChat.run(pB, 'ai', buildDoctorAssistantIntro(), toSqliteLocal(t1));
    insertChat.run(pB, 'user', '我最近总是胃痛、反酸，晚上更难受。', toSqliteLocal(addMinutes(t1, 2)));
    insertMemory.run(pB, '主诉=胃痛/反酸', null, 'patient', toSqliteLocal(addMinutes(t1, 2)));
    insertMemory.run(pB, '特点=夜间更难受', null, 'patient', toSqliteLocal(addMinutes(t1, 2)));
    insertChat.run(
      pB,
      'ai',
      [
        '收到，我先帮您把信息补齐：',
        '胃痛位置大概在上腹正中还是偏左/偏右？',
        '反酸/烧心是否与进食有关？',
        '空腹会不会更痛？',
        '有没有恶心呕吐？',
        '有没有黑便/便血？',
        '体重近期有明显下降吗？',
        '近期是否熬夜？',
        '是否饮酒？',
        '咖啡/辛辣是否增加？',
        '是否在用止痛药（如布洛芬等）？',
        '既往胃炎/胃溃疡/幽门螺杆菌史？',
      ].join('\n'),
      toSqliteLocal(addMinutes(t1, 3))
    );
    insertChat.run(
      pB,
      'assistant',
      '在医生回复前，您可以先做两件事：这两天尽量清淡少量多餐、睡前3小时不进食；如果出现黑便/呕血、持续加重腹痛或明显消瘦，请及时就医。',
      toSqliteLocal(addMinutes(t1, 6))
    );

    const t2 = addMinutes(now, -18);
    const pC = makePatient(
      '赵强',
      62,
      '男',
      '高血压糖尿病',
      '沟通偏好：希望解释清楚原因与应对方法。\n健康标签：高血压、糖尿病。\n风险点：血压波动伴头晕（需排查红旗症状）。',
      addMinutes(t2, -2)
    );
    insertChat.run(pC, 'ai', buildDoctorAssistantIntro(), toSqliteLocal(t2));
    insertChat.run(pC, 'user', '我血压最近忽高忽低，晚上头晕，血糖也不太稳。', toSqliteLocal(addMinutes(t2, 2)));
    insertMemory.run(pC, '慢病=高血压/糖尿病', null, 'import', toSqliteLocal(addMinutes(t2, 2)));
    insertMemory.run(pC, '近期=血压波动+夜间头晕+血糖不稳', null, 'patient', toSqliteLocal(addMinutes(t2, 2)));
    insertChat.run(
      pC,
      'ai',
      [
        '收到。为了让医生更快判断，我先问几个关键点：',
        '最近一周最高/最低血压大概多少？',
        '测量是在安静坐位吗？',
        '头晕是旋转感还是发飘？',
        '有没有胸闷、心悸、视物模糊？',
        '目前在用哪些降压药、降糖药？',
        '有无漏服或自行加量？',
        '最近盐摄入有没有变化？',
        '最近饮酒有没有变化？',
        '睡眠、情绪、活动量有没有变化？',
        '有没有手脚麻木？',
        '有没有说话含糊？',
        '有没有单侧无力等情况？',
      ].join('\n'),
      toSqliteLocal(addMinutes(t2, 3))
    );
    insertChat.run(
      pC,
      'assistant',
      '我先把情况整理给医生。您先别着急，先把最近3天的血压/血糖记录一下（早晚各一次），发我：血压值、心率、血糖值以及当时是否有头晕。',
      toSqliteLocal(addMinutes(t2, 6))
    );
    insertChat.run(pC, 'user', '我要找医生。', toSqliteLocal(addMinutes(t2, 8)));

    const tokenC = generateToken();
    insertConsultation.run(pC, 'paid', 1999, tokenC, 'ai', toSqliteLocal(addMinutes(t2, 8)), toSqliteLocal(addMinutes(t2, 10)), null);
    insertChat.run(
      pC,
      'ai',
      '已为您准备医生会诊服务（演示）。\n请回复数字 1 确认接入，确认后我将发送支付链接。\n（提示：支付后医生端才可见并建立会话）',
      toSqliteLocal(addMinutes(t2, 9))
    );
    insertChat.run(pC, 'user', '1', toSqliteLocal(addMinutes(t2, 10)));
    insertChat.run(
      pC,
      'ai',
      `已确认接入医生会诊。请点击链接完成支付：/patient/pay/${encodeURIComponent(tokenC)}（演示版本：点击即视为已支付）`,
      toSqliteLocal(addMinutes(t2, 10))
    );
    insertChat.run(pC, 'ai', '支付成功，已为您接入医生会诊。', toSqliteLocal(addMinutes(t2, 11)));
    insertChat.run(
      pC,
      'doctor',
      `您好，我是${doctorName}。我先确认两点：\n1）这几天血压最高/最低大概是多少？\n2）现在头晕时有没有胸闷、心悸、说话不清或一侧肢体无力？`,
      toSqliteLocal(addMinutes(t2, 12))
    );
    insertChat.run(
      pC,
      'user',
      '最高160/95，最低110/70。头晕是发飘，偶尔心慌，没有说话不清，也没单侧无力。',
      toSqliteLocal(addMinutes(t2, 14))
    );
    insertMemory.run(pC, '血压最高=160/95', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertMemory.run(pC, '血压最低=110/70', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertMemory.run(pC, '头晕=发飘；伴随=偶尔心慌', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertMemory.run(pC, '否认=说话不清/单侧无力', null, 'patient', toSqliteLocal(addMinutes(t2, 14)));
    insertChat.run(
      pC,
      'doctor',
      '了解。结合您有高血压/糖尿病，血压波动和头晕常见原因包括：用药时间不规律、盐摄入/睡眠波动、血糖波动、脱水或体位性低血压等。\n先建议您今晚和明早按同一时间规律测量：坐位休息5分钟后测血压2次取平均，同时记录心率和指尖血糖。\n如果出现持续胸痛、明显气短、黑蒙/晕厥、说话含糊或一侧无力，请立即就医/拨打120。\n您目前具体在用哪些降压药和降糖药？每天几点服？',
      toSqliteLocal(addMinutes(t2, 16))
    );
  })();

  revalidatePath('/');
  revalidatePath('/assistant');
  revalidatePath('/doctor');
  revalidatePath('/patient');
  return { success: true };
}

// Action: 创建患者
export async function createPatient(formData: FormData) {
  const name = formData.get('name') as string;
  const age = parseInt(formData.get('age') as string);
  const gender = formData.get('gender') as string;
  const condition = formData.get('condition') as string;
  
  const id = generateId(); // 或者 import { nanoid } from 'nanoid'; const id = nanoid();
  const initialPersona = '新创建患者，暂无详细画像。';

  db.transaction(() => {
    db.prepare('INSERT INTO patients (id, name, age, gender, condition, persona) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      name,
      age,
      gender,
      condition,
      initialPersona
    );
  })();
  await ensurePatientIntroMessage(id);
  
  revalidatePath('/');
  return { success: true, id };
}

// Action: 更新患者信息
export async function updatePatient(id: string, formData: FormData) {
    const name = formData.get('name') as string;
    const age = parseInt(formData.get('age') as string);
    const gender = formData.get('gender') as string;
    const condition = formData.get('condition') as string;

    const stmt = db.prepare(`
        UPDATE patients 
        SET name = ?, age = ?, gender = ?, condition = ?
        WHERE id = ?
    `);

    stmt.run(name, age, gender, condition, id);
    revalidatePath('/');
    return { success: true };
}

// Action: 删除患者
export async function deletePatient(id: string) {
    db.prepare('DELETE FROM patients WHERE id = ?').run(id);
    revalidatePath('/');
    return { success: true };
}

// Action: 导入并分析患者资料
export async function importPatientData(patientId: string, textData: string) {
  console.log(`[Import] 开始分析患者 ${patientId} 的资料...`);

  await storeKeywordsToMemories(patientId, 'import', textData);

  // 3. 更新画像
  const patient = db.prepare('SELECT persona FROM patients WHERE id = ?').get(patientId) as { persona: string | null } | undefined;
  const newPersona = await updatePersona(patient?.persona ?? '', textData); // 用原始文本更新画像，或者用事实列表更新
  
  db.prepare('UPDATE patients SET persona = ? WHERE id = ?').run(newPersona, patientId);
  console.log(`[Persona] 画像已更新。`);

  revalidatePath('/');
  return { success: true, newPersona };
}

// Action: 处理用户对话
type HistoryMessage = { role: 'user' | 'ai' | 'assistant' | 'doctor'; content: string };
export async function processUserMessage(patientId: string, message: string, history: HistoryMessage[]) {
  try {
    console.log(`[processUserMessage] Processing for ${patientId}: ${message}`);
    const normalized = message.trim();

    insertChatMessage(patientId, 'user', message);

    const isDoctorConfirm =
      normalized === '1' ||
      normalized === '确认1' ||
      normalized === '确认 1' ||
      normalized.toLowerCase() === 'confirm1' ||
      normalized.toLowerCase() === 'confirm 1';

    if (isDoctorConfirm) {
      const existing = db
        .prepare(
          "SELECT id, token, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1"
        )
        .get(patientId) as { id: number; token: string; status: 'pending' | 'paid' } | undefined;

      if (!existing) {
        const reply = '未检测到待确认的医生会诊请求。如需医生会诊，请发送“我要找医生”。';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', '用户发送1，但未检测到会诊请求');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      if (existing.status === 'paid') {
        const reply = '您已完成支付，医生会话已建立。如需结束/重新发起，可在会话中继续沟通。';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', '用户发送1，但会诊已支付');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      const { payLink } = await startDoctorConsultation(patientId, 'ai');
      const payMsg = `已确认接入医生会诊。请点击链接完成支付：${payLink}（演示版本：点击即视为已支付）`;
      insertChatMessage(patientId, 'ai', payMsg);
      await storeKeywordsToMemories(patientId, 'ai', '用户确认医生会诊，已发送支付链接');
      return { response: payMsg, relatedFacts: '', intent: 'medical_consult' };
    }

    await storeKeywordsToMemories(patientId, 'patient', message);

    if (detectDoctorRequest(message)) {
      const existing = db
        .prepare(
          "SELECT id, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1"
        )
        .get(patientId) as { id: number; status: 'pending' | 'paid' } | undefined;

      if (existing?.status === 'paid') {
        const reply = '您已完成支付，医生会话已建立。请在本会话中继续描述情况，医生将与您沟通。';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', '用户请求医生会诊，但会诊已支付');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      await startDoctorConsultation(patientId, 'ai');
      const confirmMsg =
        '已为您准备医生会诊服务（演示）。\n请回复数字 1 确认接入，确认后我将发送支付链接。\n（提示：支付后医生端才可见并建立会话）';
      insertChatMessage(patientId, 'ai', confirmMsg);
      await storeKeywordsToMemories(patientId, 'ai', '用户请求医生会诊，等待发送1确认');
      return { response: confirmMsg, relatedFacts: '', intent: 'medical_consult' };
    }

    if (detectMedicationOrTreatmentAdviceRequest(message)) {
      const existing = db
        .prepare(
          "SELECT id, status FROM doctor_consultations WHERE patient_id = ? AND status IN ('pending','paid') ORDER BY id DESC LIMIT 1"
        )
        .get(patientId) as { id: number; status: 'pending' | 'paid' } | undefined;

      if (existing?.status === 'paid') {
        const reply = '您已完成支付，医生会话已建立。请在本会话中继续描述情况，医生将与您沟通。';
        insertChatMessage(patientId, 'ai', reply);
        await storeKeywordsToMemories(patientId, 'ai', '用户咨询用药/治疗，但会诊已支付');
        return { response: reply, relatedFacts: '', intent: 'medical_consult' };
      }

      await startDoctorConsultation(patientId, 'ai');
      const confirmMsg =
        '关于用药/治疗方案需要由医生在会诊中确认（演示）。\n请回复数字 1 确认接入医生会诊，确认后我将发送支付链接。\n（提示：支付后医生端才可见并建立会话）';
      insertChatMessage(patientId, 'ai', confirmMsg);
      await storeKeywordsToMemories(patientId, 'ai', '用户咨询用药/治疗，已引导医生会诊确认');
      return { response: confirmMsg, relatedFacts: '', intent: 'medical_consult' };
    }

    // 1. 意图识别
    let intent: 'medical_consult' | 'chitchat_admin' = 'medical_consult';
    try {
      intent = await classifyIntent(message);
    } catch {
      intent = 'medical_consult';
    }
    if (intent === 'chitchat_admin' && isMedicalRelatedText(message)) {
      intent = 'medical_consult';
    }
    console.log(`[Intent] 用户消息: "${message}" -> 意图: ${intent}`);

    const queryVec = await safeGetEmbedding(message);

    try {
      const p = db.prepare('SELECT persona FROM patients WHERE id = ?').get(patientId) as { persona: string | null } | undefined;
      if (p) {
        const newPersona = await updatePersona(p.persona ?? '', message);
        db.prepare('UPDATE patients SET persona = ? WHERE id = ?').run(newPersona, patientId);
      }
    } catch {}

    // 分支逻辑
    if (intent === 'medical_consult') {
        const MAX_MEDICAL_INQUIRIES = 3;
        const inquiryCount = getMedicalInquiryCount(patientId);
        if (inquiryCount >= MAX_MEDICAL_INQUIRIES) {
          return { response: '', relatedFacts: '', intent: 'medical_consult' };
        }

        const patient = db
          .prepare('SELECT persona, age, gender, condition FROM patients WHERE id = ?')
          .get(patientId) as { persona: string | null; age: number | null; gender: string | null; condition: string | null } | undefined;
        const facts = getRelevantPatientFacts(patientId, queryVec);
        const context = [
          patient?.condition ? `基础情况：${patient.condition}` : '',
          facts ? `关键信息：\n${facts}` : '',
        ]
          .filter(Boolean)
          .join('\n');

        let response = '';
        try {
          response = await generateDoctorAssistantIntakeResponse(doctorName, message, context, patient?.persona || '', history);
        } catch {
          response = `您现在最主要的不舒服是什么？\n从什么时候开始的？最近有加重吗？\n目前有没有在用药或已知过敏？`;
        }

        insertChatMessage(patientId, 'ai', response);
        incrementMedicalInquiryCount(patientId);
        await storeKeywordsToMemories(patientId, 'ai', response);
        return { response, relatedFacts: context, intent: 'medical_consult' };
    } else {
        // 2b. 闲聊/行政：检索知识库并回复
      
      // 检索知识库
      const allKnowledge = db.prepare("SELECT content, embedding FROM knowledge_base WHERE category = 'admin'").all() as { content: string, embedding: string }[];
      
      const scoredKnowledge = queryVec
        ? allKnowledge.map(k => ({
            content: k.content,
            score: k.embedding ? cosineSimilarity(queryVec, JSON.parse(k.embedding)) : 0
        }))
        : allKnowledge.map(k => ({
            content: k.content,
            score: 0
        }));
      
      scoredKnowledge.sort((a, b) => b.score - a.score);
      // 阈值过滤，如果相关度太低也不回复？暂取 Top 3
      // 增加阈值过滤，防止无关匹配（例如 0.4）
      const filteredKnowledge = scoredKnowledge.filter(k => k.score > 0.4);
      const topKnowledge = filteredKnowledge.slice(0, 3).map(k => k.content).join('\n');
      
      // 生成回复
      const response = await generateKnowledgeResponse(message, topKnowledge);
        
        insertChatMessage(patientId, 'ai', response);
        await storeKeywordsToMemories(patientId, 'ai', response);
        
        return { response, relatedFacts: topKnowledge, intent: 'chitchat_admin' };
    }
  } catch (error: unknown) {
    console.error("[processUserMessage] Error:", error);
    const message = error instanceof Error ? error.message : '';
    // Return a fallback error to the client so they know something went wrong
    return { 
        response: "抱歉，系统暂时无法处理您的请求，请稍后再试。", 
        relatedFacts: "", 
        intent: 'error',
        error: message
    };
  }
}

// Action: 添加知识库条目
export async function addKnowledge(content: string, category: string = 'general') {
    const embedding = await getEmbedding(content);
    
    const stmt = db.prepare(`
        INSERT INTO knowledge_base (content, embedding, category)
        VALUES (?, ?, ?)
    `);
    
    stmt.run(content, JSON.stringify(embedding), category);
    return { success: true };
}

// Action: 获取知识库列表
export async function getKnowledgeList() {
    const stmt = db.prepare('SELECT id, content, category, created_at FROM knowledge_base ORDER BY created_at DESC');
    return stmt.all() as KnowledgeItem[];
}

// Action: 导入知识库（批量）
export async function importKnowledge(textData: string) {
    // 简单按行分割
    const lines = textData.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    for (const line of lines) {
        await addKnowledge(line, 'admin'); // 默认作为行政类导入
    }
    
    return { success: true, count: lines.length };
}

// Action: 更新知识库条目
export async function updateKnowledge(id: number, content: string) {
    // 需要重新计算 embedding
    const embedding = await getEmbedding(content);
    
    const stmt = db.prepare(`
        UPDATE knowledge_base 
        SET content = ?, embedding = ?
        WHERE id = ?
    `);
    
    stmt.run(content, JSON.stringify(embedding), id);
    return { success: true };
}

// Action: 删除知识库条目
export async function deleteKnowledge(id: number) {
    const stmt = db.prepare('DELETE FROM knowledge_base WHERE id = ?');
    stmt.run(id);
    return { success: true };
}

// Action: 获取聊天记录
export async function getChatHistory(patientId: string) {
  const exists = db.prepare('SELECT 1 FROM patients WHERE id = ? LIMIT 1').get(patientId);
  if (!exists) return [] as ChatMessage[];
  await ensurePatientIntroMessage(patientId);
  const stmt = db.prepare('SELECT id, patient_id, role, content, created_at FROM chat_messages WHERE patient_id = ? ORDER BY id ASC');
  return stmt.all(patientId) as ChatMessage[];
}

// Action: 获取单条消息的详细分析信息 (RAG 检索结果模拟)
export async function getMessageAnalysis(messageId: number, patientId: string) {
    const msg = db
      .prepare("SELECT content, role FROM chat_messages WHERE id = ? AND patient_id = ?")
      .get(messageId, patientId) as { content: string; role: ChatMessage['role'] } | undefined;
    if (!msg) return null;

    const queryVec = await safeGetEmbedding(msg.content);
    if (!queryVec) return null;
    
    // 1. Find similar memories (Self-RAG?) - or finding related facts for this message
    // Let's find related medical facts or previous dialogue
    // Exclude itself
    const allMemories = db
      .prepare('SELECT id, content, embedding, source, created_at FROM memories WHERE patient_id = ?')
      .all(patientId) as Array<{ id: number; content: string; embedding: string | null; source: string | null; created_at: string }>;
    
    const scored = allMemories.flatMap((m) => {
      if (!m.embedding) return [];
      try {
        return [
          {
            content: m.content,
            source: m.source ?? 'unknown',
            created_at: m.created_at,
            score: cosineSimilarity(queryVec, JSON.parse(m.embedding)),
          },
        ];
      } catch {
        return [];
      }
    });
    
    scored.sort((a, b) => b.score - a.score);
    const relatedMemories = scored.slice(0, 3);
    
    // 2. Find related Knowledge Base
    const allKnowledge = db
      .prepare("SELECT content, embedding, category FROM knowledge_base")
      .all() as Array<{ content: string; embedding: string | null; category: string | null }>;
    const scoredKb = allKnowledge.flatMap((k) => {
      if (!k.embedding) return [];
      try {
        return [
          {
            content: k.content,
            category: k.category ?? 'general',
            score: cosineSimilarity(queryVec, JSON.parse(k.embedding)),
          },
        ];
      } catch {
        return [];
      }
    });
    scoredKb.sort((a, b) => b.score - a.score);
    const relatedKnowledge = scoredKb.slice(0, 3);

    return {
        related_memories: relatedMemories,
        related_knowledge: relatedKnowledge
    };
}

// Action: 医生发送消息
export async function sendDoctorMessage(patientId: string, message: string) {
  insertChatMessage(patientId, 'assistant', message);
  await storeKeywordsToMemories(patientId, 'ai', message);
  
  // 可以选择是否在这里更新画像，通常医生的话也是重要信息
  // 这里简化，暂不自动更新画像，或者异步更新
  
  return { success: true };
}

export async function sendRealDoctorMessage(patientId: string, message: string) {
  insertChatMessage(patientId, 'doctor', message);
  await storeKeywordsToMemories(patientId, 'doctor', message);
  return { success: true };
}

// Action: 获取医生辅助建议
export async function getDoctorCopilot(patientId: string, speaker: 'assistant' | 'doctor' = 'assistant') {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId) as Patient;
  const activeConsultation = db
    .prepare(
      "SELECT id FROM doctor_consultations WHERE patient_id = ? AND status = 'paid' AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(patientId) as { id: number } | undefined;
  const hasActiveConsultation = Boolean(activeConsultation);
  
  // 1. 检索最近的对话/记忆
  const memories = db
    .prepare('SELECT content, source, created_at FROM memories WHERE patient_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(patientId) as { content: string; source: string; created_at: string }[];
  const memoryText = memories
    .reverse()
    .map((m) => `${m.created_at} [${m.source}] ${m.content}`)
    .join('\n');

  // 2. 检索相关医疗知识库 (基于最后一条用户消息)
  let relevantKnowledge = "";
  const lastUser = db
    .prepare("SELECT content FROM chat_messages WHERE patient_id = ? AND role = 'user' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(patientId) as { content: string } | undefined;
  if (lastUser?.content) {
    const queryVec = await safeGetEmbedding(lastUser.content);
    if (queryVec) {
      const allKnowledge = db
        .prepare("SELECT content, embedding FROM knowledge_base WHERE category != 'admin'")
        .all() as { content: string; embedding: string }[];

      const scored = allKnowledge.map((k) => ({
        content: k.content,
        score: k.embedding ? cosineSimilarity(queryVec, JSON.parse(k.embedding)) : 0,
      }));

      scored.sort((a, b) => b.score - a.score);
      const filtered = scored.filter((k) => k.score > 0.4);
      relevantKnowledge = filtered.slice(0, 3).map((k) => k.content).join('\n');
    }
  }

  const suggestion = await generateDoctorCopilotSuggestion(
    [
      patient.name,
      patient.age != null ? `${patient.age}岁` : '',
      patient.condition ?? '',
    ]
      .filter(Boolean)
      .join('，'),
    patient.persona ?? '',
    memoryText,
    relevantKnowledge,
    speaker,
    hasActiveConsultation
  );

  return suggestion;
}

// Action: 获取患者的记忆列表（用于前端展示）
export async function getPatientMemories(patientId: string): Promise<Array<{ id: number; content: string; source: string | null; created_at: string }>> {
  const stmt = db.prepare(
    "SELECT id, content, source, created_at FROM memories WHERE patient_id = ? AND source != 'dialogue' ORDER BY created_at DESC LIMIT 50"
  );
  return stmt.all(patientId) as Array<{ id: number; content: string; source: string | null; created_at: string }>;
}
