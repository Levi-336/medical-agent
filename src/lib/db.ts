import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// 确保数据目录存在
const dataDir = path.join(process.cwd(), 'data');
console.log('Database Directory:', dataDir); // Debug log

if (!fs.existsSync(dataDir)) {
    try {
        fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
        console.error('Failed to create data directory:', e);
    }
}

// 数据库文件路径：优先使用环境变量，否则默认为 data/local.db
const dbPath = process.env.DB_PATH || path.join(dataDir, 'local.db');
console.log('Database Path:', dbPath); // Debug log

// 使用单例模式防止开发环境下多次连接
const globalForDb = global as unknown as { db: Database.Database };

// 初始化数据库连接
// 如果全局已有实例则复用，否则新建
export const db = globalForDb.db || new Database(dbPath);

if (process.env.NODE_ENV !== 'production') {
  globalForDb.db = db;
}

// 启用 WAL 模式以提高并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 初始化数据库表结构
const initDb = () => {
  // 1. 创建 patients 表 (用户档案)
  // id: UUID, name: 姓名, age: 年龄, gender: 性别, condition: 基础病, persona: AI画像, created_at: 创建时间
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      age INTEGER,
      gender TEXT,
      condition TEXT,
      persona TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // 2. 创建 memories 表 (向量记忆)
  // id: 自增主键, patient_id: 关联病人, content: 记忆内容, embedding: 向量(JSON), source: 来源, created_at: 创建时间
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )
  `);

  // 2.5 创建 chat_messages 表 (完整聊天记录，仅用于展示)
  // id: 自增主键, patient_id: 关联病人, role: user/ai/doctor, content: 原始消息, created_at: 创建时间
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )
  `);

  // 2.6 创建 patient_ai_state 表（患者端自动回复策略状态）
  // medical_inquiry_count: 已发送的“病情询问”自动消息条数（最多 3）
  db.exec(`
    CREATE TABLE IF NOT EXISTS patient_ai_state (
      patient_id TEXT PRIMARY KEY,
      medical_inquiry_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY(patient_id) REFERENCES patients(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
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
    )
  `);

  // 3. 创建 knowledge_base 表 (通用医疗知识库/行政问答)
  // id: 自增主键, content: 知识内容, embedding: 向量(JSON), category: 分类(admin/medical_fact), created_at: 创建时间
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      embedding TEXT,
      category TEXT DEFAULT 'general',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);
  
  // 创建索引以加速查询（可选）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_patient_id ON memories(patient_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_patient_id ON chat_messages(patient_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_patient_ai_state_patient_id ON patient_ai_state(patient_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doctor_consultations_patient_id ON doctor_consultations(patient_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doctor_consultations_status ON doctor_consultations(status)`);
};

// 执行初始化
initDb();

export default db;
