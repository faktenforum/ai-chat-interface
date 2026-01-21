import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/LibreChat';

/**
 * Wait for MongoDB to be ready and connect
 */
export async function connectToMongoDB(maxRetries = 30, delayMs = 2000): Promise<void> {
  // Check if already connected
  if (mongoose.connection.readyState === 1) {
    console.log('✓ Already connected to MongoDB');
    return;
  }
  
  console.log('Waiting for MongoDB to be ready...');
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000
      });
      console.log('✓ Connected to MongoDB');
      return;
    } catch (error) {
      console.log(`  Attempt ${i + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw new Error('MongoDB not available after maximum retries');
}

/**
 * Disconnect from MongoDB if connected
 */
export async function disconnectFromMongoDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

/**
 * Get MongoDB connection state
 */
export function isMongoDBConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Get User model (shared across modules)
 */
export interface IUser extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  email: string;
  role: string;
}

export const User = mongoose.models.User || mongoose.model<IUser>('User', new mongoose.Schema({}, { strict: false }));
