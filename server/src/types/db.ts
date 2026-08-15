/**
 * Hand-written mirror of db/migrations/0001_init.sql, shaped for the
 * supabase-js `Database` generic. Once the schema is applied to a real
 * project, regenerate this with `supabase gen types typescript` and this
 * file becomes redundant — keep them in sync until then.
 */

export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type AttemptOutcome = "success" | "fail" | "blocked";
export type FixSeverity = "critical" | "high" | "medium";
export type ScheduleCadence = "daily" | "weekly";
export type PlanTier = "free" | "pro" | "agency";

export interface Database {
  public: {
    Tables: {
      sites: {
        Row: {
          id: string;
          user_id: string;
          url: string;
          label: string | null;
          client_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          url: string;
          label?: string | null;
          client_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sites"]["Insert"]>;
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          brand_color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          brand_color?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
        Relationships: [];
      };
      client_reports: {
        Row: {
          id: string;
          client_id: string;
          user_id: string;
          slug: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          user_id: string;
          slug: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["client_reports"]["Insert"]>;
        Relationships: [];
      };
      runs: {
        Row: {
          id: string;
          site_id: string;
          user_id: string;
          goal: string;
          status: RunStatus;
          score: number | null;
          completion_rate: number | null;
          cost_usd: number | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
          is_public: boolean;
          public_slug: string | null;
          attempts_total: number | null;
          bullmq_job_id: string | null;
        };
        Insert: {
          id?: string;
          site_id: string;
          user_id: string;
          goal: string;
          status?: RunStatus;
          score?: number | null;
          completion_rate?: number | null;
          cost_usd?: number | null;
          started_at?: string | null;
          finished_at?: string | null;
          created_at?: string;
          is_public?: boolean;
          bullmq_job_id?: string | null;
          public_slug?: string | null;
          attempts_total?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["runs"]["Insert"]>;
        Relationships: [];
      };
      attempts: {
        Row: {
          id: string;
          run_id: string;
          attempt_number: number;
          outcome: AttemptOutcome | null;
          stuck_reason: string | null;
          video_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          attempt_number: number;
          outcome?: AttemptOutcome | null;
          stuck_reason?: string | null;
          video_path?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["attempts"]["Insert"]>;
        Relationships: [];
      };
      checkpoints: {
        Row: {
          id: string;
          attempt_id: string;
          name: string;
          passed: boolean | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          name: string;
          passed?: boolean | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["checkpoints"]["Insert"]>;
        Relationships: [];
      };
      run_steps: {
        Row: {
          id: string;
          attempt_id: string;
          step_number: number;
          action: string;
          agent_reasoning: string | null;
          screenshot_path: string | null;
          timestamp: string;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          step_number: number;
          action: string;
          agent_reasoning?: string | null;
          screenshot_path?: string | null;
          timestamp?: string;
        };
        Update: Partial<Database["public"]["Tables"]["run_steps"]["Insert"]>;
        Relationships: [];
      };
      fixes: {
        Row: {
          id: string;
          run_id: string;
          severity: FixSeverity;
          problem: string;
          likely_cause: string | null;
          suggested_fix: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          severity: FixSeverity;
          problem: string;
          likely_cause?: string | null;
          suggested_fix: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["fixes"]["Insert"]>;
        Relationships: [];
      };
      schedules: {
        Row: {
          id: string;
          site_id: string;
          user_id: string;
          cadence: ScheduleCadence;
          goals: unknown;
          alert_threshold: number;
          alert_channels: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          user_id: string;
          cadence: ScheduleCadence;
          goals?: unknown;
          alert_threshold?: number;
          alert_channels?: unknown;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["schedules"]["Insert"]>;
        Relationships: [];
      };
      alerts: {
        Row: {
          id: string;
          site_id: string;
          user_id: string;
          triggered_at: string;
          old_score: number | null;
          new_score: number | null;
          delivered: boolean;
        };
        Insert: {
          id?: string;
          site_id: string;
          user_id: string;
          triggered_at?: string;
          old_score?: number | null;
          new_score?: number | null;
          delivered?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["alerts"]["Insert"]>;
        Relationships: [];
      };
      user_plans: {
        Row: {
          user_id: string;
          plan: PlanTier;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          plan?: PlanTier;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_plans"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
