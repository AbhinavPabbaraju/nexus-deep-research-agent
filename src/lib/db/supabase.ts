// ─── src/lib/db/supabase.ts ───────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';

type SupabaseClient = any;

let cachedClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL not set');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');

  if (!cachedClient) {
    cachedClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }

  return cachedClient;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase();
    const value = client[prop as keyof SupabaseClient];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
