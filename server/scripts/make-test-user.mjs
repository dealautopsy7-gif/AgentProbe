import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const email = `verify-${Date.now()}@agentprobe-test.local`;
const password = "Verify-123!";
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error(error); process.exit(1); }
console.log(JSON.stringify({ email, password, userId: data.user.id }));
