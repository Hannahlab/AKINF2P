// ==========================================
// AKINF2P SUPABASE CONFIG
// The publishable/anon key below is safe to expose in frontend
// code — it's designed to be public. Real access control comes
// from the Row Level Security policies in supabase/schema.sql,
// not from hiding this key. NEVER put a service_role/secret key
// in any file that ships to the browser.
//
// IMPORTANT: the Supabase library itself creates a global called
// `supabase` when loaded via the plain <script> CDN tag. We name
// our own client `supabaseClient` (not `supabase`) specifically
// to avoid colliding with that — declaring `const supabase` on
// top of the library's own `var supabase` throws a SyntaxError
// ("Identifier 'supabase' has already been declared"), which is
// exactly the bug that was breaking every button on the site.
// ==========================================

const SUPABASE_URL = "https://aegjuqehdmkpmliiuvug.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vL01ejCm0illo4lvdBkWYg_O9Ep9-1v";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
