import pkg from 'pg';
const { Pool } = pkg;

export interface SoupGame {
  channelId: string;
  hostId: string;
  riddle: string;
  createdAt: Date;
}

export interface SoupQuestion {
  messageId: string;
  channelId: string;
  userId: string;
  content: string;
  answerType: 'yes' | 'no' | 'yes_and_no' | 'irrelevant' | 'highlight';
  isImportant: boolean;
  createdAt: Date;
}

class MemorySoupStore {
  private games = new Map<string, SoupGame>();
  private questions = new Map<string, SoupQuestion>();

  async createGame(channelId: string, hostId: string, riddle: string): Promise<boolean> {
    this.games.set(channelId, {
      channelId,
      hostId,
      riddle,
      createdAt: new Date()
    });
    return true;
  }

  async getGame(channelId: string): Promise<SoupGame | null> {
    return this.games.get(channelId) || null;
  }

  async deleteGame(channelId: string): Promise<boolean> {
    this.games.delete(channelId);
    // cascade delete questions
    for (const [msgId, q] of this.questions.entries()) {
      if (q.channelId === channelId) {
        this.questions.delete(msgId);
      }
    }
    return true;
  }

  async addOrUpdateQuestion(q: Omit<SoupQuestion, 'createdAt'>): Promise<boolean> {
    const existing = this.questions.get(q.messageId);
    this.questions.set(q.messageId, {
      ...q,
      createdAt: existing ? existing.createdAt : new Date()
    });
    return true;
  }

  async getQuestion(messageId: string): Promise<SoupQuestion | null> {
    return this.questions.get(messageId) || null;
  }

  async updateQuestionImportance(messageId: string, isImportant: boolean): Promise<boolean> {
    const q = this.questions.get(messageId);
    if (q) {
      q.isImportant = isImportant;
      return true;
    }
    return false;
  }

  async deleteQuestion(messageId: string): Promise<boolean> {
    return this.questions.delete(messageId);
  }

  async getQuestionsForGame(channelId: string): Promise<SoupQuestion[]> {
    return Array.from(this.questions.values())
      .filter(q => q.channelId === channelId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}

class PGSoupStore {
  private pool: any; // Type as any or pg.Pool to avoid compile issues if pg types aren't fully resolved

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }

  async init(): Promise<boolean> {
    try {
      // Test connection
      await this.pool.query('SELECT 1');
      
      // Create tables
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS soup_games (
          channel_id VARCHAR(50) PRIMARY KEY,
          host_id VARCHAR(50) NOT NULL,
          riddle TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS soup_questions (
          message_id VARCHAR(50) PRIMARY KEY,
          channel_id VARCHAR(50) NOT NULL REFERENCES soup_games(channel_id) ON DELETE CASCADE,
          user_id VARCHAR(50) NOT NULL,
          content TEXT NOT NULL,
          answer_type VARCHAR(20) NOT NULL,
          is_important BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      console.log('✅ PostgreSQL 海龟汤数据库初始化成功！');
      return true;
    } catch (err: any) {
      console.error('❌ PostgreSQL 海龟汤数据库连接/初始化失败:', err.message);
      throw err;
    }
  }

  async createGame(channelId: string, hostId: string, riddle: string): Promise<boolean> {
    await this.pool.query(
      `INSERT INTO soup_games (channel_id, host_id, riddle)
       VALUES ($1, $2, $3)
       ON CONFLICT (channel_id) DO UPDATE SET host_id = $2, riddle = $3, created_at = CURRENT_TIMESTAMP`,
      [channelId, hostId, riddle]
    );
    return true;
  }

  async getGame(channelId: string): Promise<SoupGame | null> {
    const res = await this.pool.query(
      `SELECT channel_id, host_id, riddle, created_at FROM soup_games WHERE channel_id = $1`,
      [channelId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      channelId: row.channel_id,
      hostId: row.host_id,
      riddle: row.riddle,
      createdAt: row.created_at
    };
  }

  async deleteGame(channelId: string): Promise<boolean> {
    await this.pool.query(`DELETE FROM soup_games WHERE channel_id = $1`, [channelId]);
    return true;
  }

  async addOrUpdateQuestion(q: Omit<SoupQuestion, 'createdAt'>): Promise<boolean> {
    await this.pool.query(
      `INSERT INTO soup_questions (message_id, channel_id, user_id, content, answer_type, is_important)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (message_id) DO UPDATE SET answer_type = $5, is_important = $6`,
      [q.messageId, q.channelId, q.userId, q.content, q.answerType, q.isImportant]
    );
    return true;
  }

  async getQuestion(messageId: string): Promise<SoupQuestion | null> {
    const res = await this.pool.query(
      `SELECT message_id, channel_id, user_id, content, answer_type, is_important, created_at FROM soup_questions WHERE message_id = $1`,
      [messageId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      messageId: row.message_id,
      channelId: row.channel_id,
      userId: row.user_id,
      content: row.content,
      answerType: row.answer_type,
      isImportant: row.is_important,
      createdAt: row.created_at
    };
  }

  async updateQuestionImportance(messageId: string, isImportant: boolean): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE soup_questions SET is_important = $2 WHERE message_id = $1`,
      [messageId, isImportant]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async deleteQuestion(messageId: string): Promise<boolean> {
    const res = await this.pool.query(`DELETE FROM soup_questions WHERE message_id = $1`, [messageId]);
    return (res.rowCount ?? 0) > 0;
  }

  async getQuestionsForGame(channelId: string): Promise<SoupQuestion[]> {
    const res = await this.pool.query(
      `SELECT message_id, channel_id, user_id, content, answer_type, is_important, created_at 
       FROM soup_questions 
       WHERE channel_id = $1 
       ORDER BY created_at ASC`,
      [channelId]
    );
    return res.rows.map((row: any) => ({
      messageId: row.message_id,
      channelId: row.channel_id,
      userId: row.user_id,
      content: row.content,
      answerType: row.answer_type,
      isImportant: row.is_important,
      createdAt: row.created_at
    }));
  }
}

let dbInstance: MemorySoupStore | PGSoupStore;
let isPostgres = false;

export async function initSoupDB(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      console.log('🔄 正在尝试连接 PostgreSQL 数据库...');
      const pgStore = new PGSoupStore(dbUrl);
      await pgStore.init();
      dbInstance = pgStore;
      isPostgres = true;
      return;
    } catch (err: any) {
      console.warn('⚠️ 数据库初始化失败，将降级至内存存储模式：', err.message);
    }
  } else {
    console.log('ℹ️ 未检测到 DATABASE_URL，已使用内存存储模式');
  }

  const memStore = new MemorySoupStore();
  dbInstance = memStore;
  isPostgres = false;
}

export function getSoupDB() {
  if (!dbInstance) {
    throw new Error('SoupDB has not been initialized. Call initSoupDB() first.');
  }
  return dbInstance;
}

export function isUsingPostgres(): boolean {
  return isPostgres;
}
