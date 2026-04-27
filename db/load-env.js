import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  // Allow self-signed certificates in development (Supabase)
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
