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
      conversation_reads: {
        Row: {
          conv_id: string
          kind: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conv_id: string
          kind: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conv_id?: string
          kind?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crushes: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          target_handle: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          target_handle: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          target_handle?: string
        }
        Relationships: []
      }
      group_chats: {
        Row: {
          created_at: string
          created_by: string
          emoji: string
          id: string
          last_message_at: string | null
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          emoji?: string
          id?: string
          last_message_at?: string | null
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          emoji?: string
          id?: string
          last_message_at?: string | null
          name?: string
        }
        Relationships: []
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          client_id: string | null
          created_at: string
          from_user_id: string
          group_id: string
          id: string
          text: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          from_user_id: string
          group_id: string
          id?: string
          text: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          from_user_id?: string
          group_id?: string
          id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "group_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      hints: {
        Row: {
          created_at: string
          hint_index: number
          hint_text: string
          id: string
          target_handle: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hint_index: number
          hint_text: string
          id?: string
          target_handle: string
          user_id: string
        }
        Update: {
          created_at?: string
          hint_index?: number
          hint_text?: string
          id?: string
          target_handle?: string
          user_id?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          channel: string
          created_at: string
          id: string
          phone_hash: string | null
          sender_id: string
          target_handle: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          id?: string
          phone_hash?: string | null
          sender_id: string
          target_handle?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          phone_hash?: string | null
          sender_id?: string
          target_handle?: string | null
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string
          expires_at: string | null
          expiry_warned_at: string | null
          id: string
          last_message_at: string | null
          saved: boolean
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          expiry_warned_at?: string | null
          id?: string
          last_message_at?: string | null
          saved?: boolean
          user_a_id: string
          user_b_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          expiry_warned_at?: string | null
          id?: string
          last_message_at?: string | null
          saved?: boolean
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          client_id: string | null
          created_at: string
          from_user_id: string
          id: string
          match_id: string
          text: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          from_user_id: string
          id?: string
          match_id: string
          text: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          from_user_id?: string
          id?: string
          match_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_questions: {
        Row: {
          created_at: string
          id: string
          status: string
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      poll_questions: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          text: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          text: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          text?: string
        }
        Relationships: []
      }
      poll_share_events: {
        Row: {
          created_at: string
          id: string
          poll_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          poll_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          poll_id?: string
          user_id?: string
        }
        Relationships: []
      }
      poll_votes: {
        Row: {
          created_at: string
          id: string
          poll_id: string
          user_id: string
          voted_handle: string
        }
        Insert: {
          created_at?: string
          id?: string
          poll_id: string
          user_id: string
          voted_handle: string
        }
        Update: {
          created_at?: string
          id?: string
          poll_id?: string
          user_id?: string
          voted_handle?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_votes_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          active_date: string | null
          created_at: string
          created_by: string | null
          id: string
          option_handles: string[]
          question: string
          question_id: string | null
          school: string | null
        }
        Insert: {
          active_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          option_handles: string[]
          question: string
          question_id?: string | null
          school?: string | null
        }
        Update: {
          active_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          option_handles?: string[]
          question?: string
          question_id?: string | null
          school?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          created_at: string
          crush_slots: number
          dob: string | null
          emoji: string
          god_mode_expires_at: string | null
          handle: string
          handle_confirmed_at: string | null
          hint_credits: number
          id: string
          instagram_avatar: string | null
          instagram_followers: number | null
          instagram_handle: string | null
          instagram_name: string | null
          instagram_verified_at: string | null
          instagram_verify_code: string | null
          name: string
          onboarded_at: string | null
          phone_e164: string | null
          push_enabled: boolean
          referral_code: string | null
          referred_by: string | null
          school: string | null
          streak_count: number
          streak_last_open: string | null
          trust_score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          crush_slots?: number
          dob?: string | null
          emoji?: string
          god_mode_expires_at?: string | null
          handle: string
          handle_confirmed_at?: string | null
          hint_credits?: number
          id?: string
          instagram_avatar?: string | null
          instagram_followers?: number | null
          instagram_handle?: string | null
          instagram_name?: string | null
          instagram_verified_at?: string | null
          instagram_verify_code?: string | null
          name: string
          onboarded_at?: string | null
          phone_e164?: string | null
          push_enabled?: boolean
          referral_code?: string | null
          referred_by?: string | null
          school?: string | null
          streak_count?: number
          streak_last_open?: string | null
          trust_score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          crush_slots?: number
          dob?: string | null
          emoji?: string
          god_mode_expires_at?: string | null
          handle?: string
          handle_confirmed_at?: string | null
          hint_credits?: number
          id?: string
          instagram_avatar?: string | null
          instagram_followers?: number | null
          instagram_handle?: string | null
          instagram_name?: string | null
          instagram_verified_at?: string | null
          instagram_verify_code?: string | null
          name?: string
          onboarded_at?: string | null
          phone_e164?: string | null
          push_enabled?: boolean
          referral_code?: string | null
          referred_by?: string | null
          school?: string | null
          streak_count?: number
          streak_last_open?: string | null
          trust_score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          metadata: Json
          product: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          id?: string
          metadata?: Json
          product: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          metadata?: Json
          product?: string
          user_id?: string
        }
        Relationships: []
      }
      quiz_answers: {
        Row: {
          created_at: string
          flag: string | null
          id: string
          sleep: string | null
          texting: string | null
          updated_at: string
          user_id: string
          vibe: string | null
          weekend: string | null
        }
        Insert: {
          created_at?: string
          flag?: string | null
          id?: string
          sleep?: string | null
          texting?: string | null
          updated_at?: string
          user_id: string
          vibe?: string | null
          weekend?: string | null
        }
        Update: {
          created_at?: string
          flag?: string | null
          id?: string
          sleep?: string | null
          texting?: string | null
          updated_at?: string
          user_id?: string
          vibe?: string | null
          weekend?: string | null
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referred_user_id: string
          referrer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          referred_user_id: string
          referrer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          referred_user_id?: string
          referrer_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          id: string
          reason: string
          reported_user_id: string
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          reported_user_id: string
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          reported_user_id?: string
          reporter_id?: string
        }
        Relationships: []
      }
      weekly_superlatives: {
        Row: {
          created_at: string
          id: string
          question: string
          question_id: string | null
          school: string | null
          votes: number
          week_start: string
          winner_handle: string
        }
        Insert: {
          created_at?: string
          id?: string
          question: string
          question_id?: string | null
          school?: string | null
          votes?: number
          week_start: string
          winner_handle: string
        }
        Update: {
          created_at?: string
          id?: string
          question?: string
          question_id?: string | null
          school?: string | null
          votes?: number
          week_start?: string
          winner_handle?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_trust_score: { Args: { _user_id: string }; Returns: number }
      cast_poll_vote: {
        Args: { _handle: string; _poll_id: string }
        Returns: Json
      }
      claim_handle: { Args: { _new_handle: string }; Returns: Json }
      claim_referral: { Args: { _code: string }; Returns: Json }
      create_group_atomic: {
        Args: { _emoji: string; _member_ids: string[]; _name: string }
        Returns: Json
      }
      create_poll: {
        Args: { _handles: string[]; _question: string }
        Returns: Json
      }
      generate_daily_polls: { Args: never; Returns: Json }
      get_my_incoming_poll_stats: { Args: never; Returns: Json }
      get_polls_feed: { Args: never; Returns: Json }
      is_group_member: {
        Args: { _group_id: string; _user_id: string }
        Returns: boolean
      }
      is_match_participant: {
        Args: { _match_id: string; _user_id: string }
        Returns: boolean
      }
      latest_group_previews: {
        Args: never
        Returns: {
          created_at: string
          from_user_id: string
          group_id: string
          text: string
        }[]
      }
      latest_match_previews: {
        Args: never
        Returns: {
          created_at: string
          from_user_id: string
          match_id: string
          text: string
        }[]
      }
      mark_conversation_read: {
        Args: { _conv_id: string; _kind: string }
        Returns: Json
      }
      record_purchase_and_grant: {
        Args: {
          _amount_cents: number
          _match_id?: string
          _product: string
          _session_id: string
          _user_id: string
        }
        Returns: Json
      }
      referral_slot_target: { Args: { _count: number }; Returns: number }
      refresh_trust_score: { Args: { _user_id: string }; Returns: undefined }
      repair_missing_referral: { Args: never; Returns: Json }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
