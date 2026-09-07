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
      access_profiles: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          is_system: boolean
          key: string
          name: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          is_system?: boolean
          key: string
          name: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_profiles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "access_profiles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          actor_id: string | null
          brand_id: string
          client_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          payload: Json | null
          verb: string
        }
        Insert: {
          actor_id?: string | null
          brand_id: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          payload?: Json | null
          verb: string
        }
        Update: {
          actor_id?: string | null
          brand_id?: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          payload?: Json | null
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "activity_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_prompt_overrides: {
        Row: {
          agent_id: string
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          system_prompt: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          system_prompt: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          system_prompt?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_prompt_overrides_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "agent_prompt_overrides_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_prompts: {
        Row: {
          agent_id: string
          agent_name: string
          brain_enabled: boolean
          created_at: string
          default_prompt: string
          required_fields: Json
          system_prompt: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_name: string
          brain_enabled?: boolean
          created_at?: string
          default_prompt: string
          required_fields?: Json
          system_prompt: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_name?: string
          brain_enabled?: boolean
          created_at?: string
          default_prompt?: string
          required_fields?: Json
          system_prompt?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_jobs: {
        Row: {
          brand_id: string
          client_id: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          input: Json
          kind: string
          lease_expires_at: string | null
          lease_owner: string | null
          progress: number
          result: Json | null
          started_at: string | null
          status: string
          step_label: string | null
          subtitle: string | null
          target_route: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          input?: Json
          kind: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          progress?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          step_label?: string | null
          subtitle?: string | null
          target_route?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          input?: Json
          kind?: string
          lease_expires_at?: string | null
          lease_owner?: string | null
          progress?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          step_label?: string | null
          subtitle?: string | null
          target_route?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "ai_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_model_catalog_overrides: {
        Row: {
          created_at: string
          id: string
          model_id: string
          provider: string
          reason: string | null
          replaced_model_id: string | null
          role: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          model_id: string
          provider: string
          reason?: string | null
          replaced_model_id?: string | null
          role: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          model_id?: string
          provider?: string
          reason?: string | null
          replaced_model_id?: string | null
          role?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_model_health: {
        Row: {
          checked_at: string
          error_message: string | null
          id: string
          model_id: string
          provider: string
          role: string
          status: string
        }
        Insert: {
          checked_at?: string
          error_message?: string | null
          id?: string
          model_id: string
          provider: string
          role?: string
          status: string
        }
        Update: {
          checked_at?: string
          error_message?: string | null
          id?: string
          model_id?: string
          provider?: string
          role?: string
          status?: string
        }
        Relationships: []
      }
      ai_usage_limits: {
        Row: {
          brand_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          hard_stop: boolean
          id: string
          limit_usd: number
          notify_at_pct: number
          period: string
          scope: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          hard_stop?: boolean
          id?: string
          limit_usd: number
          notify_at_pct?: number
          period?: string
          scope: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          hard_stop?: boolean
          id?: string
          limit_usd?: number
          notify_at_pct?: number
          period?: string
          scope?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_limits_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "ai_usage_limits_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_limits_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_embeddings: {
        Row: {
          brand_id: string
          client_id: string | null
          content_summary: string
          created_at: string
          embedding: string
          event_id: string | null
          id: string
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          content_summary: string
          created_at?: string
          embedding: string
          event_id?: string | null
          id?: string
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          content_summary?: string
          created_at?: string
          embedding?: string
          event_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_embeddings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_embeddings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_embeddings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_embeddings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "brain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_events: {
        Row: {
          action: string | null
          actor_id: string | null
          brand_id: string | null
          client_id: string | null
          confidence: number | null
          correlation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          outcome_score: number | null
          payload: Json
          processed_at: string | null
          project_id: string | null
          source_module: string
        }
        Insert: {
          action?: string | null
          actor_id?: string | null
          brand_id?: string | null
          client_id?: string | null
          confidence?: number | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          outcome_score?: number | null
          payload?: Json
          processed_at?: string | null
          project_id?: string | null
          source_module: string
        }
        Update: {
          action?: string | null
          actor_id?: string | null
          brand_id?: string | null
          client_id?: string | null
          confidence?: number | null
          correlation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          outcome_score?: number | null
          payload?: Json
          processed_at?: string | null
          project_id?: string | null
          source_module?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_events_new_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_events_new_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_insights: {
        Row: {
          based_on_events: number | null
          brand_id: string | null
          client_id: string | null
          confidence: number | null
          created_at: string
          description: string
          expires_at: string | null
          id: string
          insight_type: string
          scope: string
        }
        Insert: {
          based_on_events?: number | null
          brand_id?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          description: string
          expires_at?: string | null
          id?: string
          insight_type: string
          scope?: string
        }
        Update: {
          based_on_events?: number | null
          brand_id?: string | null
          client_id?: string | null
          confidence?: number | null
          created_at?: string
          description?: string
          expires_at?: string | null
          id?: string
          insight_type?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_insights_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_insights_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_insights_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_learning_queue: {
        Row: {
          attempts: number
          brand_id: string | null
          created_at: string
          enqueued_at: string
          error: string | null
          event_id: string
          id: string
          processed_at: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          brand_id?: string | null
          created_at?: string
          enqueued_at?: string
          error?: string | null
          event_id: string
          id?: string
          processed_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          brand_id?: string | null
          created_at?: string
          enqueued_at?: string
          error?: string | null
          event_id?: string
          id?: string
          processed_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_learning_queue_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_learning_queue_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_learning_queue_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "brain_events"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_memory: {
        Row: {
          access_count: number
          brand_id: string | null
          category: string | null
          client_id: string | null
          confidence: number
          content: Json
          contradiction_count: number
          created_at: string
          decay_rate: number
          description: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          key: string
          last_accessed_at: string | null
          last_observed_at: string | null
          memory_type: string
          metadata: Json
          origin: string
          previous_confidence: number | null
          reinforcement_count: number
          relations: Json
          scope: string
          source_event: string | null
          source_refs: Json
          status: string
          subject_id: string | null
          subject_type: string | null
          tags: string[]
          title: string | null
          updated_at: string
          version: number
        }
        Insert: {
          access_count?: number
          brand_id?: string | null
          category?: string | null
          client_id?: string | null
          confidence?: number
          content?: Json
          contradiction_count?: number
          created_at?: string
          decay_rate?: number
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          key: string
          last_accessed_at?: string | null
          last_observed_at?: string | null
          memory_type: string
          metadata?: Json
          origin?: string
          previous_confidence?: number | null
          reinforcement_count?: number
          relations?: Json
          scope?: string
          source_event?: string | null
          source_refs?: Json
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          access_count?: number
          brand_id?: string | null
          category?: string | null
          client_id?: string | null
          confidence?: number
          content?: Json
          contradiction_count?: number
          created_at?: string
          decay_rate?: number
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          key?: string
          last_accessed_at?: string | null
          last_observed_at?: string | null
          memory_type?: string
          metadata?: Json
          origin?: string
          previous_confidence?: number | null
          reinforcement_count?: number
          relations?: Json
          scope?: string
          source_event?: string | null
          source_refs?: Json
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          tags?: string[]
          title?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "brain_memory_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_memory_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_memory_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_memory_versions: {
        Row: {
          brand_id: string | null
          change_reason: string | null
          changed_by: string | null
          confidence: number
          content: Json
          created_at: string
          delta_confidence: number | null
          description: string | null
          id: string
          memory_id: string
          metadata: Json
          previous_confidence: number | null
          relations: Json
          source_event: string | null
          status: string
          tags: string[]
          title: string | null
          version: number
        }
        Insert: {
          brand_id?: string | null
          change_reason?: string | null
          changed_by?: string | null
          confidence: number
          content?: Json
          created_at?: string
          delta_confidence?: number | null
          description?: string | null
          id?: string
          memory_id: string
          metadata?: Json
          previous_confidence?: number | null
          relations?: Json
          source_event?: string | null
          status?: string
          tags?: string[]
          title?: string | null
          version: number
        }
        Update: {
          brand_id?: string | null
          change_reason?: string | null
          changed_by?: string | null
          confidence?: number
          content?: Json
          created_at?: string
          delta_confidence?: number | null
          description?: string | null
          id?: string
          memory_id?: string
          metadata?: Json
          previous_confidence?: number | null
          relations?: Json
          source_event?: string | null
          status?: string
          tags?: string[]
          title?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "brain_memory_versions_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "brain_memory"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_metrics_snapshots: {
        Row: {
          brand_id: string | null
          channel: string | null
          created_at: string
          id: string
          metric_name: string
          metric_value: number
          period_end: string
          period_start: string
        }
        Insert: {
          brand_id?: string | null
          channel?: string | null
          created_at?: string
          id?: string
          metric_name: string
          metric_value: number
          period_end: string
          period_start: string
        }
        Update: {
          brand_id?: string | null
          channel?: string | null
          created_at?: string
          id?: string
          metric_name?: string
          metric_value?: number
          period_end?: string
          period_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_metrics_snapshots_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_metrics_snapshots_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_reasoning_logs: {
        Row: {
          answer_confidence: number | null
          answer_preview: string | null
          brand_id: string
          client_id: string | null
          conversation_id: string | null
          created_at: string
          decision: string
          id: string
          intent: string
          intent_confidence: number | null
          latency_ms: number | null
          memory_hits: number
          plan: Json
          question: string
          tools_used: Json
          used_llm: boolean
          user_id: string | null
        }
        Insert: {
          answer_confidence?: number | null
          answer_preview?: string | null
          brand_id: string
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          decision: string
          id?: string
          intent: string
          intent_confidence?: number | null
          latency_ms?: number | null
          memory_hits?: number
          plan?: Json
          question: string
          tools_used?: Json
          used_llm?: boolean
          user_id?: string | null
        }
        Update: {
          answer_confidence?: number | null
          answer_preview?: string | null
          brand_id?: string
          client_id?: string | null
          conversation_id?: string | null
          created_at?: string
          decision?: string
          id?: string
          intent?: string
          intent_confidence?: number | null
          latency_ms?: number | null
          memory_hits?: number
          plan?: Json
          question?: string
          tools_used?: Json
          used_llm?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brain_reasoning_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_reasoning_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_reasoning_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_reasoning_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_recommendations: {
        Row: {
          acted_at: string | null
          action_payload: Json | null
          brand_id: string | null
          client_id: string | null
          confidence: number
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          priority: string
          recommendation_type: string
          source_event_ids: string[] | null
          source_insight_id: string | null
          status: string
          target_user_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          acted_at?: string | null
          action_payload?: Json | null
          brand_id?: string | null
          client_id?: string | null
          confidence?: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          priority?: string
          recommendation_type: string
          source_event_ids?: string[] | null
          source_insight_id?: string | null
          status?: string
          target_user_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          acted_at?: string | null
          action_payload?: Json | null
          brand_id?: string | null
          client_id?: string | null
          confidence?: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          priority?: string
          recommendation_type?: string
          source_event_ids?: string[] | null
          source_insight_id?: string | null
          status?: string
          target_user_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_recommendations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_recommendations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_recommendations_source_insight_id_fkey"
            columns: ["source_insight_id"]
            isOneToOne: false
            referencedRelation: "brain_insights"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_relationships: {
        Row: {
          bidirectional: boolean
          brand_id: string | null
          client_id: string | null
          confidence: number
          created_at: string
          from_id: string
          from_type: string
          id: string
          last_observed_at: string
          metadata: Json | null
          observation_count: number
          relationship_type: string
          strength: number
          to_id: string
          to_type: string
          updated_at: string
        }
        Insert: {
          bidirectional?: boolean
          brand_id?: string | null
          client_id?: string | null
          confidence?: number
          created_at?: string
          from_id: string
          from_type: string
          id?: string
          last_observed_at?: string
          metadata?: Json | null
          observation_count?: number
          relationship_type: string
          strength?: number
          to_id: string
          to_type: string
          updated_at?: string
        }
        Update: {
          bidirectional?: boolean
          brand_id?: string | null
          client_id?: string | null
          confidence?: number
          created_at?: string
          from_id?: string
          from_type?: string
          id?: string
          last_observed_at?: string
          metadata?: Json | null
          observation_count?: number
          relationship_type?: string
          strength?: number
          to_id?: string
          to_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_relationships_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brain_relationships_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_relationships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_retention_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value_days: number
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value_days: number
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value_days?: number
        }
        Relationships: []
      }
      brain_worker_runs: {
        Row: {
          created_at: string
          discarded: number
          duration_ms: number | null
          edges_created: number
          error: string | null
          failed: number
          finished_at: string | null
          id: string
          insights_created: number
          job_name: string
          memories_created: number
          memories_updated: number
          picked: number
          processed: number
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          discarded?: number
          duration_ms?: number | null
          edges_created?: number
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          insights_created?: number
          job_name?: string
          memories_created?: number
          memories_updated?: number
          picked?: number
          processed?: number
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          discarded?: number
          duration_ms?: number | null
          edges_created?: number
          error?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          insights_created?: number
          job_name?: string
          memories_created?: number
          memories_updated?: number
          picked?: number
          processed?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      brand_ai_content: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          data: Json
          formato: string | null
          id: string
          pauta_id: string | null
          plataforma: string | null
          post_id: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          data?: Json
          formato?: string | null
          id?: string
          pauta_id?: string | null
          plataforma?: string | null
          post_id?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          formato?: string | null
          id?: string
          pauta_id?: string | null
          plataforma?: string | null
          post_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_ai_content_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_ai_content_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ai_content_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ai_content_pauta_id_fkey"
            columns: ["pauta_id"]
            isOneToOne: false
            referencedRelation: "brand_pautas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ai_content_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_ai_usage: {
        Row: {
          actor_id: string | null
          actor_kind: string
          agent: string
          attempt: number | null
          brand_id: string
          client_id: string | null
          cost_usd: number
          created_at: string
          error_kind: string | null
          error_message: string | null
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          provider: string | null
          step: string | null
          success: boolean
        }
        Insert: {
          actor_id?: string | null
          actor_kind?: string
          agent: string
          attempt?: number | null
          brand_id: string
          client_id?: string | null
          cost_usd?: number
          created_at?: string
          error_kind?: string | null
          error_message?: string | null
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          provider?: string | null
          step?: string | null
          success?: boolean
        }
        Update: {
          actor_id?: string | null
          actor_kind?: string
          agent?: string
          attempt?: number | null
          brand_id?: string
          client_id?: string | null
          cost_usd?: number
          created_at?: string
          error_kind?: string | null
          error_message?: string | null
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          provider?: string | null
          step?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "brand_ai_usage_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_ai_usage_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ai_usage_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_ai_versions: {
        Row: {
          brand_id: string
          changed_by: string | null
          client_id: string
          created_at: string
          data: Json
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          brand_id: string
          changed_by?: string | null
          client_id: string
          created_at?: string
          data: Json
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          brand_id?: string
          changed_by?: string | null
          client_id?: string
          created_at?: string
          data?: Json
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_ai_versions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_ai_versions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_ai_versions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_api_credentials: {
        Row: {
          brand_id: string
          ciphertext: string
          created_at: string
          id: string
          masked: string
          metadata: Json
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_id: string
          ciphertext: string
          created_at?: string
          id?: string
          masked: string
          metadata?: Json
          provider: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_id?: string
          ciphertext?: string
          created_at?: string
          id?: string
          masked?: string
          metadata?: Json
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_api_credentials_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_api_credentials_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_briefing_proposals: {
        Row: {
          attachments: Json
          base_version_id: string | null
          brand_id: string
          client_id: string
          created_at: string
          id: string
          note: string | null
          payload: Json
          request_id: string
          submitted_by: string | null
          submitted_via: string
        }
        Insert: {
          attachments?: Json
          base_version_id?: string | null
          brand_id: string
          client_id: string
          created_at?: string
          id?: string
          note?: string | null
          payload?: Json
          request_id: string
          submitted_by?: string | null
          submitted_via?: string
        }
        Update: {
          attachments?: Json
          base_version_id?: string | null
          brand_id?: string
          client_id?: string
          created_at?: string
          id?: string
          note?: string | null
          payload?: Json
          request_id?: string
          submitted_by?: string | null
          submitted_via?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_briefing_proposals_base_version_id_fkey"
            columns: ["base_version_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_proposals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_briefing_proposals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_proposals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_proposals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_briefing_requests: {
        Row: {
          accepted_fields: string[]
          base_version_id: string | null
          brand_id: string
          canceled_at: string | null
          client_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          due_at: string | null
          id: string
          message: string | null
          pending_fields: string[]
          promoted_version_id: string | null
          requested_at: string
          requested_by: string | null
          requested_fields: string[]
          review_decision: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string | null
        }
        Insert: {
          accepted_fields?: string[]
          base_version_id?: string | null
          brand_id: string
          canceled_at?: string | null
          client_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          due_at?: string | null
          id?: string
          message?: string | null
          pending_fields?: string[]
          promoted_version_id?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_fields?: string[]
          review_decision?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
        }
        Update: {
          accepted_fields?: string[]
          base_version_id?: string | null
          brand_id?: string
          canceled_at?: string | null
          client_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          due_at?: string | null
          id?: string
          message?: string | null
          pending_fields?: string[]
          promoted_version_id?: string | null
          requested_at?: string
          requested_by?: string | null
          requested_fields?: string[]
          review_decision?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_briefing_requests_base_version_id_fkey"
            columns: ["base_version_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_briefing_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_requests_promoted_version_id_fkey"
            columns: ["promoted_version_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_briefing_reviews: {
        Row: {
          accepted_fields: string[]
          brand_id: string
          client_id: string
          created_at: string
          decision: string
          id: string
          note: string | null
          pending_fields: string[]
          promoted: Json
          proposal_id: string | null
          request_id: string
          reviewed_by: string | null
          version_id: string | null
        }
        Insert: {
          accepted_fields?: string[]
          brand_id: string
          client_id: string
          created_at?: string
          decision: string
          id?: string
          note?: string | null
          pending_fields?: string[]
          promoted?: Json
          proposal_id?: string | null
          request_id: string
          reviewed_by?: string | null
          version_id?: string | null
        }
        Update: {
          accepted_fields?: string[]
          brand_id?: string
          client_id?: string
          created_at?: string
          decision?: string
          id?: string
          note?: string | null
          pending_fields?: string[]
          promoted?: Json
          proposal_id?: string | null
          request_id?: string
          reviewed_by?: string | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_briefing_reviews_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_reviews_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_reviews_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_briefing_versions: {
        Row: {
          brand_id: string
          changed_by: string | null
          changed_fields: string[]
          client_id: string
          completion: number
          created_at: string
          id: string
          origin: string
          snapshot: Json
          status: string
        }
        Insert: {
          brand_id: string
          changed_by?: string | null
          changed_fields?: string[]
          client_id: string
          completion?: number
          created_at?: string
          id?: string
          origin?: string
          snapshot?: Json
          status?: string
        }
        Update: {
          brand_id?: string
          changed_by?: string | null
          changed_fields?: string[]
          client_id?: string
          completion?: number
          created_at?: string
          id?: string
          origin?: string
          snapshot?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_briefing_versions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_briefing_versions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefing_versions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_briefings: {
        Row: {
          brand_id: string
          client_id: string
          completude: number
          created_at: string
          created_by: string | null
          data: Json
          id: string
          raw_text: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          completude?: number
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          raw_text?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          completude?: number
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          raw_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_briefings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_briefings_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_briefings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_cohorts: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          data: Json
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_cohorts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_cohorts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_cohorts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_competitors: {
        Row: {
          bio_colada: string | null
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          handle: string | null
          id: string
          pautas_inspiradas: Json
          posts_colados: string | null
          snapshot: Json
          updated_at: string
        }
        Insert: {
          bio_colada?: string | null
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          handle?: string | null
          id?: string
          pautas_inspiradas?: Json
          posts_colados?: string | null
          snapshot?: Json
          updated_at?: string
        }
        Update: {
          bio_colada?: string | null
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          handle?: string | null
          id?: string
          pautas_inspiradas?: Json
          posts_colados?: string | null
          snapshot?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_competitors_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_competitors_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_competitors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_connections: {
        Row: {
          brand_id: string
          channels: Json
          created_at: string
          image_provider: string
          monthly_budget_usd: number
          providers: Json
          text_fallback_provider: string | null
          text_provider: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          channels?: Json
          created_at?: string
          image_provider?: string
          monthly_budget_usd?: number
          providers?: Json
          text_fallback_provider?: string | null
          text_provider?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          channels?: Json
          created_at?: string
          image_provider?: string
          monthly_budget_usd?: number
          providers?: Json
          text_fallback_provider?: string | null
          text_provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_connections_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_connections_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_features: {
        Row: {
          brand_id: string
          created_at: string
          enabled: boolean
          enabled_at: string | null
          enabled_by: string | null
          feature_key: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature_key: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature_key?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_features_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_features_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_features_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_catalog"
            referencedColumns: ["key"]
          },
        ]
      }
      brand_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          access_profile_key: string | null
          brand_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          module_permissions: Json | null
          permissions: Json
          revoked_at: string | null
          revoked_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          temp_password_sent: boolean
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          access_profile_key?: string | null
          brand_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          module_permissions?: Json | null
          permissions?: Json
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          temp_password_sent?: boolean
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          access_profile_key?: string | null
          brand_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          module_permissions?: Json | null
          permissions?: Json
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          temp_password_sent?: boolean
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_invites_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_invites_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_journey_stage_templates: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          project_template_id: string
          stage: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          project_template_id: string
          stage: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          project_template_id?: string
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_journey_stage_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_journey_stage_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_journey_stage_templates_project_template_id_fkey"
            columns: ["project_template_id"]
            isOneToOne: false
            referencedRelation: "project_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_media_assets: {
        Row: {
          brand_id: string
          client_id: string | null
          created_at: string
          height: number | null
          id: string
          kind: string
          metadata: Json
          mime_type: string
          name: string
          size_bytes: number
          storage_path: string
          tags: string[]
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          created_at?: string
          height?: number | null
          id?: string
          kind: string
          metadata?: Json
          mime_type: string
          name: string
          size_bytes?: number
          storage_path: string
          tags?: string[]
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          created_at?: string
          height?: number | null
          id?: string
          kind?: string
          metadata?: Json
          mime_type?: string
          name?: string
          size_bytes?: number
          storage_path?: string
          tags?: string[]
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_media_assets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_media_assets_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_media_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_members: {
        Row: {
          access_profile_id: string | null
          brand_id: string
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          id: string
          is_active: boolean
          module_permissions: Json | null
          permissions: Json
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          access_profile_id?: string | null
          brand_id: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          module_permissions?: Json | null
          permissions?: Json
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          access_profile_id?: string | null
          brand_id?: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          id?: string
          is_active?: boolean
          module_permissions?: Json | null
          permissions?: Json
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_members_access_profile_id_fkey"
            columns: ["access_profile_id"]
            isOneToOne: false
            referencedRelation: "access_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_pautas: {
        Row: {
          brand_id: string
          client_id: string
          cohort_alvo: string | null
          created_at: string
          created_by: string | null
          data: Json
          formato: string | null
          formato_recomendado: string | null
          gancho: string | null
          id: string
          pilar: string | null
          pilar_type: string | null
          plataforma: string | null
          status: string
          titulo: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          cohort_alvo?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          formato?: string | null
          formato_recomendado?: string | null
          gancho?: string | null
          id?: string
          pilar?: string | null
          pilar_type?: string | null
          plataforma?: string | null
          status?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          cohort_alvo?: string | null
          created_at?: string
          created_by?: string | null
          data?: Json
          formato?: string | null
          formato_recomendado?: string | null
          gancho?: string | null
          id?: string
          pilar?: string | null
          pilar_type?: string | null
          plataforma?: string | null
          status?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_pautas_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_pautas_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_pautas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_personas: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          data: Json
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_personas_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_personas_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_personas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_swot: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          data: Json
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_swot_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_swot_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_swot_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_voice_cards: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          data: Json
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_voice_cards_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_voice_cards_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_voice_cards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          app_url: string | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          color: string | null
          complemento: string | null
          cpf: string | null
          created_at: string
          created_by: string
          estado: string | null
          icon_url: string | null
          id: string
          inactivated_at: string | null
          is_active: boolean
          login_logo_url: string | null
          logo_dark_url: string | null
          logo_url: string | null
          name: string
          nome_fantasia: string | null
          numero: string | null
          overage_policy: string
          razao_social: string | null
          rua: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          app_url?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          color?: string | null
          complemento?: string | null
          cpf?: string | null
          created_at?: string
          created_by: string
          estado?: string | null
          icon_url?: string | null
          id?: string
          inactivated_at?: string | null
          is_active?: boolean
          login_logo_url?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          name: string
          nome_fantasia?: string | null
          numero?: string | null
          overage_policy?: string
          razao_social?: string | null
          rua?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          app_url?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          color?: string | null
          complemento?: string | null
          cpf?: string | null
          created_at?: string
          created_by?: string
          estado?: string | null
          icon_url?: string | null
          id?: string
          inactivated_at?: string | null
          is_active?: boolean
          login_logo_url?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          name?: string
          nome_fantasia?: string | null
          numero?: string | null
          overage_policy?: string
          razao_social?: string | null
          rua?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      briefing_import_changes: {
        Row: {
          action: string
          brand_id: string
          client_id: string
          confidence: number | null
          created_at: string
          current_value: Json | null
          decided_at: string | null
          decided_by: string | null
          decision: string
          evidence: Json
          field: string
          id: string
          proposed_value: Json | null
          run_id: string
          updated_at: string
        }
        Insert: {
          action: string
          brand_id: string
          client_id: string
          confidence?: number | null
          created_at?: string
          current_value?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence?: Json
          field: string
          id?: string
          proposed_value?: Json | null
          run_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          brand_id?: string
          client_id?: string
          confidence?: number | null
          created_at?: string
          current_value?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          decision?: string
          evidence?: Json
          field?: string
          id?: string
          proposed_value?: Json | null
          run_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_import_changes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "briefing_import_changes_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_changes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_changes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "briefing_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_import_runs: {
        Row: {
          ai_job_id: string | null
          applied_version_id: string | null
          attempt: number
          base_version_id: string | null
          brand_id: string
          client_id: string
          confidence: number | null
          cost_cents: number | null
          counts: Json
          created_at: string
          created_by: string | null
          current_step: string | null
          deadline_at: string | null
          document_id: string | null
          error: string | null
          error_kind: string | null
          finished_at: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string | null
          input_fingerprint: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          model: string | null
          provider: string | null
          raw_text: string | null
          resume_step: string | null
          source_kind: string
          speakers: Json
          started_at: string | null
          status: string
          summary: string | null
          tokens_in: number | null
          tokens_out: number | null
          updated_at: string
        }
        Insert: {
          ai_job_id?: string | null
          applied_version_id?: string | null
          attempt?: number
          base_version_id?: string | null
          brand_id: string
          client_id: string
          confidence?: number | null
          cost_cents?: number | null
          counts?: Json
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          deadline_at?: string | null
          document_id?: string | null
          error?: string | null
          error_kind?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          input_fingerprint?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          model?: string | null
          provider?: string | null
          raw_text?: string | null
          resume_step?: string | null
          source_kind?: string
          speakers?: Json
          started_at?: string | null
          status?: string
          summary?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          updated_at?: string
        }
        Update: {
          ai_job_id?: string | null
          applied_version_id?: string | null
          attempt?: number
          base_version_id?: string | null
          brand_id?: string
          client_id?: string
          confidence?: number | null
          cost_cents?: number | null
          counts?: Json
          created_at?: string
          created_by?: string | null
          current_step?: string | null
          deadline_at?: string | null
          document_id?: string | null
          error?: string | null
          error_kind?: string | null
          finished_at?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string | null
          input_fingerprint?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          model?: string | null
          provider?: string | null
          raw_text?: string | null
          resume_step?: string | null
          source_kind?: string
          speakers?: Json
          started_at?: string | null
          status?: string
          summary?: string | null
          tokens_in?: number | null
          tokens_out?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_import_runs_ai_job_id_fkey"
            columns: ["ai_job_id"]
            isOneToOne: false
            referencedRelation: "ai_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_runs_applied_version_id_fkey"
            columns: ["applied_version_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_runs_base_version_id_fkey"
            columns: ["base_version_id"]
            isOneToOne: false
            referencedRelation: "brand_briefing_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "briefing_import_runs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_runs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "client_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      briefing_import_steps: {
        Row: {
          attempt: number
          brand_id: string
          client_id: string
          content_hash: string | null
          created_at: string
          duration_ms: number | null
          error: string | null
          error_kind: string | null
          finished_at: string | null
          id: string
          input_ref: string | null
          output: Json | null
          output_ref: string | null
          run_id: string
          started_at: string | null
          status: string
          step: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          brand_id: string
          client_id: string
          content_hash?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          error_kind?: string | null
          finished_at?: string | null
          id?: string
          input_ref?: string | null
          output?: Json | null
          output_ref?: string | null
          run_id: string
          started_at?: string | null
          status?: string
          step: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          brand_id?: string
          client_id?: string
          content_hash?: string | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          error_kind?: string | null
          finished_at?: string | null
          id?: string
          input_ref?: string | null
          output?: Json | null
          output_ref?: string | null
          run_id?: string
          started_at?: string | null
          status?: string
          step?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "briefing_import_steps_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "briefing_import_steps_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_steps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "briefing_import_steps_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "briefing_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          all_day: boolean
          brand_id: string | null
          client_id: string | null
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string | null
          id: string
          is_global: boolean
          starts_at: string
          title: string
          type: Database["public"]["Enums"]["calendar_event_type"]
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          brand_id?: string | null
          client_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_global?: boolean
          starts_at: string
          title: string
          type: Database["public"]["Enums"]["calendar_event_type"]
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          brand_id?: string | null
          client_id?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          is_global?: boolean
          starts_at?: string
          title?: string
          type?: Database["public"]["Enums"]["calendar_event_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "calendar_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      card_approval_events: {
        Row: {
          brand_id: string
          comment: string | null
          created_at: string
          id: string
          ip: unknown
          post_id: string
          token_id: string | null
          user_agent: string | null
          verb: string
        }
        Insert: {
          brand_id: string
          comment?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          post_id: string
          token_id?: string | null
          user_agent?: string | null
          verb: string
        }
        Update: {
          brand_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          ip?: unknown
          post_id?: string
          token_id?: string | null
          user_agent?: string | null
          verb?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_approval_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "card_approval_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_approval_events_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_approval_events_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "card_approval_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      card_approval_tokens: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          post_id: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          post_id: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          post_id?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_approval_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "card_approval_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_approval_tokens_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          brand_id: string | null
          client_id: string | null
          created_at: string
          id: string
          last_message_at: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "chat_conversations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachments: Json
          brain_context: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          model: string | null
          role: string
          tokens_in: number | null
          tokens_out: number | null
          tool_calls: Json
          used_llm: boolean
          user_id: string
        }
        Insert: {
          attachments?: Json
          brain_context?: Json | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          model?: string | null
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json
          used_llm?: boolean
          user_id: string
        }
        Update: {
          attachments?: Json
          brain_context?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          model?: string | null
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json
          used_llm?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_briefing_tokens: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          revoked_at: string | null
          submission: Json | null
          submitted_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          revoked_at?: string | null
          submission?: Json | null
          submitted_at?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          revoked_at?: string | null
          submission?: Json | null
          submitted_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_briefing_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "client_briefing_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_briefing_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_briefings: {
        Row: {
          client_id: string
          created_at: string
          guidelines: string | null
          hashtags: string[] | null
          id: string
          monthly_volume: number | null
          personas: Json | null
          target_audience: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          guidelines?: string | null
          hashtags?: string[] | null
          id?: string
          monthly_volume?: number | null
          personas?: Json | null
          target_audience?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          guidelines?: string | null
          hashtags?: string[] | null
          id?: string
          monthly_volume?: number | null
          personas?: Json | null
          target_audience?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_briefings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_documents: {
        Row: {
          ai_error: string | null
          ai_model: string | null
          ai_status: string
          ai_summary: Json | null
          analyzed_at: string | null
          applied_to_briefing_at: string | null
          brand_id: string
          client_id: string
          created_at: string
          extracted_text: string | null
          id: string
          mime_type: string | null
          name: string
          size_bytes: number | null
          storage_path: string
          updated_at: string
          uploaded_by: string | null
          visible_to_client: boolean
        }
        Insert: {
          ai_error?: string | null
          ai_model?: string | null
          ai_status?: string
          ai_summary?: Json | null
          analyzed_at?: string | null
          applied_to_briefing_at?: string | null
          brand_id: string
          client_id: string
          created_at?: string
          extracted_text?: string | null
          id?: string
          mime_type?: string | null
          name: string
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
          visible_to_client?: boolean
        }
        Update: {
          ai_error?: string | null
          ai_model?: string | null
          ai_status?: string
          ai_summary?: Json | null
          analyzed_at?: string | null
          applied_to_briefing_at?: string | null
          brand_id?: string
          client_id?: string
          created_at?: string
          extracted_text?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
          visible_to_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "client_documents_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_journey_events: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          from_stage: string | null
          id: string
          moved_by: string | null
          note: string | null
          project_id: string | null
          to_stage: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          from_stage?: string | null
          id?: string
          moved_by?: string | null
          note?: string | null
          project_id?: string | null
          to_stage: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          from_stage?: string | null
          id?: string
          moved_by?: string | null
          note?: string | null
          project_id?: string | null
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_journey_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "client_journey_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_journey_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      client_members: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          last_seen_at: string | null
          role: string
          user_id: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_seen_at?: string | null
          role?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_seen_at?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "client_members_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_members_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_access: {
        Row: {
          brand_id: string
          client_id: string
          owner_user_id: string | null
          permissions: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_id: string
          client_id: string
          owner_user_id?: string | null
          permissions?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_id?: string
          client_id?: string
          owner_user_id?: string | null
          permissions?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_access_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "client_portal_access_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_access_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_request_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_side: string
          client_id: string
          created_at: string
          id: string
          kind: string
          note: string | null
          payload: Json
          request_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_side?: string
          client_id: string
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          payload?: Json
          request_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_side?: string
          client_id?: string
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          payload?: Json
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_request_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "client_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      client_requests: {
        Row: {
          attachments: Json
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          decided_at: string | null
          decision_note: string | null
          description: string | null
          desired_due_at: string | null
          id: string
          owner_user_id: string | null
          project_id: string | null
          status: string
          task_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          decided_at?: string | null
          decision_note?: string | null
          description?: string | null
          desired_due_at?: string | null
          id?: string
          owner_user_id?: string | null
          project_id?: string | null
          status?: string
          task_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          decided_at?: string | null
          decision_note?: string | null
          description?: string | null
          desired_due_at?: string | null
          id?: string
          owner_user_id?: string | null
          project_id?: string | null
          status?: string
          task_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "client_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      client_social_accounts: {
        Row: {
          brand_id: string
          client_id: string
          connection_id: string
          created_at: string
          created_by: string | null
          id: string
        }
        Insert: {
          brand_id: string
          client_id: string
          connection_id: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          connection_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_social_accounts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "client_social_accounts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_social_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_social_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          archived_at: string | null
          brand_hub: Json
          brand_id: string
          briefing_status: string
          briefing_status_at: string | null
          briefing_status_by: string | null
          cnpj: string | null
          color: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_renewal_date: string | null
          contract_start_date: string | null
          contract_status: string
          created_at: string
          description: string | null
          favicon_url: string | null
          id: string
          internal_notes: string | null
          is_active: boolean
          journey_stage: string
          legal_name: string | null
          logo_secondary_url: string | null
          logo_url: string | null
          margin_percent: number | null
          monthly_contract_value: number | null
          name: string
          niche: string | null
          overage_policy: string | null
          owner_user_id: string | null
          palette: Json | null
          portal_theme: Json
          socials: Json | null
          tone_of_voice: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          archived_at?: string | null
          brand_hub?: Json
          brand_id: string
          briefing_status?: string
          briefing_status_at?: string | null
          briefing_status_by?: string | null
          cnpj?: string | null
          color?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_renewal_date?: string | null
          contract_start_date?: string | null
          contract_status?: string
          created_at?: string
          description?: string | null
          favicon_url?: string | null
          id?: string
          internal_notes?: string | null
          is_active?: boolean
          journey_stage?: string
          legal_name?: string | null
          logo_secondary_url?: string | null
          logo_url?: string | null
          margin_percent?: number | null
          monthly_contract_value?: number | null
          name: string
          niche?: string | null
          overage_policy?: string | null
          owner_user_id?: string | null
          palette?: Json | null
          portal_theme?: Json
          socials?: Json | null
          tone_of_voice?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          archived_at?: string | null
          brand_hub?: Json
          brand_id?: string
          briefing_status?: string
          briefing_status_at?: string | null
          briefing_status_by?: string | null
          cnpj?: string | null
          color?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_renewal_date?: string | null
          contract_start_date?: string | null
          contract_status?: string
          created_at?: string
          description?: string | null
          favicon_url?: string | null
          id?: string
          internal_notes?: string | null
          is_active?: boolean
          journey_stage?: string
          legal_name?: string | null
          logo_secondary_url?: string | null
          logo_url?: string | null
          margin_percent?: number | null
          monthly_contract_value?: number | null
          name?: string
          niche?: string | null
          overage_policy?: string | null
          owner_user_id?: string | null
          palette?: Json | null
          portal_theme?: Json
          socials?: Json | null
          tone_of_voice?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "clients_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pipeline_stages: {
        Row: {
          color: string
          created_at: string
          enables_approval_link: boolean
          hide_in_portal: boolean
          id: string
          is_terminal: boolean
          key: string
          label: string
          pipeline_id: string
          position: number
          sla_days: number | null
          sla_hours: number | null
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          enables_approval_link?: boolean
          hide_in_portal?: boolean
          id?: string
          is_terminal?: boolean
          key: string
          label: string
          pipeline_id: string
          position?: number
          sla_days?: number | null
          sla_hours?: number | null
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          enables_approval_link?: boolean
          hide_in_portal?: boolean
          id?: string
          is_terminal?: boolean
          key?: string
          label?: string
          pipeline_id?: string
          position?: number
          sla_days?: number | null
          sla_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "content_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pipelines: {
        Row: {
          brand_id: string
          client_id: string
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_default: boolean
          name: string
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean
          name: string
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean
          name?: string
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_pipelines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "content_pipelines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_pipelines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_events: {
        Row: {
          brand_id: string
          client_id: string | null
          connection_state: string | null
          created_at: string
          event_type: string
          id: string
          instance_id: string
          instance_name: string
          payload: Json
          phone_number: string | null
          provider_event_id: string | null
          received_at: string
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          connection_state?: string | null
          created_at?: string
          event_type: string
          id?: string
          instance_id: string
          instance_name: string
          payload?: Json
          phone_number?: string | null
          provider_event_id?: string | null
          received_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          connection_state?: string | null
          created_at?: string
          event_type?: string
          id?: string
          instance_id?: string
          instance_name?: string
          payload?: Json
          phone_number?: string | null
          provider_event_id?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "evolution_events_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_events_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "evolution_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_instances: {
        Row: {
          brand_id: string
          client_id: string | null
          connection_state: string | null
          created_at: string
          created_by: string | null
          id: string
          instance_name: string
          label: string | null
          last_error: string | null
          last_event_at: string | null
          last_state_at: string | null
          metadata: Json
          phone_number: string | null
          status: string
          updated_at: string
          webhook_configured_at: string | null
          webhook_token: string | null
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          connection_state?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instance_name: string
          label?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_state_at?: string | null
          metadata?: Json
          phone_number?: string | null
          status?: string
          updated_at?: string
          webhook_configured_at?: string | null
          webhook_token?: string | null
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          connection_state?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          instance_name?: string
          label?: string | null
          last_error?: string | null
          last_event_at?: string | null
          last_state_at?: string | null
          metadata?: Json
          phone_number?: string | null
          status?: string
          updated_at?: string
          webhook_configured_at?: string | null
          webhook_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_instances_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "evolution_instances_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_instances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_catalog: {
        Row: {
          category: string | null
          created_at: string
          default_enabled: boolean
          description: string | null
          icon: string | null
          id: string
          is_available: boolean
          is_core: boolean
          key: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          default_enabled?: boolean
          description?: string | null
          icon?: string | null
          id?: string
          is_available?: boolean
          is_core?: boolean
          key: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          default_enabled?: boolean
          description?: string | null
          icon?: string | null
          id?: string
          is_available?: boolean
          is_core?: boolean
          key?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      installation: {
        Row: {
          app_url: string | null
          created_at: string
          email_from: string | null
          email_from_name: string | null
          icon_url: string | null
          id: boolean
          login_logo_url: string | null
          logo_dark_url: string | null
          logo_url: string | null
          updated_at: string
        }
        Insert: {
          app_url?: string | null
          created_at?: string
          email_from?: string | null
          email_from_name?: string | null
          icon_url?: string | null
          id?: boolean
          login_logo_url?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          updated_at?: string
        }
        Update: {
          app_url?: string | null
          created_at?: string
          email_from?: string | null
          email_from_name?: string | null
          icon_url?: string | null
          id?: boolean
          login_logo_url?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      installation_credentials: {
        Row: {
          created_at: string
          github_token_ciphertext: string | null
          installation_id: string
          supabase_management_token_ciphertext: string | null
          updated_at: string
          updated_by: string | null
          vercel_team_id: string | null
          vercel_token_ciphertext: string | null
        }
        Insert: {
          created_at?: string
          github_token_ciphertext?: string | null
          installation_id: string
          supabase_management_token_ciphertext?: string | null
          updated_at?: string
          updated_by?: string | null
          vercel_team_id?: string | null
          vercel_token_ciphertext?: string | null
        }
        Update: {
          created_at?: string
          github_token_ciphertext?: string | null
          installation_id?: string
          supabase_management_token_ciphertext?: string | null
          updated_at?: string
          updated_by?: string | null
          vercel_team_id?: string | null
          vercel_token_ciphertext?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installation_credentials_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: true
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      installation_meta_app: {
        Row: {
          app_id: string | null
          app_secret_ciphertext: string | null
          app_type: string
          business_config_id: string | null
          created_at: string
          id: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_id?: string | null
          app_secret_ciphertext?: string | null
          app_type?: string
          business_config_id?: string | null
          created_at?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_id?: string | null
          app_secret_ciphertext?: string | null
          app_type?: string
          business_config_id?: string | null
          created_at?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      installation_operations: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          error_kind: string | null
          finished_at: string | null
          id: string
          installation_id: string
          kind: string
          last_report_at: string | null
          run_token_expires_at: string | null
          run_token_hash: string | null
          started_at: string
          status: string
          steps: Json
          summary: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          error_kind?: string | null
          finished_at?: string | null
          id?: string
          installation_id: string
          kind: string
          last_report_at?: string | null
          run_token_expires_at?: string | null
          run_token_hash?: string | null
          started_at?: string
          status?: string
          steps?: Json
          summary?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          error_kind?: string | null
          finished_at?: string | null
          id?: string
          installation_id?: string
          kind?: string
          last_report_at?: string | null
          run_token_expires_at?: string | null
          run_token_hash?: string | null
          started_at?: string
          status?: string
          steps?: Json
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installation_operations_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      installations: {
        Row: {
          active_operation_id: string | null
          available_version: string | null
          created_at: string
          created_by: string | null
          current_version: string | null
          deploy_project: string | null
          domain: string | null
          git_repo_url: string | null
          health: string
          health_checked_at: string | null
          health_checks: Json
          id: string
          last_error: string | null
          last_provisioned_at: string | null
          last_validated_at: string | null
          name: string
          notes: string | null
          pinned_at: string | null
          pinned_by: string | null
          pinned_commit_sha: string | null
          pinned_release: string | null
          slug: string
          status: string
          supabase_project_ref: string | null
          supabase_url: string | null
          updated_at: string
        }
        Insert: {
          active_operation_id?: string | null
          available_version?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: string | null
          deploy_project?: string | null
          domain?: string | null
          git_repo_url?: string | null
          health?: string
          health_checked_at?: string | null
          health_checks?: Json
          id?: string
          last_error?: string | null
          last_provisioned_at?: string | null
          last_validated_at?: string | null
          name: string
          notes?: string | null
          pinned_at?: string | null
          pinned_by?: string | null
          pinned_commit_sha?: string | null
          pinned_release?: string | null
          slug: string
          status?: string
          supabase_project_ref?: string | null
          supabase_url?: string | null
          updated_at?: string
        }
        Update: {
          active_operation_id?: string | null
          available_version?: string | null
          created_at?: string
          created_by?: string | null
          current_version?: string | null
          deploy_project?: string | null
          domain?: string | null
          git_repo_url?: string | null
          health?: string
          health_checked_at?: string | null
          health_checks?: Json
          id?: string
          last_error?: string | null
          last_provisioned_at?: string | null
          last_validated_at?: string | null
          name?: string
          notes?: string | null
          pinned_at?: string | null
          pinned_by?: string | null
          pinned_commit_sha?: string | null
          pinned_release?: string | null
          slug?: string
          status?: string
          supabase_project_ref?: string | null
          supabase_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      media_plan_items: {
        Row: {
          audience: string | null
          benchmark: string | null
          budget_amount: number
          budget_pct: number
          campaign_type: string | null
          channel: string | null
          created_at: string
          funnel_stage: string | null
          id: string
          keywords: string[]
          main_kpi: string | null
          objective: string | null
          other_refs: string | null
          plan_id: string
          position: number
          product_service: string | null
          updated_at: string
        }
        Insert: {
          audience?: string | null
          benchmark?: string | null
          budget_amount?: number
          budget_pct?: number
          campaign_type?: string | null
          channel?: string | null
          created_at?: string
          funnel_stage?: string | null
          id?: string
          keywords?: string[]
          main_kpi?: string | null
          objective?: string | null
          other_refs?: string | null
          plan_id: string
          position?: number
          product_service?: string | null
          updated_at?: string
        }
        Update: {
          audience?: string | null
          benchmark?: string | null
          budget_amount?: number
          budget_pct?: number
          campaign_type?: string | null
          channel?: string | null
          created_at?: string
          funnel_stage?: string | null
          id?: string
          keywords?: string[]
          main_kpi?: string | null
          objective?: string | null
          other_refs?: string | null
          plan_id?: string
          position?: number
          product_service?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "media_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      media_plans: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          monthly_budget: number
          period_end: string | null
          period_start: string | null
          share_expires_at: string | null
          share_token: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          monthly_budget?: number
          period_end?: string | null
          period_start?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          monthly_budget?: number
          period_end?: string | null
          period_start?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_plans_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "media_plans_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      message_logs: {
        Row: {
          brand_id: string
          channel: string
          client_id: string | null
          created_at: string
          delivered_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          metadata: Json
          provider_message_id: string | null
          recipient: string | null
          sent_at: string
          status: string
        }
        Insert: {
          brand_id: string
          channel: string
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          metadata?: Json
          provider_message_id?: string | null
          recipient?: string | null
          sent_at?: string
          status: string
        }
        Update: {
          brand_id?: string
          channel?: string
          client_id?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          metadata?: Json
          provider_message_id?: string | null
          recipient?: string | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "message_logs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          brand_id: string
          channel: string
          created_at: string
          event_key: string
          id: string
          is_active: boolean
          subject: string | null
          updated_at: string
          updated_by: string | null
          variables_used: string[]
        }
        Insert: {
          body?: string
          brand_id: string
          channel: string
          created_at?: string
          event_key: string
          id?: string
          is_active?: boolean
          subject?: string | null
          updated_at?: string
          updated_by?: string | null
          variables_used?: string[]
        }
        Update: {
          body?: string
          brand_id?: string
          channel?: string
          created_at?: string
          event_key?: string
          id?: string
          is_active?: boolean
          subject?: string | null
          updated_at?: string
          updated_by?: string | null
          variables_used?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "message_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_compliance_events: {
        Row: {
          affected_connections: number
          confirmation_code: string
          created_at: string
          event_type: string
          id: string
          meta_user_id: string
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          affected_connections?: number
          confirmation_code: string
          created_at?: string
          event_type: string
          id?: string
          meta_user_id: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          affected_connections?: number
          confirmation_code?: string
          created_at?: string
          event_type?: string
          id?: string
          meta_user_id?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      meta_oauth_sessions: {
        Row: {
          ad_accounts: Json
          brand_id: string
          businesses: Json
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          meta_user_email: string | null
          meta_user_id: string
          meta_user_name: string | null
          pages: Json
          portfolio_error: string | null
          portfolio_load_status: string
          portfolio_loaded_at: string | null
          portfolio_rate_limited_until: string | null
          portfolio_source_session_id: string | null
          requested_scopes: string[]
          revoked_at: string | null
          revoked_reason: string | null
          scopes: string[]
          state_nonce: string | null
          threads_accounts: Json
          user_id: string
          user_token_ciphertext: string
          user_token_expires_at: string | null
        }
        Insert: {
          ad_accounts?: Json
          brand_id: string
          businesses?: Json
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          meta_user_email?: string | null
          meta_user_id: string
          meta_user_name?: string | null
          pages?: Json
          portfolio_error?: string | null
          portfolio_load_status?: string
          portfolio_loaded_at?: string | null
          portfolio_rate_limited_until?: string | null
          portfolio_source_session_id?: string | null
          requested_scopes?: string[]
          revoked_at?: string | null
          revoked_reason?: string | null
          scopes?: string[]
          state_nonce?: string | null
          threads_accounts?: Json
          user_id: string
          user_token_ciphertext: string
          user_token_expires_at?: string | null
        }
        Update: {
          ad_accounts?: Json
          brand_id?: string
          businesses?: Json
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          meta_user_email?: string | null
          meta_user_id?: string
          meta_user_name?: string | null
          pages?: Json
          portfolio_error?: string | null
          portfolio_load_status?: string
          portfolio_loaded_at?: string | null
          portfolio_rate_limited_until?: string | null
          portfolio_source_session_id?: string | null
          requested_scopes?: string[]
          revoked_at?: string | null
          revoked_reason?: string | null
          scopes?: string[]
          state_nonce?: string | null
          threads_accounts?: Json
          user_id?: string
          user_token_ciphertext?: string
          user_token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_oauth_sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "meta_oauth_sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_oauth_sessions_portfolio_source_session_id_fkey"
            columns: ["portfolio_source_session_id"]
            isOneToOne: false
            referencedRelation: "meta_oauth_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_plan_tokens: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          monthly_plan_id: string
          revoked_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          monthly_plan_id: string
          revoked_at?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          monthly_plan_id?: string
          revoked_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_plan_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "monthly_plan_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_plan_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_plan_tokens_monthly_plan_id_fkey"
            columns: ["monthly_plan_id"]
            isOneToOne: false
            referencedRelation: "monthly_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_plan_topics: {
        Row: {
          angle: string | null
          channel: string | null
          client_comment: string | null
          client_decision_at: string | null
          client_status: string
          content_format: string | null
          created_at: string
          id: string
          monthly_plan_id: string
          position: number
          previous_angle: string | null
          previous_title: string | null
          rationale: string | null
          status: string
          suggested_at: string | null
          suggested_confidence: string | null
          suggested_slot_rationale: string | null
          target_audience: string | null
          topic_title: string
          updated_at: string
        }
        Insert: {
          angle?: string | null
          channel?: string | null
          client_comment?: string | null
          client_decision_at?: string | null
          client_status?: string
          content_format?: string | null
          created_at?: string
          id?: string
          monthly_plan_id: string
          position?: number
          previous_angle?: string | null
          previous_title?: string | null
          rationale?: string | null
          status?: string
          suggested_at?: string | null
          suggested_confidence?: string | null
          suggested_slot_rationale?: string | null
          target_audience?: string | null
          topic_title: string
          updated_at?: string
        }
        Update: {
          angle?: string | null
          channel?: string | null
          client_comment?: string | null
          client_decision_at?: string | null
          client_status?: string
          content_format?: string | null
          created_at?: string
          id?: string
          monthly_plan_id?: string
          position?: number
          previous_angle?: string | null
          previous_title?: string | null
          rationale?: string | null
          status?: string
          suggested_at?: string | null
          suggested_confidence?: string | null
          suggested_slot_rationale?: string | null
          target_audience?: string | null
          topic_title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_plan_topics_monthly_plan_id_fkey"
            columns: ["monthly_plan_id"]
            isOneToOne: false
            referencedRelation: "monthly_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_plans: {
        Row: {
          brand_id: string
          client_decision_at: string | null
          client_decision_mode: string | null
          client_feedback: string | null
          client_id: string
          context_sources: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          input_briefing_id: string | null
          input_theme: string | null
          internal_approved_at: string | null
          internal_approved_by: string | null
          objectives: string | null
          project_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_decision_at?: string | null
          client_decision_mode?: string | null
          client_feedback?: string | null
          client_id: string
          context_sources?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          input_briefing_id?: string | null
          input_theme?: string | null
          internal_approved_at?: string | null
          internal_approved_by?: string | null
          objectives?: string | null
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_decision_at?: string | null
          client_decision_mode?: string | null
          client_feedback?: string | null
          client_id?: string
          context_sources?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          input_briefing_id?: string | null
          input_theme?: string | null
          internal_approved_at?: string | null
          internal_approved_by?: string | null
          objectives?: string | null
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_plans_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "monthly_plans_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_plans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_plans_input_briefing_id_fkey"
            columns: ["input_briefing_id"]
            isOneToOne: false
            referencedRelation: "brand_briefings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          archived_at: string | null
          body: string | null
          brand_id: string
          created_at: string
          dedupe_key: string | null
          href: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload: Json | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          body?: string | null
          brand_id: string
          created_at?: string
          dedupe_key?: string | null
          href?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload?: Json | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          body?: string | null
          brand_id?: string
          created_at?: string
          dedupe_key?: string | null
          href?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          payload?: Json | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "notifications_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_overage_requests: {
        Row: {
          brand_id: string
          channel: string
          client_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          justification: string | null
          overage: number
          period_month: string
          quota: number
          requested: number
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          channel: string
          client_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          justification?: string | null
          overage?: number
          period_month: string
          quota?: number
          requested?: number
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          channel?: string
          client_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          justification?: string | null
          overage?: number
          period_month?: string
          quota?: number
          requested?: number
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_overage_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "plan_overage_requests_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_overage_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_notification_prefs: {
        Row: {
          client_id: string
          created_at: string
          daily_digest: boolean
          email_enabled: boolean
          kinds: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          daily_digest?: boolean
          email_enabled?: boolean
          kinds?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          daily_digest?: boolean
          email_enabled?: boolean
          kinds?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_notification_prefs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_rate_limit: {
        Row: {
          blocked_until: string | null
          created_at: string
          fail_count: number
          ip_hash: string
          updated_at: string
          window_start: string
        }
        Insert: {
          blocked_until?: string | null
          created_at?: string
          fail_count?: number
          ip_hash: string
          updated_at?: string
          window_start?: string
        }
        Update: {
          blocked_until?: string | null
          created_at?: string
          fail_count?: number
          ip_hash?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      portal_tokens: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string | null
          last_seen_at: string | null
          revoked_at: string | null
          token: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_seen_at?: string | null
          revoked_at?: string | null
          token: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string | null
          last_seen_at?: string | null
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      post_approvals: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          id: string
          notes: string | null
          post_id: string
          status: Database["public"]["Enums"]["approval_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          id?: string
          notes?: string | null
          post_id: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_by_name?: string | null
          id?: string
          notes?: string | null
          post_id?: string
          status?: Database["public"]["Enums"]["approval_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_approvals_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_client_comments: {
        Row: {
          anchor: Json | null
          attachments: Json
          author_name: string | null
          author_side: string
          author_user_id: string | null
          body: string | null
          brand_id: string
          client_id: string
          created_at: string
          id: string
          post_id: string
          resolved_at: string | null
        }
        Insert: {
          anchor?: Json | null
          attachments?: Json
          author_name?: string | null
          author_side?: string
          author_user_id?: string | null
          body?: string | null
          brand_id: string
          client_id: string
          created_at?: string
          id?: string
          post_id: string
          resolved_at?: string | null
        }
        Update: {
          anchor?: Json | null
          attachments?: Json
          author_name?: string | null
          author_side?: string
          author_user_id?: string | null
          body?: string | null
          brand_id?: string
          client_id?: string
          created_at?: string
          id?: string
          post_id?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_client_comments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "post_client_comments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_client_comments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_client_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_placements: {
        Row: {
          brand_id: string
          client_id: string
          connection_id: string | null
          copy_override: Json | null
          created_at: string
          external_ref: string | null
          format: string
          id: string
          is_primary: boolean
          media: Json
          post_id: string
          published_at: string | null
          scheduled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          connection_id?: string | null
          copy_override?: Json | null
          created_at?: string
          external_ref?: string | null
          format: string
          id?: string
          is_primary?: boolean
          media?: Json
          post_id: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          connection_id?: string | null
          copy_override?: Json | null
          created_at?: string
          external_ref?: string | null
          format?: string
          id?: string
          is_primary?: boolean
          media?: Json
          post_id?: string
          published_at?: string | null
          scheduled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_placements_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "post_placements_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_placements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_placements_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_placements_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          ai_phase: string
          ai_phase_at: string | null
          approved_at: string | null
          approved_by: string | null
          assignee_id: string | null
          assignees: string[]
          brand_id: string
          channels: Database["public"]["Enums"]["post_channel"][]
          client_briefing: string | null
          client_due_at: string | null
          client_id: string
          copy: string | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          design_brief: string | null
          format: string | null
          id: string
          internal_briefing: string | null
          monthly_plan_topic_id: string | null
          pipeline_id: string | null
          position: number
          priority: string | null
          project_id: string | null
          proposed_at: string | null
          published_at: string | null
          recurrence: Json | null
          reference_media: Json
          references: Json
          remind_at: string | null
          review_status: string
          rework_notes: string | null
          schedule_approved_at: string | null
          schedule_approved_by: string | null
          schedule_client_comment: string | null
          schedule_client_decision_at: string | null
          schedule_status: string
          scheduled_at: string | null
          script: Json | null
          stage: Database["public"]["Enums"]["post_stage"]
          stage_entered_at: string | null
          stage_id: string | null
          tags: string[]
          target_connection_ids: string[]
          title: string
          updated_at: string
          visible_in_portal: boolean
        }
        Insert: {
          ai_phase?: string
          ai_phase_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assignee_id?: string | null
          assignees?: string[]
          brand_id: string
          channels?: Database["public"]["Enums"]["post_channel"][]
          client_briefing?: string | null
          client_due_at?: string | null
          client_id: string
          copy?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          design_brief?: string | null
          format?: string | null
          id?: string
          internal_briefing?: string | null
          monthly_plan_topic_id?: string | null
          pipeline_id?: string | null
          position?: number
          priority?: string | null
          project_id?: string | null
          proposed_at?: string | null
          published_at?: string | null
          recurrence?: Json | null
          reference_media?: Json
          references?: Json
          remind_at?: string | null
          review_status?: string
          rework_notes?: string | null
          schedule_approved_at?: string | null
          schedule_approved_by?: string | null
          schedule_client_comment?: string | null
          schedule_client_decision_at?: string | null
          schedule_status?: string
          scheduled_at?: string | null
          script?: Json | null
          stage?: Database["public"]["Enums"]["post_stage"]
          stage_entered_at?: string | null
          stage_id?: string | null
          tags?: string[]
          target_connection_ids?: string[]
          title: string
          updated_at?: string
          visible_in_portal?: boolean
        }
        Update: {
          ai_phase?: string
          ai_phase_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          assignee_id?: string | null
          assignees?: string[]
          brand_id?: string
          channels?: Database["public"]["Enums"]["post_channel"][]
          client_briefing?: string | null
          client_due_at?: string | null
          client_id?: string
          copy?: string | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          design_brief?: string | null
          format?: string | null
          id?: string
          internal_briefing?: string | null
          monthly_plan_topic_id?: string | null
          pipeline_id?: string | null
          position?: number
          priority?: string | null
          project_id?: string | null
          proposed_at?: string | null
          published_at?: string | null
          recurrence?: Json | null
          reference_media?: Json
          references?: Json
          remind_at?: string | null
          review_status?: string
          rework_notes?: string | null
          schedule_approved_at?: string | null
          schedule_approved_by?: string | null
          schedule_client_comment?: string | null
          schedule_client_decision_at?: string | null
          schedule_status?: string
          scheduled_at?: string | null
          script?: Json | null
          stage?: Database["public"]["Enums"]["post_stage"]
          stage_entered_at?: string | null
          stage_id?: string | null
          tags?: string[]
          target_connection_ids?: string[]
          title?: string
          updated_at?: string
          visible_in_portal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "posts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "posts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_monthly_plan_topic_id_fkey"
            columns: ["monthly_plan_topic_id"]
            isOneToOne: false
            referencedRelation: "monthly_plan_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "content_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "content_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      project_jobs: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          brand_id: string
          color: string | null
          created_at: string
          description: string | null
          done_at: string | null
          due_at: string | null
          id: string
          name: string
          position: number
          project_id: string
          start_date: string | null
          status_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          brand_id: string
          color?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          name: string
          position?: number
          project_id: string
          start_date?: string | null
          status_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          brand_id?: string
          color?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          id?: string
          name?: string
          position?: number
          project_id?: string
          start_date?: string | null
          status_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "project_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_jobs_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "work_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      project_participants: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_participants_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "project_participants_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_participants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_template_jobs: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          position: number
          template_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          position?: number
          template_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_template_jobs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "project_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      project_template_tasks: {
        Row: {
          created_at: string
          description: string | null
          estimated_minutes: number | null
          id: string
          position: number
          priority: string | null
          template_job_id: string
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          position?: number
          priority?: string | null
          template_job_id: string
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          position?: number
          priority?: string | null
          template_job_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_template_tasks_template_job_id_fkey"
            columns: ["template_job_id"]
            isOneToOne: false
            referencedRelation: "project_template_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      project_templates: {
        Row: {
          brand_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          is_system: boolean
          name: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "project_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          brand_id: string
          client_id: string | null
          color: string | null
          created_at: string
          description: string | null
          done_at: string | null
          due_at: string | null
          goals: string | null
          id: string
          monthly_plan_id: string | null
          name: string
          owner_id: string | null
          progress: number
          start_date: string | null
          status: Database["public"]["Enums"]["project_status"]
          status_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          brand_id: string
          client_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          goals?: string | null
          id?: string
          monthly_plan_id?: string | null
          name: string
          owner_id?: string | null
          progress?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          status_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          brand_id?: string
          client_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          due_at?: string | null
          goals?: string | null
          id?: string
          monthly_plan_id?: string | null
          name?: string
          owner_id?: string | null
          progress?: number
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          status_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "projects_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_monthly_plan_id_fkey"
            columns: ["monthly_plan_id"]
            isOneToOne: false
            referencedRelation: "monthly_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "work_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_rules: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          is_active: boolean
          project_id: string | null
          scope: string
          scope_ref: string | null
          target_hours: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          project_id?: string | null
          scope: string
          scope_ref?: string | null
          target_hours: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          project_id?: string | null
          scope?: string
          scope_ref?: string | null
          target_hours?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sla_rules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "sla_rules_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      social_connections: {
        Row: {
          access_token_ciphertext: string
          account_id: string | null
          account_username: string | null
          brand_id: string
          channel: string
          channel_name: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          external_id: string
          external_name: string | null
          id: string
          instagram_business_id: string | null
          last_error: string | null
          last_synced_at: string | null
          meta_business_id: string | null
          meta_business_name: string | null
          meta_user_id: string | null
          metadata: Json
          owner_external_id: string | null
          owner_name: string | null
          page_id: string | null
          provider: string
          refresh_token_ciphertext: string | null
          scopes: string[]
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_ciphertext: string
          account_id?: string | null
          account_username?: string | null
          brand_id: string
          channel: string
          channel_name?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          external_id: string
          external_name?: string | null
          id?: string
          instagram_business_id?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          meta_business_id?: string | null
          meta_business_name?: string | null
          meta_user_id?: string | null
          metadata?: Json
          owner_external_id?: string | null
          owner_name?: string | null
          page_id?: string | null
          provider: string
          refresh_token_ciphertext?: string | null
          scopes?: string[]
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_ciphertext?: string
          account_id?: string | null
          account_username?: string | null
          brand_id?: string
          channel?: string
          channel_name?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          external_id?: string
          external_name?: string | null
          id?: string
          instagram_business_id?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          meta_business_id?: string | null
          meta_business_name?: string | null
          meta_user_id?: string | null
          metadata?: Json
          owner_external_id?: string | null
          owner_name?: string | null
          page_id?: string | null
          provider?: string
          refresh_token_ciphertext?: string | null
          scopes?: string[]
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_connections_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "social_connections_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          brand_id: string
          caption: string | null
          client_id: string | null
          connection_id: string
          created_at: string
          created_by: string | null
          deferred_since: string | null
          external_permalink: string | null
          external_post_id: string | null
          hashtags: string[]
          id: string
          last_error: string | null
          location_id: string | null
          media: Json
          mentions: string[]
          next_attempt_at: string | null
          placement: string
          post_id: string | null
          provider: string
          provider_response: Json
          publish_attempts: number
          publish_locked_at: string | null
          published_at: string | null
          rate_limit_retries: number
          scheduled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          caption?: string | null
          client_id?: string | null
          connection_id: string
          created_at?: string
          created_by?: string | null
          deferred_since?: string | null
          external_permalink?: string | null
          external_post_id?: string | null
          hashtags?: string[]
          id?: string
          last_error?: string | null
          location_id?: string | null
          media?: Json
          mentions?: string[]
          next_attempt_at?: string | null
          placement?: string
          post_id?: string | null
          provider: string
          provider_response?: Json
          publish_attempts?: number
          publish_locked_at?: string | null
          published_at?: string | null
          rate_limit_retries?: number
          scheduled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          caption?: string | null
          client_id?: string | null
          connection_id?: string
          created_at?: string
          created_by?: string | null
          deferred_since?: string | null
          external_permalink?: string | null
          external_post_id?: string | null
          hashtags?: string[]
          id?: string
          last_error?: string | null
          location_id?: string | null
          media?: Json
          mentions?: string[]
          next_attempt_at?: string | null
          placement?: string
          post_id?: string | null
          provider?: string
          provider_response?: Json
          publish_attempts?: number
          publish_locked_at?: string | null
          published_at?: string | null
          rate_limit_retries?: number
          scheduled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "social_posts_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_posts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_id: string
          body: string
          brand_id: string
          created_at: string
          id: string
          mentions: string[]
          task_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          brand_id: string
          created_at?: string
          id?: string
          mentions?: string[]
          task_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          brand_id?: string
          created_at?: string
          id?: string
          mentions?: string[]
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "task_comments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_subtasks: {
        Row: {
          brand_id: string
          created_at: string
          created_by: string | null
          done: boolean
          id: string
          position: number
          task_id: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          id?: string
          position?: number
          task_id: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          created_by?: string | null
          done?: boolean
          id?: string
          position?: number
          task_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_subtasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "task_subtasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_time_entries: {
        Row: {
          brand_id: string
          created_at: string
          description: string | null
          ended_at: string | null
          ended_reason: string | null
          id: string
          is_rework: boolean
          minutes: number | null
          seconds: number | null
          source: string
          started_at: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          description?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          is_rework?: boolean
          minutes?: number | null
          seconds?: number | null
          source?: string
          started_at?: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          description?: string | null
          ended_at?: string | null
          ended_reason?: string | null
          id?: string
          is_rework?: boolean
          minutes?: number | null
          seconds?: number | null
          source?: string
          started_at?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_time_entries_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "task_time_entries_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          brand_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          done: boolean
          done_at: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          job_id: string | null
          position: number
          post_id: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          project_id: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
          status_id: string | null
          title: string
          total_minutes: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          brand_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          id?: string
          job_id?: string | null
          position?: number
          post_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          status_id?: string | null
          title: string
          total_minutes?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          brand_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          done?: boolean
          done_at?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          id?: string
          job_id?: string | null
          position?: number
          post_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          project_id?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          status_id?: string | null
          title?: string
          total_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "tasks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "project_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "work_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_super_admin: boolean
          job_title: string | null
          locale: string
          notification_prefs: Json
          notify_whatsapp: boolean
          phone: string | null
          requires_password_change: boolean
          role: string
          timezone: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_super_admin?: boolean
          job_title?: string | null
          locale?: string
          notification_prefs?: Json
          notify_whatsapp?: boolean
          phone?: string | null
          requires_password_change?: boolean
          role?: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_super_admin?: boolean
          job_title?: string | null
          locale?: string
          notification_prefs?: Json
          notify_whatsapp?: boolean
          phone?: string | null
          requires_password_change?: boolean
          role?: string
          timezone?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      whatsapp_recipients: {
        Row: {
          brand_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          destination: string | null
          id: string
          is_active: boolean
          metadata: Json
          name: string
          role_label: string | null
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name: string
          role_label?: string | null
          type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json
          name?: string
          role_label?: string | null
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_recipients_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "whatsapp_recipients_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_recipients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      work_comments: {
        Row: {
          author_id: string
          body: string
          brand_id: string
          created_at: string
          id: string
          job_id: string | null
          mentions: string[]
          project_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          brand_id: string
          created_at?: string
          id?: string
          job_id?: string | null
          mentions?: string[]
          project_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          brand_id?: string
          created_at?: string
          id?: string
          job_id?: string | null
          mentions?: string[]
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_comments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "work_comments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_comments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "project_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      work_links: {
        Row: {
          brand_id: string
          client_id: string | null
          created_at: string
          created_by: string | null
          created_by_client: boolean
          id: string
          job_id: string | null
          post_id: string | null
          project_id: string | null
          source: string
          task_id: string | null
          title: string | null
          topic_id: string | null
          updated_at: string
          url: string
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_client?: boolean
          id?: string
          job_id?: string | null
          post_id?: string | null
          project_id?: string | null
          source?: string
          task_id?: string | null
          title?: string | null
          topic_id?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_client?: boolean
          id?: string
          job_id?: string | null
          post_id?: string | null
          project_id?: string | null
          source?: string
          task_id?: string | null
          title?: string | null
          topic_id?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_links_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "work_links_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_links_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_links_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "project_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_links_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_links_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "monthly_plan_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      work_statuses: {
        Row: {
          brand_id: string
          color: string
          created_at: string
          id: string
          is_default: boolean
          is_done: boolean
          name: string
          position: number
          scope: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_done?: boolean
          name: string
          position?: number
          scope: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          color?: string
          created_at?: string
          id?: string
          is_default?: boolean
          is_done?: boolean
          name?: string
          position?: number
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_statuses_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brain_stats_mv"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "work_statuses_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      brain_stats_mv: {
        Row: {
          brand_id: string | null
          posts: number | null
          projects: number | null
          refreshed_at: string | null
          tasks: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _brain_cfg_days: {
        Args: { _default: number; _key: string }
        Returns: number
      }
      _portal_session: {
        Args: { _token: string }
        Returns: {
          brand_id: string
          client_id: string
          token_id: string
        }[]
      }
      _portal_session_any: {
        Args: { _client_id?: string; _token?: string }
        Returns: {
          brand_id: string
          client_id: string
          token_id: string
        }[]
      }
      _portal_session_user: {
        Args: { _client_id?: string }
        Returns: {
          brand_id: string
          client_id: string
          token_id: string
        }[]
      }
      accept_brand_invite: { Args: { _token: string }; Returns: string }
      access_profiles_system_defaults: { Args: never; Returns: Json }
      ai_job_claim_lease: {
        Args: { _job_id: string; _lease_seconds?: number; _owner: string }
        Returns: boolean
      }
      ai_job_heartbeat: {
        Args: { _job_id: string; _lease_seconds?: number; _owner: string }
        Returns: boolean
      }
      ai_job_lease_ttl: { Args: { _kind: string }; Returns: string }
      ai_scope_readable: {
        Args: { _brand_id: string; _client_id: string }
        Returns: boolean
      }
      app_access_role: {
        Args: { _brand_id?: string; _user_id: string }
        Returns: string
      }
      block_unusable_scheduled_social_posts: {
        Args: never
        Returns: {
          id: string
          reason: string
        }[]
      }
      brain_cleanup_ttl: { Args: never; Returns: Json }
      brain_confidence: {
        Args: {
          _consistency: number
          _last_observed: string
          _relevance?: number
          _sample: number
        }
        Returns: number
      }
      brain_events_prune: { Args: never; Returns: Json }
      brain_memory_decay_and_archive: { Args: never; Returns: number }
      brain_memory_evolve: {
        Args: {
          _brand_id: string
          _category: string
          _content?: Json
          _contradicts?: boolean
          _description?: string
          _entity_id: string
          _entity_type: string
          _evidence_confidence?: number
          _metadata?: Json
          _origin?: string
          _relations?: Json
          _source_event?: string
          _tags?: string[]
          _title: string
        }
        Returns: string
      }
      brain_memory_guard_scope: {
        Args: { _brand_id: string; _client_id: string }
        Returns: undefined
      }
      brain_memory_touch: { Args: { _ids: string[] }; Returns: number }
      brain_mine_patterns: { Args: { _brand_id?: string }; Returns: Json }
      brain_render_memory_desc: {
        Args: { _category: string; _content: Json }
        Returns: string
      }
      brain_retention_run: { Args: never; Returns: Json }
      brain_run_mining_safe: { Args: never; Returns: Json }
      brand_member_role: {
        Args: { _brand_id: string; _user_id: string }
        Returns: string
      }
      briefing_import_claim_lease: {
        Args: { _lease_seconds?: number; _limit?: number; _owner: string }
        Returns: {
          attempt: number
          brand_id: string
          client_id: string
          created_by: string
          document_id: string
          id: string
          max_attempts: number
          raw_text: string
          resume_step: string
          source_kind: string
        }[]
      }
      briefing_import_heartbeat: {
        Args: { _lease_seconds?: number; _owner: string; _run_id: string }
        Returns: boolean
      }
      briefing_import_reap: { Args: never; Returns: Json }
      can_access_client: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_client_row: {
        Args: {
          _brand_id: string
          _client_id: string
          _owner_user_id: string
          _user_id: string
        }
        Returns: boolean
      }
      can_access_project: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_task: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      can_create_brand: { Args: { _user_id: string }; Returns: boolean }
      can_delete_brand: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      can_invite_brand_role: {
        Args: {
          _actor_id: string
          _brand_id: string
          _email: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      can_manage_brand_ai_limits: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      canonical_content_format: { Args: { _raw: string }; Returns: string }
      card_approval_public_decide: {
        Args: {
          _comment?: string
          _ip?: string
          _token: string
          _ua?: string
          _verb: string
        }
        Returns: Json
      }
      check_ai_usage_budget: {
        Args: { _brand_id: string; _client_id: string; _user_id: string }
        Returns: Json
      }
      claim_scheduled_social_posts: {
        Args: { p_limit?: number }
        Returns: {
          brand_id: string
          caption: string
          client_id: string
          connection_id: string
          hashtags: string[]
          id: string
          media: Json
          mentions: string[]
          placement: string
          provider: string
          publish_attempts: number
        }[]
      }
      client_in_scope: {
        Args: { _brand_id: string; _client_id: string }
        Returns: boolean
      }
      consolidate_brain_memory: {
        Args: { _brand_id?: string }
        Returns: number
      }
      cron_secret: { Args: never; Returns: string }
      derive_post_stage: {
        Args: {
          _current: Database["public"]["Enums"]["post_stage"]
          _stage_id: string
        }
        Returns: Database["public"]["Enums"]["post_stage"]
      }
      derive_relationships_from_event: {
        Args: { _event_id: string }
        Returns: number
      }
      effective_module_permissions: {
        Args: { _brand_id: string; _user_id: string }
        Returns: Json
      }
      emit_brain_event: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_brand_id: string
          p_client_id?: string
          p_confidence?: number
          p_correlation_id?: string
          p_entity_id?: string
          p_entity_type?: string
          p_event_type: string
          p_payload?: Json
          p_project_id?: string
          p_source_module: string
        }
        Returns: string
      }
      enqueue_deadline_notifications: { Args: never; Returns: number }
      find_user_id_by_email: { Args: { _email: string }; Returns: string }
      get_brain_graph: {
        Args: { _brand_id?: string; _limit?: number }
        Returns: Json
      }
      get_brain_neighborhood: {
        Args: {
          _brand_id: string
          _depth?: number
          _entity_id: string
          _entity_type: string
        }
        Returns: Json
      }
      has_brand_role: {
        Args: {
          _brand_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_module_access: {
        Args: {
          _brand_id: string
          _min_level?: string
          _module: string
          _user_id: string
        }
        Returns: boolean
      }
      installation_setup_state: { Args: never; Returns: Json }
      instantiate_project_template: {
        Args: {
          _brand_id: string
          _client_id: string
          _project_name: string
          _template_id: string
        }
        Returns: string
      }
      is_agency_operator: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_brand_admin_level: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_brand_integration_authority: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_brand_member: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_client_assigned: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      is_global_admin: { Args: { _user_id: string }; Returns: boolean }
      is_portal_client_of: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      is_portal_user: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin:
        | { Args: never; Returns: boolean }
        | { Args: { _user_id: string }; Returns: boolean }
      link_existing_user_to_brand: {
        Args: {
          _brand_id: string
          _email: string
          _permissions?: Json
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: {
          email: string
          full_name: string
          status: string
          user_id: string
        }[]
      }
      list_agent_catalog: {
        Args: never
        Returns: {
          agent_id: string
          agent_name: string
          required_fields: Json
          updated_at: string
        }[]
      }
      list_ai_usage_overview: {
        Args: {
          _brand_id: string
          _period_end?: string
          _period_start?: string
        }
        Returns: Json
      }
      mark_social_post_blocked: {
        Args: { p_error: string; p_post_id: string; p_reason?: string }
        Returns: undefined
      }
      mark_social_post_deferred: {
        Args: { p_error: string; p_post_id: string; p_retry_at: string }
        Returns: undefined
      }
      mark_social_post_failed: {
        Args: { p_error: string; p_post_id: string }
        Returns: undefined
      }
      mark_social_post_published: {
        Args: { p_external_id: string; p_permalink: string; p_post_id: string }
        Returns: undefined
      }
      match_brain_events: {
        Args: { _brand_id: string; _match_count?: number; _query: string }
        Returns: {
          content_summary: string
          created_at: string
          event_id: string
          event_type: string
          payload: Json
          similarity: number
          source_module: string
        }[]
      }
      media_plan_public_items: { Args: { _token: string }; Returns: Json }
      media_plan_public_resolve: { Args: { _token: string }; Returns: Json }
      module_level_rank: { Args: { _level: string }; Returns: number }
      my_access: { Args: { _brand_id?: string }; Returns: Json }
      notification_pref_for_kind: { Args: { _kind: string }; Returns: string }
      notification_prefs_allows: {
        Args: { _kind: string; _user_id: string }
        Returns: boolean
      }
      portal_approvals: {
        Args: { _client_id?: string; _status?: string; _token?: string }
        Returns: Json
      }
      portal_briefings: {
        Args: { _client_id?: string; _token?: string }
        Returns: Json
      }
      portal_calendar: {
        Args: { _client_id?: string; _month?: string; _token?: string }
        Returns: Json
      }
      portal_client_ids: { Args: { _user_id: string }; Returns: string[] }
      portal_decide: {
        Args: {
          _client_id?: string
          _decision?: string
          _identity?: string
          _note?: string
          _post_id?: string
          _token?: string
        }
        Returns: Json
      }
      portal_files: {
        Args: { _client_id?: string; _search?: string; _token?: string }
        Returns: Json
      }
      portal_metrics: {
        Args: { _client_id?: string; _token?: string }
        Returns: Json
      }
      portal_my_clients: { Args: never; Returns: Json }
      portal_permissions: { Args: { _client_id: string }; Returns: Json }
      portal_post: {
        Args: { _client_id?: string; _post_id?: string; _token?: string }
        Returns: Json
      }
      portal_rate_register_failure: {
        Args: { _ip_hash: string }
        Returns: Json
      }
      portal_rate_status: { Args: { _ip_hash: string }; Returns: Json }
      portal_resolve: {
        Args: { _client_id?: string; _token?: string }
        Returns: Json
      }
      process_brain_learning_queue: { Args: { _limit?: number }; Returns: Json }
      public_surface_rate_hit: {
        Args: {
          _block_seconds?: number
          _key: string
          _max?: number
          _window_seconds?: number
        }
        Returns: Json
      }
      reactivate_portal_token: {
        Args: { _token_id: string }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          label: string
          last_seen_at: string
          revoked_at: string
          token: string
        }[]
      }
      reap_brain_learning_queue: { Args: never; Returns: number }
      reap_stuck_ai_jobs: { Args: never; Returns: number }
      reconcile_client_document_ai: {
        Args: { _brand_id: string; _client_id: string }
        Returns: number
      }
      refresh_brain_stats: { Args: never; Returns: undefined }
      refresh_task_total_minutes: {
        Args: { _task_id: string }
        Returns: number
      }
      safe_uuid: { Args: { _txt: string }; Returns: string }
      seed_access_profiles: { Args: { _brand_id: string }; Returns: number }
      set_cron_secret: { Args: { _value: string }; Returns: undefined }
      start_timer: {
        Args: { _brand_id: string; _task_id: string }
        Returns: string
      }
      stop_timer: {
        Args: { _entry_id: string; _reason?: string }
        Returns: number
      }
      storage_scope_allows: {
        Args: { _bucket: string; _name: string; _write: boolean }
        Returns: boolean
      }
      sync_post_publication_state: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      upsert_brain_relationship: {
        Args: {
          _bidirectional?: boolean
          _brand_id: string
          _from_id: string
          _from_type: string
          _metadata?: Json
          _rel_type: string
          _strength_delta?: number
          _to_id: string
          _to_type: string
        }
        Returns: string
      }
      upsert_social_connection: {
        Args: {
          _access_token_ciphertext: string
          _account_username?: string
          _brand_id: string
          _channel: string
          _created_by?: string
          _external_id: string
          _external_name?: string
          _instagram_business_id?: string
          _meta_user_id?: string
          _metadata?: Json
          _owner_external_id?: string
          _owner_name?: string
          _page_id?: string
          _provider: string
          _scopes?: string[]
          _token_expires_at?: string
        }
        Returns: string
      }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      app_role:
        | "owner"
        | "manager"
        | "editor"
        | "designer"
        | "client"
        | "user"
        | "admin"
      approval_status:
        | "pending"
        | "approved"
        | "changes_requested"
        | "adjust"
        | "rejected"
      calendar_event_type: "appointment" | "seasonal"
      notification_kind:
        | "mention"
        | "assignment"
        | "approval_requested"
        | "approval_decision"
        | "deadline"
        | "system"
        | "sla_overdue"
        | "sla_overdue_manager"
      post_channel:
        | "instagram"
        | "tiktok"
        | "linkedin"
        | "x"
        | "youtube"
        | "blog"
      post_stage:
        | "idea"
        | "production"
        | "review"
        | "approved"
        | "scheduled"
        | "published"
      project_status:
        | "planning"
        | "in_progress"
        | "active"
        | "paused"
        | "done"
        | "archived"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status: "todo" | "in_progress" | "review" | "done"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      alert_severity: ["info", "warning", "critical"],
      app_role: [
        "owner",
        "manager",
        "editor",
        "designer",
        "client",
        "user",
        "admin",
      ],
      approval_status: [
        "pending",
        "approved",
        "changes_requested",
        "adjust",
        "rejected",
      ],
      calendar_event_type: ["appointment", "seasonal"],
      notification_kind: [
        "mention",
        "assignment",
        "approval_requested",
        "approval_decision",
        "deadline",
        "system",
        "sla_overdue",
        "sla_overdue_manager",
      ],
      post_channel: ["instagram", "tiktok", "linkedin", "x", "youtube", "blog"],
      post_stage: [
        "idea",
        "production",
        "review",
        "approved",
        "scheduled",
        "published",
      ],
      project_status: [
        "planning",
        "in_progress",
        "active",
        "paused",
        "done",
        "archived",
      ],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: ["todo", "in_progress", "review", "done"],
    },
  },
} as const
