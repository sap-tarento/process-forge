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
      atom_relationships: {
        Row: {
          created_at: string
          created_by: string | null
          from_atom: string
          id: string
          rationale: string | null
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          to_atom_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_atom: string
          id?: string
          rationale?: string | null
          relationship_type: Database["public"]["Enums"]["relationship_type"]
          to_atom_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_atom?: string
          id?: string
          rationale?: string | null
          relationship_type?: Database["public"]["Enums"]["relationship_type"]
          to_atom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atom_relationships_from_atom_fkey"
            columns: ["from_atom"]
            isOneToOne: false
            referencedRelation: "atoms"
            referencedColumns: ["id"]
          },
        ]
      }
      atoms: {
        Row: {
          action: Json
          activities: string[]
          applicability: Json
          atom_id: string
          business_objects: string[]
          created_at: string
          domain_tags: Json
          embedding: string | null
          governance: Json
          id: string
          knowledge_type: Database["public"]["Enums"]["knowledge_type"]
          name: string
          processes: string[]
          provenance: Json
          purpose: Json
          quality: Json
          roles: string[]
          source_id: string | null
          status: Database["public"]["Enums"]["atom_status"]
          transaction_time: string
          updated_at: string
          valid_from: string | null
          valid_to: string | null
          version: number
        }
        Insert: {
          action?: Json
          activities?: string[]
          applicability?: Json
          atom_id: string
          business_objects?: string[]
          created_at?: string
          domain_tags?: Json
          embedding?: string | null
          governance?: Json
          id?: string
          knowledge_type: Database["public"]["Enums"]["knowledge_type"]
          name: string
          processes?: string[]
          provenance?: Json
          purpose?: Json
          quality?: Json
          roles?: string[]
          source_id?: string | null
          status?: Database["public"]["Enums"]["atom_status"]
          transaction_time?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          version: number
        }
        Update: {
          action?: Json
          activities?: string[]
          applicability?: Json
          atom_id?: string
          business_objects?: string[]
          created_at?: string
          domain_tags?: Json
          embedding?: string | null
          governance?: Json
          id?: string
          knowledge_type?: Database["public"]["Enums"]["knowledge_type"]
          name?: string
          processes?: string[]
          provenance?: Json
          purpose?: Json
          quality?: Json
          roles?: string[]
          source_id?: string | null
          status?: Database["public"]["Enums"]["atom_status"]
          transaction_time?: string
          updated_at?: string
          valid_from?: string | null
          valid_to?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "atoms_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          actor?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          actor?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: []
      }
      candidate_spans: {
        Row: {
          context_window_id: string
          created_at: string
          detection_confidence: number | null
          id: string
          linguistic_form: Database["public"]["Enums"]["linguistic_form"]
          source_id: string | null
          span_text: string
          status: Database["public"]["Enums"]["candidate_status"]
        }
        Insert: {
          context_window_id: string
          created_at?: string
          detection_confidence?: number | null
          id?: string
          linguistic_form: Database["public"]["Enums"]["linguistic_form"]
          source_id?: string | null
          span_text: string
          status?: Database["public"]["Enums"]["candidate_status"]
        }
        Update: {
          context_window_id?: string
          created_at?: string
          detection_confidence?: number | null
          id?: string
          linguistic_form?: Database["public"]["Enums"]["linguistic_form"]
          source_id?: string | null
          span_text?: string
          status?: Database["public"]["Enums"]["candidate_status"]
        }
        Relationships: [
          {
            foreignKeyName: "candidate_spans_context_window_id_fkey"
            columns: ["context_window_id"]
            isOneToOne: false
            referencedRelation: "context_windows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_spans_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      change_set_items: {
        Row: {
          atom_embedding: string | null
          atom_payload: Json
          change_set_id: string
          conflict_findings: Json
          created_at: string
          curator_notes: string | null
          existing_atom: string | null
          id: string
          neighbors: Json
          operation: Database["public"]["Enums"]["change_op"]
          review_status: Database["public"]["Enums"]["review_status"]
          reviewed_at: string | null
          reviewed_by: string | null
          scenarios: Json
          validation_results: Json
        }
        Insert: {
          atom_embedding?: string | null
          atom_payload?: Json
          change_set_id: string
          conflict_findings?: Json
          created_at?: string
          curator_notes?: string | null
          existing_atom?: string | null
          id?: string
          neighbors?: Json
          operation: Database["public"]["Enums"]["change_op"]
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          scenarios?: Json
          validation_results?: Json
        }
        Update: {
          atom_embedding?: string | null
          atom_payload?: Json
          change_set_id?: string
          conflict_findings?: Json
          created_at?: string
          curator_notes?: string | null
          existing_atom?: string | null
          id?: string
          neighbors?: Json
          operation?: Database["public"]["Enums"]["change_op"]
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          scenarios?: Json
          validation_results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "change_set_items_change_set_id_fkey"
            columns: ["change_set_id"]
            isOneToOne: false
            referencedRelation: "change_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_set_items_existing_atom_fkey"
            columns: ["existing_atom"]
            isOneToOne: false
            referencedRelation: "atoms"
            referencedColumns: ["id"]
          },
        ]
      }
      change_sets: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          source_id: string | null
          status: Database["public"]["Enums"]["change_set_status"]
          summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          source_id?: string | null
          status?: Database["public"]["Enums"]["change_set_status"]
          summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          source_id?: string | null
          status?: Database["public"]["Enums"]["change_set_status"]
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_sets_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      conflicts: {
        Row: {
          atom_a: string
          atom_b_atom_id: string
          conflict_kind: Database["public"]["Enums"]["conflict_kind"]
          created_at: string
          detail: Json
          id: string
          status: Database["public"]["Enums"]["conflict_status"]
        }
        Insert: {
          atom_a: string
          atom_b_atom_id: string
          conflict_kind: Database["public"]["Enums"]["conflict_kind"]
          created_at?: string
          detail?: Json
          id?: string
          status?: Database["public"]["Enums"]["conflict_status"]
        }
        Update: {
          atom_a?: string
          atom_b_atom_id?: string
          conflict_kind?: Database["public"]["Enums"]["conflict_kind"]
          created_at?: string
          detail?: Json
          id?: string
          status?: Database["public"]["Enums"]["conflict_status"]
        }
        Relationships: [
          {
            foreignKeyName: "conflicts_atom_a_fkey"
            columns: ["atom_a"]
            isOneToOne: false
            referencedRelation: "atoms"
            referencedColumns: ["id"]
          },
        ]
      }
      context_windows: {
        Row: {
          char_end: number | null
          char_start: number | null
          created_at: string
          document_context: Json
          following_paragraph: string | null
          id: string
          local_text: string
          preceding_paragraph: string | null
          section_context: Json
          source_id: string
        }
        Insert: {
          char_end?: number | null
          char_start?: number | null
          created_at?: string
          document_context?: Json
          following_paragraph?: string | null
          id?: string
          local_text: string
          preceding_paragraph?: string | null
          section_context?: Json
          source_id: string
        }
        Update: {
          char_end?: number | null
          char_start?: number | null
          created_at?: string
          document_context?: Json
          following_paragraph?: string | null
          id?: string
          local_text?: string
          preceding_paragraph?: string | null
          section_context?: Json
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "context_windows_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_model: {
        Row: {
          category: Database["public"]["Enums"]["domain_category"]
          created_at: string
          id: string
          label: string
          parent_id: string | null
          value: string
        }
        Insert: {
          category: Database["public"]["Enums"]["domain_category"]
          created_at?: string
          id?: string
          label: string
          parent_id?: string | null
          value: string
        }
        Update: {
          category?: Database["public"]["Enums"]["domain_category"]
          created_at?: string
          id?: string
          label?: string
          parent_id?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_model_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "domain_model"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_settings: {
        Row: {
          api_key_secret_name: string | null
          embedding_model: string
          embedding_provider: string
          id: string
          model: string
          provider: string
          singleton: boolean
          updated_at: string
        }
        Insert: {
          api_key_secret_name?: string | null
          embedding_model?: string
          embedding_provider?: string
          id?: string
          model?: string
          provider?: string
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          api_key_secret_name?: string | null
          embedding_model?: string
          embedding_provider?: string
          id?: string
          model?: string
          provider?: string
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      memory_state: {
        Row: {
          generation: number
          id: boolean
          updated_at: string
        }
        Insert: {
          generation?: number
          id?: boolean
          updated_at?: string
        }
        Update: {
          generation?: number
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          atom_id: string | null
          change_set_item_id: string | null
          created_at: string
          event_type: string
          id: string
          read: boolean
          recipient: string
          summary: string
        }
        Insert: {
          atom_id?: string | null
          change_set_item_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          read?: boolean
          recipient: string
          summary: string
        }
        Update: {
          atom_id?: string | null
          change_set_item_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          read?: boolean
          recipient?: string
          summary?: string
        }
        Relationships: []
      }
      pipeline_run_stages: {
        Row: {
          counts: Json
          error: string | null
          finished_at: string | null
          id: string
          run_id: string
          stage: string
          started_at: string | null
          status: string
        }
        Insert: {
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          run_id: string
          stage: string
          started_at?: string | null
          status?: string
        }
        Update: {
          counts?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          run_id?: string
          stage?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_run_stages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          change_set_id: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          source_id: string
          started_at: string
          status: string
          triggered_by: string | null
        }
        Insert: {
          change_set_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          source_id: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Update: {
          change_set_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          source_id?: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_change_set_id_fkey"
            columns: ["change_set_id"]
            isOneToOne: false
            referencedRelation: "change_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      precedence_strategies: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          name: string
          priority_order: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          enabled?: boolean
          id?: string
          name: string
          priority_order?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          name?: string
          priority_order?: Json
          updated_at?: string
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          prompt_key: string
          template: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          prompt_key: string
          template: string
          version: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          prompt_key?: string
          template?: string
          version?: number
        }
        Relationships: []
      }
      resolutions: {
        Row: {
          approved_by: string | null
          conflict_id: string
          created_at: string
          id: string
          reason: string | null
          strategy: string
          winning_atom_id: string | null
        }
        Insert: {
          approved_by?: string | null
          conflict_id: string
          created_at?: string
          id?: string
          reason?: string | null
          strategy: string
          winning_atom_id?: string | null
        }
        Update: {
          approved_by?: string | null
          conflict_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          strategy?: string
          winning_atom_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resolutions_conflict_id_fkey"
            columns: ["conflict_id"]
            isOneToOne: false
            referencedRelation: "conflicts"
            referencedColumns: ["id"]
          },
        ]
      }
      source_documents: {
        Row: {
          created_at: string
          id: string
          layout: Json
          page_count: number | null
          parser_version: string
          source_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          layout?: Json
          page_count?: number | null
          parser_version: string
          source_id: string
        }
        Update: {
          created_at?: string
          id?: string
          layout?: Json
          page_count?: number | null
          parser_version?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          approval_status: string | null
          authority_class: Database["public"]["Enums"]["authority_class"]
          created_at: string
          created_by: string | null
          effective_date: string | null
          file_path: string | null
          file_sha256: string | null
          id: string
          ingestion_timestamp: string
          owner: string | null
          raw_text: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["source_type"]
          status: Database["public"]["Enums"]["source_status"]
          superseded_source_id: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          approval_status?: string | null
          authority_class: Database["public"]["Enums"]["authority_class"]
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          file_path?: string | null
          file_sha256?: string | null
          id?: string
          ingestion_timestamp?: string
          owner?: string | null
          raw_text?: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["source_type"]
          status?: Database["public"]["Enums"]["source_status"]
          superseded_source_id?: string | null
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          approval_status?: string | null
          authority_class?: Database["public"]["Enums"]["authority_class"]
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          file_path?: string | null
          file_sha256?: string | null
          id?: string
          ingestion_timestamp?: string
          owner?: string | null
          raw_text?: string | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["source_type"]
          status?: Database["public"]["Enums"]["source_status"]
          superseded_source_id?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_superseded_source_id_fkey"
            columns: ["superseded_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_proposals: {
        Row: {
          category: Database["public"]["Enums"]["domain_category"]
          created_at: string
          id: string
          label: string
          rationale: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_change_set_item: string | null
          status: string
          updated_at: string
          value: string
        }
        Insert: {
          category: Database["public"]["Enums"]["domain_category"]
          created_at?: string
          id?: string
          label: string
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_change_set_item?: string | null
          status?: string
          updated_at?: string
          value: string
        }
        Update: {
          category?: Database["public"]["Enums"]["domain_category"]
          created_at?: string
          id?: string
          label?: string
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_change_set_item?: string | null
          status?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_proposals_source_change_set_item_fkey"
            columns: ["source_change_set_item"]
            isOneToOne: false
            referencedRelation: "change_set_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
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
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "policy_owner" | "curator" | "reviewer" | "viewer"
      atom_status:
        | "candidate"
        | "under_review"
        | "approved"
        | "active"
        | "superseded"
        | "withdrawn"
      authority_class: "NORMATIVE" | "DESCRIPTIVE"
      candidate_status: "pending" | "accepted" | "rejected"
      change_op: "add" | "modify" | "remove" | "no_change" | "conflict_review"
      change_set_status:
        | "draft"
        | "pending_review"
        | "partially_applied"
        | "applied"
        | "rejected"
      conflict_kind:
        | "duplicate"
        | "overlap"
        | "specializes"
        | "generalizes"
        | "incompatible_action"
      conflict_status: "open" | "resolved" | "dismissed"
      domain_category:
        | "corporate_function"
        | "end_to_end_process"
        | "process"
        | "activity"
        | "business_object"
        | "role"
        | "system"
        | "organizational_unit"
      knowledge_type:
        | "OBLIGATION"
        | "PROHIBITION"
        | "PERMISSION"
        | "RESPONSIBILITY"
        | "DECISION_RULE"
        | "DATA_REQUIREMENT"
        | "ESCALATION"
        | "SEQUENCE"
        | "TEMPORAL_RULE"
        | "EXCEPTION"
      linguistic_form:
        | "explicit_obligation"
        | "prohibition"
        | "conditional_obligation"
        | "exception"
        | "responsibility_assignment"
        | "implicit_requirement"
      relationship_type:
        | "DUPLICATES"
        | "OVERLAPS"
        | "CONFLICTS_WITH"
        | "SPECIALIZES"
        | "GENERALIZES"
        | "SUPERSEDES"
        | "DEPENDS_ON"
        | "EXCEPTION_TO"
        | "DERIVED_FROM"
        | "IMPLEMENTS"
      review_status: "pending" | "approved" | "edited_approved" | "rejected"
      source_status:
        | "registered"
        | "parsed"
        | "extracting"
        | "extracted"
        | "failed"
      source_type:
        | "POLICY"
        | "SOP"
        | "REGULATION"
        | "ERP_CONFIG"
        | "EVENT_LOG"
        | "AGENT_TRACE"
        | "BPMN_MODEL"
        | "EXPERT_INPUT"
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
      app_role: ["admin", "policy_owner", "curator", "reviewer", "viewer"],
      atom_status: [
        "candidate",
        "under_review",
        "approved",
        "active",
        "superseded",
        "withdrawn",
      ],
      authority_class: ["NORMATIVE", "DESCRIPTIVE"],
      candidate_status: ["pending", "accepted", "rejected"],
      change_op: ["add", "modify", "remove", "no_change", "conflict_review"],
      change_set_status: [
        "draft",
        "pending_review",
        "partially_applied",
        "applied",
        "rejected",
      ],
      conflict_kind: [
        "duplicate",
        "overlap",
        "specializes",
        "generalizes",
        "incompatible_action",
      ],
      conflict_status: ["open", "resolved", "dismissed"],
      domain_category: [
        "corporate_function",
        "end_to_end_process",
        "process",
        "activity",
        "business_object",
        "role",
        "system",
        "organizational_unit",
      ],
      knowledge_type: [
        "OBLIGATION",
        "PROHIBITION",
        "PERMISSION",
        "RESPONSIBILITY",
        "DECISION_RULE",
        "DATA_REQUIREMENT",
        "ESCALATION",
        "SEQUENCE",
        "TEMPORAL_RULE",
        "EXCEPTION",
      ],
      linguistic_form: [
        "explicit_obligation",
        "prohibition",
        "conditional_obligation",
        "exception",
        "responsibility_assignment",
        "implicit_requirement",
      ],
      relationship_type: [
        "DUPLICATES",
        "OVERLAPS",
        "CONFLICTS_WITH",
        "SPECIALIZES",
        "GENERALIZES",
        "SUPERSEDES",
        "DEPENDS_ON",
        "EXCEPTION_TO",
        "DERIVED_FROM",
        "IMPLEMENTS",
      ],
      review_status: ["pending", "approved", "edited_approved", "rejected"],
      source_status: [
        "registered",
        "parsed",
        "extracting",
        "extracted",
        "failed",
      ],
      source_type: [
        "POLICY",
        "SOP",
        "REGULATION",
        "ERP_CONFIG",
        "EVENT_LOG",
        "AGENT_TRACE",
        "BPMN_MODEL",
        "EXPERT_INPUT",
      ],
    },
  },
} as const
