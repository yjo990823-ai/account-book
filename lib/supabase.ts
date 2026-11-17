import { createClient } from "@supabase/supabase-js";
import type { ExpenseCategory } from "./categories";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type ExpenseRow = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory | string | null;
};
