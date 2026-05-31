export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      pm_tasks: {
        Row: {
          created_at: string
          discipline: Database["public"]["Enums"]["discipline"]
          frequency: string
          hours_per_year: number
          id: string
          in_house: boolean
          mins_per_asset: number
          notes: string | null
          num_assets: number
          periodicity_multiplier: number
          sfg20_code: string | null
          site_id: string
          statutory: boolean
          task_name: string
          wo_type: Database["public"]["Enums"]["wo_type"]
        }
        Insert: {
          created_at?: string
          discipline?: Database["public"]["Enums"]["discipline"]
          frequency?: string
          hours_per_year?: number
          id?: string
          in_house?: boolean
          mins_per_asset?: number
          notes?: string | null
          num_assets?: number
          periodicity_multiplier?: number
          sfg20_code?: string | null
          site_id: string
          statutory?: boolean
          task_name: string
          wo_type?: Database["public"]["Enums"]["wo_type"]
        }
        Update: {
          created_at?: string
          discipline?: Database["public"]["Enums"]["discipline"]
          frequency?: string
          hours_per_year?: number
          id?: string
          in_house?: boolean
          mins_per_asset?: number
          notes?: string | null
          num_assets?: number
          periodicity_multiplier?: number
          sfg20_code?: string | null
          site_id?: string
          statutory?: boolean
          task_name?: string
          wo_type?: Database["public"]["Enums"]["wo_type"]
        }
        Relationships: [
          {
            foreignKeyName: "pm_tasks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          last_login_at: string | null
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id: string
          last_login_at?: string | null
          name?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          last_login_at?: string | null
          name?: string
        }
        Relationships: []
      }
      site_access: {
        Row: {
          id: string
          site_id: string
          user_id: string
        }
        Insert: {
          id?: string
          site_id: string
          user_id: string
        }
        Update: {
          id?: string
          site_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_access_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          annual_leave_days: number
          client: string
          concurrent_shifts: number
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at: string
          hours_per_shift: number
          id: string
          location: string
          min_on_site: number
          name: string
          operating_pattern: Database["public"]["Enums"]["operating_pattern"]
          owner_id: string
          reactive_hours_per_year: number
          shift_model: Database["public"]["Enums"]["shift_model"]
          sickness_days: number
          training_days: number
          updated_at: string
          work_days_per_year: number
          wt_admin: number
          wt_breakin: number
          wt_cleanup: number
          wt_coordination: number
          wt_escorting: number
          wt_idle: number
          wt_meetings: number
          wt_parts: number
          wt_permits: number
          wt_setup: number
          wt_training: number
          wt_travel: number
        }
        Insert: {
          annual_leave_days?: number
          client?: string
          concurrent_shifts?: number
          contract_type?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          hours_per_shift?: number
          id?: string
          location?: string
          min_on_site?: number
          name: string
          operating_pattern?: Database["public"]["Enums"]["operating_pattern"]
          owner_id: string
          reactive_hours_per_year?: number
          shift_model?: Database["public"]["Enums"]["shift_model"]
          sickness_days?: number
          training_days?: number
          updated_at?: string
          work_days_per_year?: number
          wt_admin?: number
          wt_breakin?: number
          wt_cleanup?: number
          wt_coordination?: number
          wt_escorting?: number
          wt_idle?: number
          wt_meetings?: number
          wt_parts?: number
          wt_permits?: number
          wt_setup?: number
          wt_training?: number
          wt_travel?: number
        }
        Update: {
          annual_leave_days?: number
          client?: string
          concurrent_shifts?: number
          contract_type?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          hours_per_shift?: number
          id?: string
          location?: string
          min_on_site?: number
          name?: string
          operating_pattern?: Database["public"]["Enums"]["operating_pattern"]
          owner_id?: string
          reactive_hours_per_year?: number
          shift_model?: Database["public"]["Enums"]["shift_model"]
          sickness_days?: number
          training_days?: number
          updated_at?: string
          work_days_per_year?: number
          wt_admin?: number
          wt_breakin?: number
          wt_cleanup?: number
          wt_coordination?: number
          wt_escorting?: number
          wt_idle?: number
          wt_meetings?: number
          wt_parts?: number
          wt_permits?: number
          wt_setup?: number
          wt_training?: number
          wt_travel?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_site: { Args: { _site_id: string }; Returns: boolean }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      update_last_login: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "editor" | "viewer"
      contract_type: "TFM" | "Hard FM" | "Soft FM" | "Self-delivered"
      discipline:
        | "HVAC"
        | "Electrical"
        | "Plumbing"
        | "BMS"
        | "Fabric"
        | "Supervisor"
        | "General"
      operating_pattern:
        | "Mon-Fri 08-17"
        | "Mon-Sat 08-17"
        | "Extended 07-19 Mon-Fri"
        | "24/7 continuous"
        | "24/5 Mon-Fri"
        | "Custom"
      shift_model:
        | "Day work"
        | "Continental 4on4off 12h"
        | "3-shift rotating 8h"
        | "2-shift early/late 8h"
        | "Custom"
      wo_type: "PM" | "Inspection" | "Statutory" | "Recurring"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
      contract_type: ["TFM", "Hard FM", "Soft FM", "Self-delivered"],
      discipline: [
        "HVAC",
        "Electrical",
        "Plumbing",
        "BMS",
        "Fabric",
        "Supervisor",
        "General",
      ],
      operating_pattern: [
        "Mon-Fri 08-17",
        "Mon-Sat 08-17",
        "Extended 07-19 Mon-Fri",
        "24/7 continuous",
        "24/5 Mon-Fri",
        "Custom",
      ],
      shift_model: [
        "Day work",
        "Continental 4on4off 12h",
        "3-shift rotating 8h",
        "2-shift early/late 8h",
        "Custom",
      ],
      wo_type: ["PM", "Inspection", "Statutory", "Recurring"],
    },
  },
} as const
