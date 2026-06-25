import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { logger } from './utils/logger.ts';

let client: MongoClient | null = null;

/** Connects to LibreChat's MongoDB. The monitor only ever reads. */
export async function connectMongo(uri: string, dbName: string): Promise<Db> {
  if (!client) {
    client = new MongoClient(uri, { maxPoolSize: 5 });
    await client.connect();
    logger.info({ dbName }, 'Connected to MongoDB (read-only usage)');
  }
  return client.db(dbName);
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
