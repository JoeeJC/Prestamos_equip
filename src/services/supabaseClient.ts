import { createClient } from '@supabase/supabase-js';
import { createMockClient } from '@/mocks/mockSupabaseClient';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawKey &&
  rawUrl.startsWith('https://') &&
  !rawUrl.includes('tu-proyecto') &&
  !rawUrl.includes('example.com')
);

export const supabase: any = isSupabaseConfigured
  ? createClient(rawUrl, rawKey, { auth: { persistSession: false } })
  : createMockClient();
