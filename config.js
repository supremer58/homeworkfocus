// Supabase project credentials (safe for the browser — protected by Row Level
// Security policies on the database side, not by keeping this secret).
const SUPABASE_URL = 'https://vjusvltqznavhwtggpds.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fZTuxE-9j9j-c4a00LGEVQ_Wy6FYIyW';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
