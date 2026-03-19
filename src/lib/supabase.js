import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fallback for UI testing if no keys are provided yet
export const hasSupabaseKeys = !!(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseKeys 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
